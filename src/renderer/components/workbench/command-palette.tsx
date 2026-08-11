import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import type {
  CommandMenuMode,
  CommandPalettePage,
  CommandPaletteCommand,
  CommandPaletteThread,
} from "@/lib/command-palette";
import { getBoardProjectStore } from "@/lib/board-store";
import type { Project } from "@/lib/types";
import { useCommandPalettePageSearchIndex } from "@/lib/use-command-palette-page-search-index";
import { useCommandPaletteThreadItems } from "@/lib/command-palette-chat-search";
import { useCommandPaletteThreadSearchIndex } from "@/lib/use-command-palette-thread-search-index";
import type { RecentPageSession } from "@/lib/use-workbench-profile-preferences";
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
  activeProjectId: string | null;
  recentPageSessions: RecentPageSession[];
  commandContext: Omit<CommandPaletteShellCommandContext, "isMac" | "showMockCommands">;
  commandHandlers: CommandPaletteShellCommandHandlers;
  onOpenChange: (open: boolean) => void;
  onOpenPage: (projectId: string, pageId: string, titleSnapshot?: string) => void;
  onOpenThread: (threadId: string) => void;
}

type PaletteItem = CommandPaletteCommand | CommandPalettePage | CommandPaletteThread;

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
}

function useCommandPalettePages(
  open: boolean,
  projects: Project[],
  activeProjectId: string | null,
  recentPageSessions: RecentPageSession[],
): { pages: CommandPalettePage[]; loading: boolean } {
  const [version, setVersion] = useState(0);
  const stores = useMemo(
    () => projects.flatMap((project) => project.defaultDatabaseViewId
      ? [{
          project,
          store: getBoardProjectStore(project.id, project.defaultDatabaseViewId),
        }]
      : []),
    [projects],
  );
  const recentIndexByKey = useMemo(() => {
    const index = new Map<string, number>();
    recentPageSessions.forEach((session, order) => {
      index.set(`${session.projectId}:${session.pageId}`, order);
    });
    return index;
  }, [recentPageSessions]);

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
    const pages: CommandPalettePage[] = [];

    for (const { project, store } of stores) {
      const snapshot = store.getSnapshot();
      if (snapshot.loading && snapshot.pageIndex.size === 0) {
        loading = true;
      }

      for (const page of snapshot.pageIndex.values()) {
        pages.push({
          kind: "page",
          id: `${project.id}:${page.id}`,
          projectId: project.id,
          projectName: project.name,
          projectAppearance: project.appearance,
          columnName: page.columnName,
          page,
          inActiveProject: project.id === activeProjectId,
          recentIndex: recentIndexByKey.get(`${project.id}:${page.id}`) ?? null,
          boardIndex: page.boardIndex,
        });
      }
    }

    return { pages, loading };
  }, [activeProjectId, recentIndexByKey, stores, version]);
}

export function CommandPalette({
  open,
  openTriggerTick,
  initialMode = "root",
  initialQuery,
  projects,
  activeProjectId,
  recentPageSessions,
  commandContext,
  commandHandlers,
  onOpenChange,
  onOpenPage,
  onOpenThread,
}: CommandPaletteProps) {
  const isMac = isMacPlatform();
  const { pages, loading } = useCommandPalettePages(open, projects, activeProjectId, recentPageSessions);
  const { threads, loading: threadsLoading } = useCommandPaletteThreadItems({
    enabled: open,
    activeProjectId,
    refreshKey: openTriggerTick,
  });
  const [mode, setMode] = useState<CommandMenuMode>(initialMode);
  const pageSearchIndex = useCommandPalettePageSearchIndex(pages);
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
    if (item.kind === "page") {
      onOpenPage(item.projectId, item.page.id, item.page.title);
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

    if (item.id === "searchPages") {
      setMode("pages");
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
        unstyledContent
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
          pages={pages}
          threads={threads}
          pageSearchIndex={pageSearchIndex}
          threadSearchIndex={threadSearchIndex}
          loading={loading || threadsLoading}
          pagesLoading={loading}
          chatsLoading={threadsLoading}
          onChangeMode={handleChangeMode}
          onRequestClose={() => onOpenChange(false)}
          onExecute={handleExecute}
        />
      </DialogContent>
    </Dialog>
  );
}
