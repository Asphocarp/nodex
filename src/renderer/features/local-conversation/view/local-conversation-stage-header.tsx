import { memo, useCallback, useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { columnStyles } from "@/components/kanban/column";
import { cn } from "../../../lib/utils";
import { CardIcon } from "../../../components/workbench/card-icon";
import { NodexDropdownItem, NodexDropdownMenu } from "@/components/ui/dropdown";
import {
  AuthPopover,
  CardInfoHoverCard,
  invoke,
} from "./local-conversation-stage-header-deps";
import { resolveThreadCardResult } from "./shared/thread-card-fetch";
import type { Card } from "../../../lib/types";
import type { ThreadStageActions, ThreadStageHeaderModel } from "../thread-stage-types";

interface ThreadStageHeaderProps {
  model: ThreadStageHeaderModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
}

function ThreadStageHeaderComponent({ model, actions, onErrorMessage }: ThreadStageHeaderProps) {
  const [busyAction, setBusyAction] = useState<"login" | "logout" | null>(null);
  const [openCardData, setOpenCardData] = useState<Card | null>(null);

  useEffect(() => {
    const cardId = model.cardId;
    if (!cardId) {
      setOpenCardData(null);
      return;
    }

    let cancelled = false;
    setOpenCardData(null);

    void invoke("card:get", model.projectId, cardId, model.activeThreadCardColumnId ?? undefined)
      .then((result) => {
        if (cancelled) return;
        const card = resolveThreadCardResult(result);
        if (!card) return;
        setOpenCardData(card);
      })
      .catch(() => {
        if (cancelled) return;
        setOpenCardData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [model.activeThreadCardColumnId, model.cardId, model.projectId]);

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

  const openCardTarget = model.openCardTarget;
  const openCardTone = openCardTarget?.columnId ? columnStyles[openCardTarget.columnId] : null;
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
          {openCardTarget ? (
            <CardInfoHoverCard card={openCardData} columnId={openCardTarget.columnId}>
              <button
                type="button"
                className={cn(
                  "inline-flex h-5 max-w-40 items-center gap-1 rounded-full px-2 text-xs font-medium hover:opacity-80",
                  openCardTone
                    ? `${openCardTone.badgeBg} ${openCardTone.badgeText}`
                    : "bg-(--blue-bg) text-(--accent-blue)",
                )}
                onClick={() => actions.onOpenCard(openCardTarget.cardId)}
              >
                <CardIcon className="size-2.75 shrink-0" />
                <span className="truncate">{openCardTarget.title}</span>
              </button>
            </CardInfoHoverCard>
          ) : null}
          <AuthPopover
            account={model.account}
            busyAction={busyAction}
            onChatGptLogin={() => void handleChatGptLogin()}
            onApiKeyLogin={(key) => void handleApiKeyLogin(key)}
            onCancelLogin={(loginId) => void actions.onCancelLogin(loginId)}
          />
          {model.showSideChatAction ? (
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
              <NodexDropdownItem
                onSelect={() => {
                  void handleOpenSideChat();
                }}
              >
                Open side chat
              </NodexDropdownItem>
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
    const leftOpenCardTarget = left.model.openCardTarget;
    const rightOpenCardTarget = right.model.openCardTarget;
    return (
      left.actions === right.actions
      && left.onErrorMessage === right.onErrorMessage
      && left.model.title === right.model.title
      && left.model.projectId === right.model.projectId
      && left.model.threadId === right.model.threadId
      && left.model.activeThreadCardColumnId === right.model.activeThreadCardColumnId
      && left.model.connection === right.model.connection
      && left.model.account === right.model.account
      && left.model.cardId === right.model.cardId
      && left.model.showSideChatAction === right.model.showSideChatAction
      && leftOpenCardTarget?.cardId === rightOpenCardTarget?.cardId
      && leftOpenCardTarget?.title === rightOpenCardTarget?.title
      && leftOpenCardTarget?.columnId === rightOpenCardTarget?.columnId
    );
  },
);
