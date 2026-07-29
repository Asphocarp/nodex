import type { BrowserAnnotationAnchor } from "../../shared/browser-annotation";

export interface BrowserAnnotationEvidenceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BrowserAnnotationEvidenceCropInput {
  anchors: readonly BrowserAnnotationAnchor[];
  imageSize: {
    width: number;
    height: number;
  };
  viewport: {
    width: number;
    height: number;
  };
  padding?: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function computeBrowserAnnotationEvidenceCrop(
  input: BrowserAnnotationEvidenceCropInput,
): BrowserAnnotationEvidenceCrop | null {
  if (input.anchors.length === 0) return null;
  if (
    !isPositiveFinite(input.imageSize.width)
    || !isPositiveFinite(input.imageSize.height)
    || !isPositiveFinite(input.viewport.width)
    || !isPositiveFinite(input.viewport.height)
  ) {
    return null;
  }

  const union = input.anchors.reduce((bounds, anchor) => ({
    left: Math.min(bounds.left, anchor.rect.x),
    top: Math.min(bounds.top, anchor.rect.y),
    right: Math.max(bounds.right, anchor.rect.x + anchor.rect.width),
    bottom: Math.max(bounds.bottom, anchor.rect.y + anchor.rect.height),
  }), {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  });
  const scaleX = input.imageSize.width / input.viewport.width;
  const scaleY = input.imageSize.height / input.viewport.height;
  const padding = Math.max(0, input.padding ?? 24);
  const x = Math.max(0, Math.floor(union.left * scaleX - padding));
  const y = Math.max(0, Math.floor(union.top * scaleY - padding));
  const right = Math.min(
    input.imageSize.width,
    Math.ceil(union.right * scaleX + padding),
  );
  const bottom = Math.min(
    input.imageSize.height,
    Math.ceil(union.bottom * scaleY + padding),
  );
  if (right <= x || bottom <= y) return null;

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}
