import { memo, useCallback } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../../lib/utils";
import { NodexDropdownItem, NodexDropdownMenu } from "@/components/ui/dropdown";
import type { ThreadStageActions, ThreadStageHeaderModel } from "../thread-stage-types";

interface ThreadStageHeaderProps {
  model: ThreadStageHeaderModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
}

function ThreadStageHeaderComponent({ model, actions, onErrorMessage }: ThreadStageHeaderProps) {
  const canRenameThread = Boolean(model.threadId && actions.onRequestRenameThread);
  const showThreadActions = canRenameThread || model.showSideChatAction;
  const handleOpenSideChat = useCallback(async () => {
    if (!actions.onOpenSideChat) return;
    onErrorMessage(null);
    try {
      await actions.onOpenSideChat();
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Failed to open side chat");
    }
  }, [actions, onErrorMessage]);

  return (
    <div
      className={cn(
        "draggable grid w-full min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-4 electron:h-toolbar extension:py-row-y",
      )}
    >
      <div
        className="flex min-w-0 items-center gap-2 truncate text-base electron:font-medium"
      >
        <span
          data-testid="thread-stage-title"
          className="inline-flex max-w-[320px] min-w-[2ch] items-center overflow-hidden text-token-foreground"
        >
          <span className="min-w-0 truncate">{model.title}</span>
        </span>
        <div className="no-drag flex items-center gap-2">
          {showThreadActions ? (
            <NodexDropdownMenu
              align="end"
              sideOffset={6}
              contentWidth="menu"
              triggerButton={(
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-lg text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-text-primary"
                  aria-label="Thread actions"
                  title="Thread actions"
                >
                  <MoreHorizontal className="icon-sm" />
                </button>
              )}
            >
              {canRenameThread ? (
                <NodexDropdownItem
                  onSelect={() => {
                    actions.onRequestRenameThread?.();
                  }}
                >
                  Rename chat
                </NodexDropdownItem>
              ) : null}
              {model.showSideChatAction ? (
                <NodexDropdownItem
                  onSelect={() => {
                    void handleOpenSideChat();
                  }}
                >
                  Open side chat
                </NodexDropdownItem>
              ) : null}
            </NodexDropdownMenu>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const ThreadStageHeader = memo(
  ThreadStageHeaderComponent,
  (left, right) => {
    return (
      left.actions === right.actions
      && left.onErrorMessage === right.onErrorMessage
      && left.model.title === right.model.title
      && left.model.projectId === right.model.projectId
      && left.model.threadId === right.model.threadId
      && left.model.showSideChatAction === right.model.showSideChatAction
    );
  },
);
