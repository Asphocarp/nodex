export function formatElapsedSince(updatedAtMs: number, nowMs: number): string {
  const elapsedSeconds = Math.max(Math.floor((nowMs - updatedAtMs) / 1_000), 0);

  if (elapsedSeconds < 60) return "now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;
  if (elapsedDays < 30) return `${Math.floor(elapsedDays / 7)}w`;
  if (elapsedDays < 365) return `${Math.floor(elapsedDays / 30)}mo`;
  return `${Math.floor(elapsedDays / 365)}y`;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Returns the earliest boundary at which `formatElapsedSince` can change. */
export function getNextElapsedTimeUpdateDelay(updatedAtMs: number, nowMs: number): number {
  const elapsedMs = Math.max(nowMs - updatedAtMs, 0);
  let nextElapsedMs: number;

  if (elapsedMs < MINUTE_MS) {
    nextElapsedMs = MINUTE_MS;
  } else if (elapsedMs < HOUR_MS) {
    nextElapsedMs = (Math.floor(elapsedMs / MINUTE_MS) + 1) * MINUTE_MS;
  } else if (elapsedMs < DAY_MS) {
    nextElapsedMs = (Math.floor(elapsedMs / HOUR_MS) + 1) * HOUR_MS;
  } else if (elapsedMs < 7 * DAY_MS) {
    nextElapsedMs = (Math.floor(elapsedMs / DAY_MS) + 1) * DAY_MS;
  } else if (elapsedMs < 30 * DAY_MS) {
    nextElapsedMs = Math.min((Math.floor(elapsedMs / (7 * DAY_MS)) + 1) * 7 * DAY_MS, 30 * DAY_MS);
  } else if (elapsedMs < 365 * DAY_MS) {
    nextElapsedMs = Math.min(
      (Math.floor(elapsedMs / (30 * DAY_MS)) + 1) * 30 * DAY_MS,
      365 * DAY_MS,
    );
  } else {
    nextElapsedMs = (Math.floor(elapsedMs / (365 * DAY_MS)) + 1) * 365 * DAY_MS;
  }

  return Math.min(Math.max(updatedAtMs + nextElapsedMs - nowMs, 1), MAX_TIMEOUT_MS);
}
