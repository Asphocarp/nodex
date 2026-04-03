import { useCallback, useEffect, useRef, useState } from "react";
import { columnStyles } from "@/components/kanban/column";
import { cn } from "../../../lib/utils";
import { CardIcon } from "../../../components/workbench/card-icon";
import {
  AuthPopover,
  ConnectionBadge,
  renderConnectionAccountTooltipContent,
  CardInfoHoverCard,
  invoke,
} from "./local-conversation-stage-header-deps";
import { shouldRefreshAccountOnConnectionTooltipOpen } from "./shared/account-tooltip-refresh";
import { resolveThreadCardResult } from "./shared/thread-card-fetch";
import type { Card } from "../../../lib/types";
import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";

interface ThreadStageHeaderProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
}

export function ThreadStageHeader({ model, actions, onErrorMessage }: ThreadStageHeaderProps) {
  const [busyAction, setBusyAction] = useState<"login" | "logout" | null>(null);
  const [openCardData, setOpenCardData] = useState<Card | null>(null);
  const accountRefreshInFlightRef = useRef(false);
  const authenticatedAccount = model.account?.account ?? null;
  const hasAuthenticatedAccount = authenticatedAccount !== null;

  useEffect(() => {
    const cardId = model.conversation?.cardId;
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
  }, [model.activeThreadCardColumnId, model.conversation?.cardId, model.projectId]);

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

  const handleLogout = useCallback(async () => {
    setBusyAction("logout");
    onErrorMessage(null);
    try {
      await actions.onLogout();
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Logout failed");
    } finally {
      setBusyAction(null);
    }
  }, [actions, onErrorMessage]);

  const connectionTooltipContent = authenticatedAccount
    ? renderConnectionAccountTooltipContent(authenticatedAccount, model.account?.rateLimits, {
        onSignOut: () => void handleLogout(),
        isSigningOutDisabled: busyAction !== null,
      })
    : null;

  const handleConnectionTooltipOpenChange = useCallback((isOpen: boolean) => {
    if (
      !shouldRefreshAccountOnConnectionTooltipOpen({
        isOpen,
        hasAccount: Boolean(model.account?.account),
        refreshInFlight: accountRefreshInFlightRef.current,
      })
    ) {
      return;
    }

    accountRefreshInFlightRef.current = true;
    void actions.onRefreshAccount()
      .catch(() => {})
      .finally(() => {
        accountRefreshInFlightRef.current = false;
      });
  }, [actions, model.account?.account]);

  const openCardTarget = model.openCardTarget;
  const openCardTone = openCardTarget?.columnId ? columnStyles[openCardTarget.columnId] : null;

  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-sm/tight font-medium text-(--foreground)">
          {model.title}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
          {hasAuthenticatedAccount && (
            <ConnectionBadge
              connection={model.connection}
              rateLimits={model.account?.rateLimits}
              tooltipContent={connectionTooltipContent}
              onTooltipOpenChange={handleConnectionTooltipOpenChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
