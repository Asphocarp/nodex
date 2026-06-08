import type { CodexAccountSnapshot, CodexRateLimitsSnapshot } from "../../../../lib/types";

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
}: {
  rateLimits: CodexAccountSnapshot["rateLimits"] | undefined;
}) {
  if (!rateLimits) return null;

  const rows = [buildRateLimitRow(rateLimits.primary), buildRateLimitRow(rateLimits.secondary)].filter(
    (row): row is NonNullable<ReturnType<typeof buildRateLimitRow>> => row !== null,
  );
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-(--border) pt-2">
      <div className="text-xs text-(--foreground-tertiary)">Rate limits remaining</div>
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
      </div>
    </div>
  );
}
