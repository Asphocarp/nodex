export interface ShiftWheelDeltaInput {
  shiftKey: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  pageHeight: number;
}

const WHEEL_LINE_HEIGHT_PX = 16;

export const SHIFT_SCROLL_IDLE_SETTLE_DELAY_MS = 500;
export const SHIFT_SCROLL_SETTLE_ANIMATION_MS = 160;
export const SHIFT_SCROLL_WHEEL_DELTA_SCALE = 0.35;

export function normalizeShiftWheelDelta({
  shiftKey,
  deltaX,
  deltaY,
  deltaMode,
  pageHeight,
}: ShiftWheelDeltaInput): number {
  if (!shiftKey) return 0;

  const rawDelta = deltaX !== 0 ? deltaX : deltaY;
  if (rawDelta === 0) return 0;

  if (deltaMode === 1) return rawDelta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === 2 && pageHeight > 0) return rawDelta * pageHeight;
  return rawDelta;
}

export function scaleShiftWheelDelta(deltaPx: number): number {
  if (!Number.isFinite(deltaPx)) return 0;
  return deltaPx * SHIFT_SCROLL_WHEEL_DELTA_SCALE;
}

export function resolveShiftScrollSettleDays(
  targetPx: number,
  dayWidthPx: number,
): number {
  if (!Number.isFinite(targetPx) || targetPx === 0) return 0;
  if (!Number.isFinite(dayWidthPx) || dayWidthPx <= 0) return 0;

  const direction = targetPx > 0 ? 1 : -1;
  return direction * Math.round(Math.abs(targetPx) / dayWidthPx);
}

export function resolveShiftScrollBufferDays(
  targetPx: number,
  dayWidthPx: number,
): number {
  if (!Number.isFinite(targetPx)) return 1;
  if (!Number.isFinite(dayWidthPx) || dayWidthPx <= 0) return 1;

  return Math.max(1, Math.ceil(Math.abs(targetPx) / dayWidthPx) + 1);
}
