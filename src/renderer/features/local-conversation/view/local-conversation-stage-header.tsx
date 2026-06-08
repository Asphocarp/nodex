import { memo, useCallback, useEffect, useState } from "react";
import { columnStyles } from "@/components/kanban/column";
import { cn } from "../../../lib/utils";
import { CardIcon } from "../../../components/workbench/card-icon";
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

  return (
    <div
      className={cn(
        "draggable relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-4 py-3 pr-3 pl-3 electron:h-toolbar electron:py-0 extension:py-row-y",
        model.showSeparator && "border-b border-token-border",
      )}
      style={{
        paddingRight: "var(--thread-stage-header-right-reserve, 0px)",
      }}
    >
      <div
        aria-hidden="true"
        data-testid="thread-stage-header-toggle-hitbox"
        className="no-drag pointer-events-auto absolute inset-y-0 right-0 z-10"
        style={{
          width: "calc(var(--thread-stage-header-right-reserve, 0px) + calc(var(--spacing) * 1.5))",
        }}
      />
      <div
        data-testid="thread-stage-header-context-menu-surface"
        className="pointer-events-none flex h-full min-w-0 flex-1 isolate items-center gap-1.5 overflow-hidden [contain:layout_paint] pe-1.5"
      >
        <div className="pointer-events-none w-full min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto">
          <div className="draggable grid w-full min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-4 electron:h-toolbar extension:py-row-y">
            <div className="flex min-w-0 items-center gap-2 truncate text-base electron:font-medium">
              <div
                data-testid="thread-stage-title"
                className="no-drag pointer-events-auto inline-flex max-w-[320px] min-w-[2ch] cursor-interaction items-center overflow-hidden text-token-foreground"
              >
                <span className="inline-flex min-w-0 items-center gap-2 overflow-hidden">
                  <span className="min-w-0 truncate">{model.title}</span>
                </span>
              </div>
              <div className="no-drag flex shrink-0 items-center gap-1.5">
                {openCardTarget && (
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
                )}
                <AuthPopover
                  account={model.account}
                  busyAction={busyAction}
                  onChatGptLogin={() => void handleChatGptLogin()}
                  onApiKeyLogin={(key) => void handleApiKeyLogin(key)}
                  onCancelLogin={(loginId) => void actions.onCancelLogin(loginId)}
                />
              </div>
            </div>
          </div>
        </div>
        {model.summaryAction ? (
          <div
            data-testid="thread-stage-header-summary-actions"
            className="ms-auto flex shrink-0 -translate-y-px items-center gap-1.5"
          >
            <div className="no-drag pointer-events-auto flex shrink-0 items-center">
              {model.summaryAction}
            </div>
          </div>
        ) : null}
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
      && left.model.summaryAction === right.model.summaryAction
      && leftOpenCardTarget?.cardId === rightOpenCardTarget?.cardId
      && leftOpenCardTarget?.title === rightOpenCardTarget?.title
      && leftOpenCardTarget?.columnId === rightOpenCardTarget?.columnId
    );
  },
);
