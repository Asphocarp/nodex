import { useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type {
  CodexAccountSnapshot,
  CodexRateLimitResetCredit,
  CodexRateLimitResetCreditsSummary,
  CodexRateLimitResetInput,
  CodexRateLimitResetResult,
  CodexRateLimitsSnapshot,
} from "../../../../lib/types";

export interface RateLimitRingWindowView {
  label: string;
  compactLabel: string;
  ariaLabel: string;
  remainingPercent: number;
  windowDurationMins: number;
}

export interface RateLimitRingViewModel {
  outer: RateLimitRingWindowView | null;
  inner: RateLimitRingWindowView | null;
  ariaLabel: string;
  summaryLabel: string | null;
  hasLimits: boolean;
}

export function formatRateLimitWindowLabel(windowDurationMins?: number): string | null {
  if (!windowDurationMins || windowDurationMins <= 0) return null;

  const roundedMinutes = Math.round(windowDurationMins);
  const minutesPerHour = 60;
  const minutesPerDay = 24 * minutesPerHour;
  const minutesPerWeek = 7 * minutesPerDay;

  if (roundedMinutes >= minutesPerWeek) {
    const weeks = Math.max(1, Math.round(roundedMinutes / minutesPerWeek));
    return weeks === 1 ? "Weekly" : `${weeks}w`;
  }

  if (roundedMinutes >= minutesPerDay) {
    return `${Math.round(roundedMinutes / minutesPerDay)}d`;
  }

  if (roundedMinutes >= minutesPerHour) {
    return `${Math.round(roundedMinutes / minutesPerHour)}h`;
  }

  return `${roundedMinutes}m`;
}

export function formatRateLimitWindowCompactLabel(windowDurationMins?: number): string | null {
  if (!windowDurationMins || windowDurationMins <= 0) return null;

  const roundedMinutes = Math.round(windowDurationMins);
  const minutesPerHour = 60;
  const minutesPerDay = 24 * minutesPerHour;
  const minutesPerWeek = 7 * minutesPerDay;

  if (roundedMinutes >= minutesPerWeek) {
    const weeks = Math.max(1, Math.round(roundedMinutes / minutesPerWeek));
    return weeks === 1 ? "wk" : `${weeks}w`;
  }

  if (roundedMinutes >= minutesPerDay) {
    return `${Math.round(roundedMinutes / minutesPerDay)}d`;
  }

  if (roundedMinutes >= minutesPerHour) {
    return `${Math.round(roundedMinutes / minutesPerHour)}h`;
  }

  return `${roundedMinutes}m`;
}

export function formatRateLimitResetLabel(
  resetsAt?: number,
  now: number = Date.now(),
): string | null {
  if (!resetsAt) return null;

  const msUntilReset = resetsAt - now;
  if (msUntilReset <= 0) return "now";

  const sixtyHoursMs = 60 * 60 * 60 * 1000;
  if (msUntilReset < sixtyHoursMs) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(resetsAt);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(resetsAt);
}

export function formatQuotaResetCreditExpiration(
  expiresAt: number | null,
  locale?: string,
): string {
  if (expiresAt === null) return "Doesn’t expire";

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(expiresAt * 1_000);
}

export function findAvailableQuotaResetCredit(
  summary: CodexRateLimitResetCreditsSummary,
): CodexRateLimitResetCredit | null {
  return summary.credits?.find((credit) => credit.status === "available") ?? null;
}

export function formatQuotaResetAvailability(availableCount: number): string {
  return availableCount === 1
    ? "1 available reset"
    : `${availableCount} available resets`;
}

export function getRemainingRateLimitPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function buildRateLimitRow(window: CodexRateLimitsSnapshot["primary"]) {
  if (!window) return null;

  const label = formatRateLimitWindowLabel(window.windowDurationMins);
  if (!label) return null;

  return {
    label,
    remainingPercent: getRemainingRateLimitPercent(window.usedPercent),
    resetsAtLabel: formatRateLimitResetLabel(window.resetsAt),
  };
}

function buildRateLimitSummaryPart(window: CodexRateLimitsSnapshot["primary"]): string | null {
  if (!window) return null;
  return `${getRemainingRateLimitPercent(window.usedPercent)}%`;
}

export function formatRateLimitSummary(
  rateLimits: CodexAccountSnapshot["rateLimits"] | undefined,
): string | null {
  if (!rateLimits) return null;

  const parts = [buildRateLimitSummaryPart(rateLimits.primary), buildRateLimitSummaryPart(rateLimits.secondary)].filter(
    (part): part is string => part !== null,
  );
  if (parts.length === 0) return null;

  return parts.join(" · ");
}

function formatRateLimitWindowAriaLabel(label: string): string {
  if (label === "Weekly") return "weekly";
  return label;
}

function buildRateLimitRingWindowView(
  window: CodexRateLimitsSnapshot["primary"],
): RateLimitRingWindowView | null {
  if (!window?.windowDurationMins || window.windowDurationMins <= 0) return null;

  const label = formatRateLimitWindowLabel(window.windowDurationMins);
  const compactLabel = formatRateLimitWindowCompactLabel(window.windowDurationMins);
  if (!label || !compactLabel) return null;

  return {
    label,
    compactLabel,
    ariaLabel: formatRateLimitWindowAriaLabel(label),
    remainingPercent: getRemainingRateLimitPercent(window.usedPercent),
    windowDurationMins: window.windowDurationMins,
  };
}

export function buildRateLimitRingViewModel(
  rateLimits: CodexAccountSnapshot["rateLimits"] | undefined,
): RateLimitRingViewModel {
  const windows = [
    buildRateLimitRingWindowView(rateLimits?.primary),
    buildRateLimitRingWindowView(rateLimits?.secondary),
  ]
    .filter((window): window is RateLimitRingWindowView => window !== null)
    .sort((left, right) => left.windowDurationMins - right.windowDurationMins);

  const outer = windows[0] ?? null;
  const inner = windows.length > 1 ? windows[windows.length - 1] ?? null : null;
  const ariaParts = [outer, inner]
    .filter((window): window is RateLimitRingWindowView => window !== null)
    .map((window) => `${window.ariaLabel} ${window.remainingPercent}%`);

  return {
    outer,
    inner,
    ariaLabel: ariaParts.length > 0
      ? `Usage remaining: ${ariaParts.join(", ")}`
      : "Usage remaining unavailable",
    summaryLabel: ariaParts.length > 0 ? ariaParts.join(", ") : null,
    hasLimits: ariaParts.length > 0,
  };
}

export function RateLimitTooltipSection({
  rateLimits,
  quotaResetCredits,
  onQuotaReset,
}: {
  rateLimits: CodexAccountSnapshot["rateLimits"] | undefined;
  quotaResetCredits?: CodexRateLimitResetCreditsSummary | null;
  onQuotaReset?: (input: CodexRateLimitResetInput) => Promise<CodexRateLimitResetResult>;
}) {
  const rows = rateLimits
    ? [buildRateLimitRow(rateLimits.primary), buildRateLimitRow(rateLimits.secondary)].filter(
        (row): row is NonNullable<ReturnType<typeof buildRateLimitRow>> => row !== null,
      )
    : [];
  const hasQuotaReset = Boolean(quotaResetCredits && onQuotaReset);
  if (rows.length === 0 && !hasQuotaReset) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-(--border) pt-2">
      <div className="text-xs text-(--foreground-tertiary)">Usage remaining</div>
      <div className="flex flex-col gap-1">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2"
          >
            <div className="min-w-0 text-sm font-medium text-(--foreground)">{row.label}</div>
            <div className="text-sm text-(--foreground-secondary) tabular-nums">
              {row.remainingPercent}%
            </div>
            <div className="text-sm text-(--foreground-secondary) tabular-nums">
              {row.resetsAtLabel ?? "Soon"}
            </div>
          </div>
        ))}
        {quotaResetCredits && onQuotaReset ? (
          <QuotaResetTooltipSection summary={quotaResetCredits} onReset={onQuotaReset} />
        ) : null}
      </div>
    </div>
  );
}

function quotaResetOutcomeMessage(result: CodexRateLimitResetResult): string {
  if (result.outcome === "nothingToReset") {
    return "Your current quota doesn’t need a reset.";
  }
  if (result.outcome === "noCredit") {
    return "No quota resets are available.";
  }

  const remaining = result.account.rateLimitResetCredits?.availableCount ?? 0;
  return `Quota reset. ${remaining} remaining.`;
}

export function QuotaResetTooltipSection({
  summary,
  onReset,
}: {
  summary: CodexRateLimitResetCreditsSummary | null | undefined;
  onReset: (input: CodexRateLimitResetInput) => Promise<CodexRateLimitResetResult>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "status"; text: string } | null>(null);
  const attemptRef = useRef<{ idempotencyKey: string; creditId: string | null } | null>(null);
  const contentId = useId();

  if (!summary) return null;

  const activeCredit = findAvailableQuotaResetCredit(summary);
  const expiration = activeCredit
    ? formatQuotaResetCreditExpiration(activeCredit.expiresAt)
    : summary.availableCount > 0
      ? "Unavailable"
      : "—";

  const handleReset = async () => {
    if (pending || summary.availableCount <= 0) return;

    const attempt = attemptRef.current ?? {
      idempotencyKey: crypto.randomUUID(),
      creditId: activeCredit?.id ?? null,
    };
    attemptRef.current = attempt;
    setPending(true);
    setMessage(null);

    try {
      const result = await onReset({
        idempotencyKey: attempt.idempotencyKey,
        ...(attempt.creditId ? { creditId: attempt.creditId } : {}),
      });
      attemptRef.current = null;
      setMessage({ kind: "status", text: quotaResetOutcomeMessage(result) });
    } catch {
      setMessage({ kind: "error", text: "Couldn’t reset quota. Try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-sm text-left hover:bg-(--foreground)/10 focus-visible:ring-2 focus-visible:ring-(--ring)/35 focus-visible:outline-none py-1 px-0.25"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-(--foreground)">
          {formatQuotaResetAvailability(summary.availableCount)}
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`size-4 shrink-0 text-(--foreground-secondary) transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded ? (
        <div id={contentId} className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-xs">
            <span className="text-(--foreground-tertiary)">Expiry</span>
            <span className="text-(--foreground-secondary) tabular-nums">{expiration}</span>
          </div>
          <button
            type="button"
            disabled={pending || summary.availableCount <= 0}
            className="h-7 rounded-md bg-(--foreground) px-2.5 text-xs font-medium text-(--background) hover:brightness-95 focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none disabled:opacity-40"
            onClick={() => void handleReset()}
          >
            {pending ? "Resetting…" : "Reset quota"}
          </button>
          {message ? (
            <p
              aria-live="polite"
              className={message.kind === "error"
                ? "m-0 text-xs text-(--destructive)"
                : "m-0 text-xs text-(--foreground-secondary)"}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
