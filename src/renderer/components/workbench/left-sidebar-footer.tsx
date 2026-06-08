import { Settings } from "lucide-react";
import { AccountRateLimitRing } from "@/features/local-conversation/view/shared/account-rate-limit-ring";
import type { CodexAccountSnapshot, CodexConnectionState } from "@/lib/types";

export interface LeftSidebarFooterProps {
  onOpenSettings: () => void;
  account?: CodexAccountSnapshot | null;
  connection?: CodexConnectionState;
  onRefreshAccount?: () => Promise<CodexAccountSnapshot>;
  onLogout?: () => Promise<void>;
  onErrorMessage?: (message: string | null) => void;
}

export function LeftSidebarFooter({
  onOpenSettings,
  account,
  connection,
  onRefreshAccount,
  onLogout,
  onErrorMessage,
}: LeftSidebarFooterProps) {
  const showQuotaRing = Boolean(account?.account && connection && onRefreshAccount && onLogout);

  return (
    <div className="flex items-center justify-between border-t border-(--sidebar-border) px-(--sidebar-shell-padding-x) py-(--sidebar-row-padding-y)">
      <button
        type="button"
        onClick={onOpenSettings}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--sidebar-foreground-secondary) hover:bg-(--sidebar-accent) hover:text-(--sidebar-foreground)"
        title="Settings"
        aria-label="Settings"
      >
        <Settings className="size-3.5" />
      </button>
      {showQuotaRing && connection && onRefreshAccount && onLogout ? (
        <AccountRateLimitRing
          account={account ?? null}
          connection={connection}
          onRefreshAccount={onRefreshAccount}
          onLogout={onLogout}
          onErrorMessage={onErrorMessage}
        />
      ) : null}
    </div>
  );
}
