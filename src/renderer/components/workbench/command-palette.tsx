import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import { useCommandPaletteThreadItems } from "@/lib/command-palette-chat-search";
import {
  type CommandMenuMode,
  type CommandPaletteCommand,
  type CommandPalettePage,
  type CommandPaletteThread,
} from "@/lib/command-palette";
import {
  buildCommandPaletteCommands,
  executeCommandPaletteShellCommand,
  isCommandPaletteShellCommandId,
  type CommandPaletteShellCommandContext,
  type CommandPaletteShellCommandHandlers,
} from "@/lib/command-palette-commands";
import { useCommandPaletteThreadSearchIndex } from "@/lib/use-command-palette-thread-search-index";
import { configureInteractivePageSearch } from "@/lib/interactive-page-search";
import type { Project } from "@/lib/types";
import type { RecentPageSession } from "@/lib/use-workbench-profile-preferences";
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
  const { threads, loading: threadsLoading } = useCommandPaletteThreadItems({
    enabled: open,
    activeProjectId,
    refreshKey: openTriggerTick,
  });
  const [mode, setMode] = useState<CommandMenuMode>(initialMode);
  const threadSearchIndex = useCommandPaletteThreadSearchIndex(threads);
  const recentPageIds = useMemo(
    () => recentPageSessions.map((session) => session.pageId),
    [recentPageSessions],
  );
  useEffect(() => {
    return configureInteractivePageSearch(projects.map((project) => project.id), "replace");
  }, [projects]);
  const commands = useMemo(
    () => buildCommandPaletteCommands({
      ...commandContext,
      isMac,
      showMockCommands: import.meta.env.DEV,
    }),
    [commandContext, isMac],
  );

  useEffect(() => {
    if (open) setMode(initialMode);
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
    if (item.disabled || !isCommandPaletteShellCommandId(item.id)) return;
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
          projects={projects}
          activeProjectId={activeProjectId}
          recentPageIds={recentPageIds}
          threads={threads}
          threadSearchIndex={threadSearchIndex}
          loading={threadsLoading}
          pagesLoading={false}
          chatsLoading={threadsLoading}
          onChangeMode={handleChangeMode}
          onRequestClose={() => onOpenChange(false)}
          onExecute={handleExecute}
        />
      </DialogContent>
    </Dialog>
  );
}
