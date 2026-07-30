export function normalizeElementSize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function readResizeObserverBorderBoxSize(
  entry: ResizeObserverEntry,
): { height: number; width: number } {
  const borderBoxSize = entry.borderBoxSize;
  const borderBox = Array.isArray(borderBoxSize)
    ? borderBoxSize[0]
    : borderBoxSize;
  if (borderBox) {
    return {
      height: normalizeElementSize(borderBox.blockSize),
      width: normalizeElementSize(borderBox.inlineSize),
    };
  }
  return {
    height: normalizeElementSize(entry.contentRect.height),
    width: normalizeElementSize(entry.contentRect.width),
  };
}
