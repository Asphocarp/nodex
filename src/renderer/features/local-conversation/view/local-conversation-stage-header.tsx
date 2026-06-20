import { memo, useCallback, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../../lib/utils";
import { NodexDropdownItem, NodexDropdownMenu } from "@/components/ui/dropdown";
import {
  AuthPopover,
} from "./local-conversation-stage-header-deps";
import type { ThreadStageActions, ThreadStageHeaderModel } from "../thread-stage-types";

interface ThreadStageHeaderProps {
  model: ThreadStageHeaderModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
}

function ThreadStageHeaderComponent({ model, actions, onErrorMessage }: ThreadStageHeaderProps) {
  const [busyAction, setBusyAction] = useState<"login" | "logout" | null>(null);

  const handleChatGptLogin = useCallback(async () => {
    setBusyAction("login");
    onErrorMessage(null);

    try {
      const result = await actions.onStartChatGptLogin();
      if (result.type === "chatgpt" && result.authUrl) {
        window.open(result.authUrl, "_blank");
      }
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusyAction(null);
    }
  }, [actions, onErrorMessage]);

  const handleApiKeyLogin = useCallback(async (apiKey: string) => {
    setBusyAction("login");
    onErrorMessage(null);
    try {
      await actions.onStartApiKeyLogin(apiKey);
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusyAction(null);
    }
  }, [actions, onErrorMessage]);

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
        "draggable grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 electron:h-toolbar extension:py-row-y",
      )}
    >
      <div
        className="flex min-w-0 items-center gap-2 truncate text-base electron:font-medium"
      >
        <div
          data-testid="thread-stage-title"
          className="max-w-[320px] min-w-0 truncate text-token-foreground"
        >
          {model.title}
        </div>
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          <AuthPopover
            account={model.account}
            busyAction={busyAction}
            onChatGptLogin={() => void handleChatGptLogin()}
            onApiKeyLogin={(key) => void handleApiKeyLogin(key)}
            onCancelLogin={(loginId) => void actions.onCancelLogin(loginId)}
          />
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
      && left.model.connection === right.model.connection
      && left.model.account === right.model.account
      && left.model.showSideChatAction === right.model.showSideChatAction
    );
  },
);
