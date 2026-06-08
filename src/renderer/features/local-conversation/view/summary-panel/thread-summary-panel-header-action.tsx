import { useMemo } from "react";
import type { ThreadSummaryPanelMode } from "../../thread-stage-types";
import {
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
  projectWorkspacePath: string | null;
  mode: ThreadSummaryPanelMode;
  pinnedOpen: boolean;
  onPinnedOpenToggle?: () => void;
}

export function ThreadSummaryPanelHeaderAction({
  activeThreadId,
  projectWorkspacePath,
  mode,
  pinnedOpen,
  onPinnedOpenToggle,
}: ThreadSummaryPanelHeaderActionProps) {
  const cwd = useConversationCwd(activeThreadId);
  const turns = useConversationTurns(activeThreadId);
  const contentProps = useMemo<ThreadSummaryPanelContentProps>(
    () => ({
      activeThreadId,
      cwd,
      projectWorkspacePath,
      turns,
      onErrorMessage: () => undefined,
    }),
    [activeThreadId, cwd, projectWorkspacePath, turns],
  );

  if (mode === "hidden") return null;
  if (mode === "popover") {
    return <ThreadSummaryPanelPopover {...contentProps} />;
  }

  return (
    <ThreadSummaryPanelToggle
      label="Toggle pinned summary"
      pressed={pinnedOpen}
      onClick={onPinnedOpenToggle}
    />
  );
}
