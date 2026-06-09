export type ThreadWorkedForStatus = "working" | "completed";

export interface ThreadWorkedForTiming {
  status: ThreadWorkedForStatus;
  startedAtMs: number;
  completedAtMs: number | null;
}

export function formatWorkedForTimeLabel(durationMs: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
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
    const timeLabel = formatWorkedForTimeLabel(elapsedMs);
    if (!timeLabel) return null;

    if (input.timing.status === "working") {
      return elapsedMs >= 1000 ? `Working for ${timeLabel}` : "Working";
    }

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
