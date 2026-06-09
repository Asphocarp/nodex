export type ThreadWorkedForStatus = "working" | "worked";

export interface ThreadWorkedForTiming {
  status: ThreadWorkedForStatus;
  startedAtMs: number;
  completedAtMs: number | null;
}

export function formatWorkedForTimeLabel(durationMs: number): string | null {
  if (!Number.isFinite(durationMs)) return null;

  const totalSeconds = Math.floor(Math.max(durationMs, 0) / 1000);
  if (totalSeconds < 1) return null;
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor(totalSeconds / 3600);
  const hoursPart = hours % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0 || hours > 0) {
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    parts.push(`${hoursPart}h`, `${minutes}m`, `${seconds}s`);
    return parts.join(" ");
  }

  return `${minutes}m ${seconds}s`;
}

export function resolveWorkedForElapsedMs(
  timing: ThreadWorkedForTiming,
  nowMs: number,
): number {
  return Math.max((timing.completedAtMs ?? nowMs) - timing.startedAtMs, 0);
}

export function resolveWorkedForLabelText(
  input: {
    timing: ThreadWorkedForTiming | null;
    durationMs: number | null;
    fallbackTimeLabel?: string | null;
    nowMs?: number;
  },
): string | null {
  if (input.timing) {
    const elapsedMs = resolveWorkedForElapsedMs(input.timing, input.nowMs ?? Date.now());
    if (input.timing.status === "working") {
      if (elapsedMs < 1000) return "Working";
      const timeLabel = formatWorkedForTimeLabel(elapsedMs);
      if (!timeLabel) return "Working";
      return `Working for ${timeLabel}`;
    }

    const timeLabel = formatWorkedForTimeLabel(elapsedMs);
    if (!timeLabel) return null;
    return `Worked for ${timeLabel}`;
  }

  const fallbackTimeLabel = input.fallbackTimeLabel?.trim() ?? "";
  if (fallbackTimeLabel.length > 0) return `Worked for ${fallbackTimeLabel}`;

  if (input.durationMs !== null) {
    const timeLabel = formatWorkedForTimeLabel(input.durationMs);
    if (timeLabel) return `Worked for ${timeLabel}`;
  }

  return null;
}
