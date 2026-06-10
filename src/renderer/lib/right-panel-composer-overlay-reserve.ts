export const RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_VAR =
  "--right-panel-composer-overlay-height";
export const RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR =
  "--right-panel-composer-overlay-reserve";

export const RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_PX = 102;
export const RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX = 118;
export const RIGHT_PANEL_COMPOSER_OVERLAY_DURATION_MS = 120;
export const RIGHT_PANEL_COMPOSER_OVERLAY_TIMER_STEP_MS = 16;

export const RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_FALLBACK_VALUE =
  `var(${RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR}, 1.5rem)`;
export const RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE =
  `var(${RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR}, 0px)`;

export const RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE = {
  paddingBottom: RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
  scrollPaddingBottom: RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
} as const;

export type RightPanelComposerOverlayReserveDirection = "enter" | "exit";

export function clampRightPanelComposerOverlayProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

export function easeRightPanelComposerOverlayReserveProgress({
  direction,
  progress,
}: {
  direction: RightPanelComposerOverlayReserveDirection;
  progress: number;
}): number {
  const clampedProgress = clampRightPanelComposerOverlayProgress(progress);
  if (direction === "enter") return clampedProgress * clampedProgress;

  return 1 - (1 - clampedProgress) ** 2;
}

export function resolveRightPanelComposerOverlayReservePx({
  direction,
  elapsedMs,
  fromPx,
  toPx,
  durationMs = RIGHT_PANEL_COMPOSER_OVERLAY_DURATION_MS,
}: {
  direction: RightPanelComposerOverlayReserveDirection;
  elapsedMs: number;
  fromPx: number;
  toPx: number;
  durationMs?: number;
}): number {
  const rawProgress = durationMs <= 0 ? 1 : elapsedMs / durationMs;
  const easedProgress = easeRightPanelComposerOverlayReserveProgress({
    direction,
    progress: rawProgress,
  });

  return fromPx + (toPx - fromPx) * easedProgress;
}
