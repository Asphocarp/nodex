export interface GeneratedImageGalleryLayout {
  heightPx: number;
  aspectRatio: "natural" | "square";
  maxStartIndex: number;
  overflowCount: number;
  visibleCount: number;
}
/** Exact `eYn` gallery sizing rule from the renderer bundle. */
export function calculateGeneratedImageGalleryLayout(input: {
  containerWidthPx: number | null;
  imageAspectRatios: readonly number[];
  minimumSlotCount?: number;
}): GeneratedImageGalleryLayout {
  const slotCount = input.imageAspectRatios.length;
  const minimumSlotCount = input.minimumSlotCount ?? 0;
  const singleAspectRatio =
    Math.max(slotCount, minimumSlotCount) === 1 ? (input.imageAspectRatios[0] ?? null) : null;
  const heightPx =
    input.containerWidthPx === null
      ? 0
      : singleAspectRatio === null
        ? Math.max((input.containerWidthPx - 24) / 4, 0)
        : input.containerWidthPx / singleAspectRatio;
  const naturalWidth =
    input.imageAspectRatios.reduce((width, ratio) => width + ratio * heightPx, 0) +
    Math.max(slotCount - 1, 0) * 8;

  if (input.containerWidthPx === null || naturalWidth <= input.containerWidthPx) {
    return {
      heightPx,
      aspectRatio: "natural",
      maxStartIndex: 0,
      overflowCount: 0,
      visibleCount: slotCount,
    };
  }

  const visibleCount = Math.min(slotCount, 4);
  const overflowCount = Math.max(slotCount - visibleCount, 0);
  return {
    heightPx,
    aspectRatio: "square",
    maxStartIndex: overflowCount,
    overflowCount,
    visibleCount,
  };
}
