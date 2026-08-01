import { AlertTriangle, LoaderCircle } from "lucide-react";

import type { CoreAuthorityStatus } from "../../shared/core-authority-status";

export interface CoreAuthorityStatusPresentation {
  readonly detail: string | null;
  readonly kind: "recovering" | "unavailable";
  readonly label: string;
}

export const resolveCoreAuthorityStatusPresentation = (
  status: CoreAuthorityStatus,
): CoreAuthorityStatusPresentation | null => {
  if (status.kind === "ready") return null;
  if (status.kind === "recovering") {
    return {
      detail: null,
      kind: "recovering",
      label: "Reconnecting to Nodex Core…",
    };
  }
  return {
    detail: status.message,
    kind: "unavailable",
    label: "Nodex Core is unavailable",
  };
};

export function CoreAuthorityStatusNotice({
  status,
  onRelaunch,
  onRetry,
}: {
  readonly status: CoreAuthorityStatus;
  readonly onRelaunch: () => void;
  readonly onRetry: () => void;
}) {
  const presentation = resolveCoreAuthorityStatusPresentation(status);
  if (!presentation) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[61] flex justify-center">
      <div
        aria-live={presentation.kind === "unavailable" ? "assertive" : "polite"}
        className="pointer-events-auto flex max-w-[min(42rem,calc(100vw-1.5rem))] items-center gap-2 rounded-xl bg-token-dropdown-background/90 px-2.5 py-1.5 text-xs text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-sm"
        role={presentation.kind === "unavailable" ? "alert" : "status"}
      >
        {presentation.kind === "recovering" ? (
          <LoaderCircle className="icon-2xs shrink-0 animate-spin text-token-description-foreground" />
        ) : (
          <AlertTriangle className="icon-2xs shrink-0 text-[var(--color-text-warning)]" />
        )}
        <span className="shrink-0 font-medium">{presentation.label}</span>
        {presentation.detail ? (
          <span className="truncate text-token-description-foreground">
            {presentation.detail}
          </span>
        ) : null}
        {presentation.kind === "unavailable" ? (
          <div className="ml-1 flex shrink-0 items-center gap-0.5">
            <button
              className="rounded-lg px-2 py-1 font-medium hover:bg-token-foreground/10"
              onClick={onRetry}
              type="button"
            >
              Retry
            </button>
            <button
              className="rounded-lg px-2 py-1 text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
              onClick={onRelaunch}
              type="button"
            >
              Restart Nodex
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
