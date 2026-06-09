import { useMemo } from "react";
import type { ThreadSummaryPanelMode } from "../../thread-stage-types";
import {
  useConversationBackgroundTerminalRows,
  useConversationCwd,
  useConversationTurns,
} from "../../local-conversation-store";
import {
  ThreadSummaryPanelPopover,
  type ThreadSummaryPanelContentProps,
} from "./thread-floating-summary-panel";
import { ThreadSummaryPanelToggle } from "./thread-summary-panel-toggle";

export interface ThreadSummaryPanelHeaderActionProps {
  activeThreadId: string | null;
  onPopoverOpenChange?: (open: boolean) => void;
  projectWorkspacePath: string | null;
  mode: ThreadSummaryPanelMode;
  pinnedOpen: boolean;
  onPinnedOpenToggle?: () => void;
  popoverOpen?: boolean;
}

export function ThreadSummaryPanelHeaderAction({
  activeThreadId,
  onPopoverOpenChange,
  projectWorkspacePath,
  mode,
  pinnedOpen,
  onPinnedOpenToggle,
  popoverOpen,
}: ThreadSummaryPanelHeaderActionProps) {
  const cwd = useConversationCwd(activeThreadId);
  const turns = useConversationTurns(activeThreadId);
  const backgroundTerminalRows = useConversationBackgroundTerminalRows(activeThreadId);
  const contentProps = useMemo<ThreadSummaryPanelContentProps>(
    () => ({
      activeThreadId,
      cwd,
      projectWorkspacePath,
      turns,
      backgroundTerminalRows,
      onErrorMessage: () => undefined,
    }),
    [activeThreadId, backgroundTerminalRows, cwd, projectWorkspacePath, turns],
  );

  if (mode === "hidden") return null;
  if (mode === "popover") {
    return (
      <ThreadSummaryPanelPopover
        {...contentProps}
        open={popoverOpen}
        onOpenChange={onPopoverOpenChange}
      />
    );
  }

  return (
    <ThreadSummaryPanelToggle
      label="Toggle pinned summary"
      pressed={pinnedOpen}
      onClick={onPinnedOpenToggle}
    />
  );
}
