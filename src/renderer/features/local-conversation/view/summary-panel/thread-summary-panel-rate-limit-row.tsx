import { useCallback, useRef, useState } from "react";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "../../../../lib/utils";
import type { CodexAccountSnapshot, CodexConnectionState } from "../../../../lib/types";
import type { ThreadStageActions } from "../../thread-stage-types";
import { shouldRefreshAccountOnConnectionTooltipOpen } from "../shared/account-tooltip-refresh";
import { formatRateLimitSummary } from "../shared/auth-rate-limits";
import { renderConnectionAccountTooltipContent } from "../shared/auth-controls";
import { ThreadSummaryPanelRow } from "./thread-summary-panel-row";

interface ThreadSummaryPanelRateLimitRowProps {
  account: CodexAccountSnapshot | null;
  connection: CodexConnectionState;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
}

function connectionSummary(
  connection: CodexConnectionState,
  rateLimits: CodexAccountSnapshot["rateLimits"] | undefined,
): string {
  if (connection.status === "connected") return formatRateLimitSummary(rateLimits) ?? "Connected";
  if (connection.status === "starting") return "Connecting...";
  if (connection.status === "missingBinary") return "Codex CLI missing";
  if (connection.status === "error") return "Error";
  return "Disconnected";
}

export function ThreadSummaryPanelRateLimitRow({
  account,
  connection,
  actions,
  onErrorMessage,
}: ThreadSummaryPanelRateLimitRowProps) {
  const [busyAction, setBusyAction] = useState<"login" | "logout" | null>(null);
  const refreshInFlightRef = useRef(false);
  const authenticatedAccount = account?.account ?? null;

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

  const handleLogin = useCallback(async () => {
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

  const handleTooltipOpenChange = useCallback((isOpen: boolean) => {
    if (
      !shouldRefreshAccountOnConnectionTooltipOpen({
        isOpen,
        hasAccount: Boolean(account?.account),
        refreshInFlight: refreshInFlightRef.current,
      })
    ) {
      return;
    }

    refreshInFlightRef.current = true;
    void actions.onRefreshAccount()
      .catch(() => {})
      .finally(() => {
        refreshInFlightRef.current = false;
      });
  }, [account?.account, actions]);

  if (!authenticatedAccount) {
    return (
      <ThreadSummaryPanelRow
        label="Sign in"
        interactive
        disabled={busyAction !== null}
        onClick={() => void handleLogin()}
        trailing={<span className="text-size-chat text-token-text-tertiary">OpenAI</span>}
        trailingVisible
      />
    );
  }

  const summary = connectionSummary(connection, account?.rateLimits);
  const tooltipContent = renderConnectionAccountTooltipContent(authenticatedAccount, account?.rateLimits, {
    onSignOut: () => void handleLogout(),
    isSigningOutDisabled: busyAction !== null,
  });
  const row = (
    <div className="w-full">
      <ThreadSummaryPanelRow
        label="Rate limits"
        interactive
        onClick={() => {
          void actions.onRefreshAccount().catch(() => {});
        }}
        trailing={(
          <span
            className={cn(
              "rounded-full px-1.5 text-xs/4 tabular-nums tracking-tight",
              connection.status === "connected"
                ? "bg-[var(--green-bg)] text-[var(--green-text)]"
                : "bg-token-foreground/5 text-token-text-tertiary",
            )}
          >
            {summary}
          </span>
        )}
        trailingVisible
      />
    </div>
  );

  return (
    <NodexTooltip
      tooltipContent={tooltipContent}
      side="left"
      delayDuration={0}
      onOpenChange={handleTooltipOpenChange}
      interactive
    >
      {row}
    </NodexTooltip>
  );
}
