import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import type {
  CommandMenuMode,
  CommandPaletteCard,
  CommandPaletteCommand,
  CommandPaletteThread,
} from "@/lib/command-palette";
import { getKanbanProjectStore } from "@/lib/kanban-store";
import { normalizeProjectIcon } from "@/lib/project-icon";
import type { Project } from "@/lib/types";
import { useCommandPaletteCardSearchIndex } from "@/lib/use-command-palette-card-search-index";
import { useCommandPaletteThreadItems } from "@/lib/command-palette-chat-search";
import { useCommandPaletteThreadSearchIndex } from "@/lib/use-command-palette-thread-search-index";
import type { RecentCardSession } from "@/lib/use-workbench-state";
import {
  buildCommandPaletteCommands,
  executeCommandPaletteShellCommand,
  isCommandPaletteShellCommandId,
  type CommandPaletteShellCommandContext,
  type CommandPaletteShellCommandHandlers,
} from "@/lib/command-palette-commands";
import { CommandPaletteSurface } from "./command-palette-surface";

interface CommandPaletteProps {
  open: boolean;
  openTriggerTick: number;
  initialMode?: CommandMenuMode;
  initialQuery?: string;
  projects: Project[];
  activeProjectId: string;
  recentCardSessions: RecentCardSession[];
  commandContext: Omit<CommandPaletteShellCommandContext, "isMac" | "showMockCommands">;
  commandHandlers: CommandPaletteShellCommandHandlers;
  onOpenChange: (open: boolean) => void;
  onOpenCard: (projectId: string, cardId: string, titleSnapshot?: string) => void;
  onOpenThread: (threadId: string) => void;
}

type PaletteItem = CommandPaletteCommand | CommandPaletteCard | CommandPaletteThread;

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
}

function useCommandPaletteCards(
  open: boolean,
  projects: Project[],
  activeProjectId: string,
  recentCardSessions: RecentCardSession[],
): { cards: CommandPaletteCard[]; loading: boolean } {
  const [version, setVersion] = useState(0);
  const stores = useMemo(
    () => projects.map((project) => ({ project, store: getKanbanProjectStore(project.id) })),
    [projects],
  );
  const recentIndexByKey = useMemo(() => {
    const index = new Map<string, number>();
    recentCardSessions.forEach((session, order) => {
      index.set(`${session.projectId}:${session.cardId}`, order);
    });
    return index;
  }, [recentCardSessions]);

  useEffect(() => {
    if (!open || stores.length === 0) return;

    const unsubscribe = stores.map(({ store }) =>
      store.subscribe(() => {
        setVersion((value) => value + 1);
      }),
    );

    return () => {
      unsubscribe.forEach((stop) => stop());
    };
  }, [open, stores]);

  return useMemo(() => {
    void version;
    let loading = false;
    const cards: CommandPaletteCard[] = [];

    for (const { project, store } of stores) {
      const snapshot = store.getSnapshot();
      if (snapshot.loading && snapshot.cardIndex.size === 0) {
        loading = true;
      }

      const projectIcon = normalizeProjectIcon(project.icon);
      for (const card of snapshot.cardIndex.values()) {
        cards.push({
          kind: "card",
          id: `${project.id}:${card.id}`,
          projectId: project.id,
          projectName: project.name,
          projectIcon,
          columnName: card.columnName,
          card,
          inActiveProject: project.id === activeProjectId,
          recentIndex: recentIndexByKey.get(`${project.id}:${card.id}`) ?? null,
          boardIndex: card.boardIndex,
        });
      }
    }

    return { cards, loading };
  }, [activeProjectId, recentIndexByKey, stores, version]);
}

export function CommandPalette({
  open,
  openTriggerTick,
  initialMode = "root",
  initialQuery,
  projects,
  activeProjectId,
  recentCardSessions,
  commandContext,
  commandHandlers,
  onOpenChange,
  onOpenCard,
  onOpenThread,
}: CommandPaletteProps) {
  const isMac = isMacPlatform();
  const { cards, loading } = useCommandPaletteCards(open, projects, activeProjectId, recentCardSessions);
  const { threads, loading: threadsLoading } = useCommandPaletteThreadItems({
    enabled: open,
    activeProjectId,
    refreshKey: openTriggerTick,
  });
  const [mode, setMode] = useState<CommandMenuMode>(initialMode);
  const cardSearchIndex = useCommandPaletteCardSearchIndex(cards);
  const threadSearchIndex = useCommandPaletteThreadSearchIndex(threads);
  const commands = useMemo(
    () => buildCommandPaletteCommands({
      ...commandContext,
      isMac,
      showMockCommands: import.meta.env.DEV,
    }),
    [commandContext, isMac],
  );

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
  }, [initialMode, open, openTriggerTick]);

  const handleChangeMode = useCallback((nextMode: CommandMenuMode) => {
    setMode(nextMode);
  }, []);

  const handleExecute = (item: PaletteItem) => {
    if (item.kind === "card") {
      onOpenCard(item.projectId, item.card.id, item.card.title);
      return;
    }

    if (item.kind === "thread") {
      onOpenThread(item.threadId);
      return;
    }

    if (item.id === "searchChats") {
      setMode("chats");
      return;
    }

    if (item.id === "searchCards") {
      setMode("cards");
      return;
    }

    if (item.id === "searchFiles") {
      setMode("files");
      return;
    }

    if (item.disabled) {
      return;
    }

    if (!isCommandPaletteShellCommandId(item.id)) return;
    executeCommandPaletteShellCommand(item.id, commandHandlers);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-transparent"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="command-menu-dialog global-command-menu-dialog w-[min(520px,92vw)] max-w-none border-none bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <CommandPaletteSurface
          open={open}
          openTriggerTick={openTriggerTick}
          mode={mode}
          initialQuery={initialQuery}
          commands={commands}
          cards={cards}
          threads={threads}
          cardSearchIndex={cardSearchIndex}
          threadSearchIndex={threadSearchIndex}
          loading={loading || threadsLoading}
          cardsLoading={loading}
          chatsLoading={threadsLoading}
          onChangeMode={handleChangeMode}
          onRequestClose={() => onOpenChange(false)}
          onExecute={handleExecute}
        />
      </DialogContent>
    </Dialog>
  );
}
