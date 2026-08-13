import type {
  CommentEditorLayoutMetrics,
  CommentEditorPlacement,
  ImagePoint,
  ImageSize,
} from "./types";

export const IMAGE_RAIL_WIDTH_PX = 72;
export const IMAGE_VIEWPORT_INLINE_PADDING_PX = 8;
export const IMAGE_RAIL_VIEWPORT_RESERVE_PX =
  IMAGE_RAIL_WIDTH_PX + IMAGE_VIEWPORT_INLINE_PADDING_PX * 2;
export const IMAGE_RAIL_VIEWPORT_CENTER_OFFSET_PX = -IMAGE_RAIL_WIDTH_PX / 2;

export const IMAGE_COMMENT_MARKER_DIAMETER_PX = 30;
export const IMAGE_COMMENT_EDITOR_GAP_PX = 12;
export const IMAGE_COMMENT_EDITOR_INSET_PX = 8;
export const IMAGE_COMMENT_EDITOR_MAX_WIDTH_PX = 294;
export const IMAGE_COMMENT_EDITOR_NEW_HEIGHT_PX = 44;
export const IMAGE_COMMENT_EDITOR_EDIT_HEIGHT_PX = 120;

export const IMAGE_ZOOM_MIN_PERCENT = 10;
export const IMAGE_ZOOM_MAX_PERCENT = 400;
export const IMAGE_ZOOM_WHEEL_FACTOR = 0.01;
export const IMAGE_PINCH_CLICK_SUPPRESSION_MS = 500;

export interface ImageClientRect extends ImageSize {
  left: number;
  top: number;
}

export interface FitZoomOptions {
  hasImageRail?: boolean;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function isValidImageSize(
  size: ImageSize | null | undefined,
): size is ImageSize {
  return (
    size !== null &&
    size !== undefined &&
    isPositiveFinite(size.width) &&
    isPositiveFinite(size.height)
  );
}

export function clampUnitInterval(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function clampImagePoint(point: ImagePoint): ImagePoint {
  return {
    x: clampUnitInterval(point.x),
    y: clampUnitInterval(point.y),
  };
}

export function normalizeImagePoint({
  clientPoint,
  rect,
}: {
  clientPoint: ImagePoint;
  rect: ImageClientRect;
}): ImagePoint | null {
  if (!isValidImageSize(rect)) return null;

  return {
    x: (clientPoint.x - rect.left) / rect.width,
    y: (clientPoint.y - rect.top) / rect.height,
  };
}

export function computeAvailableImageViewportSize(
  viewportSize: ImageSize,
  { hasImageRail = false }: FitZoomOptions = {},
): ImageSize | null {
  if (!isValidImageSize(viewportSize)) return null;

  return {
    height: viewportSize.height,
    width: Math.max(
      viewportSize.width - (hasImageRail ? IMAGE_RAIL_VIEWPORT_RESERVE_PX : 0),
      1,
    ),
  };
}

export function computeFitZoomPercent({
  naturalImageSize,
  viewportSize,
  hasImageRail = false,
}: {
  naturalImageSize: ImageSize | null | undefined;
  viewportSize: ImageSize | null | undefined;
  hasImageRail?: boolean;
}): number | null {
  if (!isValidImageSize(naturalImageSize) || !isValidImageSize(viewportSize))
    return null;

  const availableViewport = computeAvailableImageViewportSize(viewportSize, {
    hasImageRail,
  });
  if (availableViewport === null) return null;

  const scale = Math.min(
    1,
    availableViewport.width / naturalImageSize.width,
    availableViewport.height / naturalImageSize.height,
  );
  if (!isPositiveFinite(scale)) return null;
  return scale * 100;
}

export function computeManualImageSize({
  naturalImageSize,
  zoomPercent,
}: {
  naturalImageSize: ImageSize | null | undefined;
  zoomPercent: number;
}): ImageSize | null {
  if (!isValidImageSize(naturalImageSize)) return null;

  const scale = zoomPercent / 100;
  if (!isPositiveFinite(scale)) return null;

  return {
    height: naturalImageSize.height * scale,
    width: naturalImageSize.width * scale,
  };
}

export function computeCommentEditorLayoutMetrics(args: {
  imageOffsetLeft: number;
  imageOffsetTop: number;
  imageSize: ImageSize;
  parentSize?: ImageSize | null;
  point: ImagePoint;
}): CommentEditorLayoutMetrics | null {
  if (!isValidImageSize(args.imageSize)) return null;

  const parentSize = isValidImageSize(args.parentSize)
    ? args.parentSize
    : args.imageSize;
  return {
    ...args.point,
    editorMaxX:
      parentSize.width - args.imageOffsetLeft - IMAGE_COMMENT_EDITOR_INSET_PX,
    editorMaxY:
      parentSize.height - args.imageOffsetTop - IMAGE_COMMENT_EDITOR_INSET_PX,
    editorMinX: IMAGE_COMMENT_EDITOR_INSET_PX - args.imageOffsetLeft,
    editorMinY: IMAGE_COMMENT_EDITOR_INSET_PX - args.imageOffsetTop,
    surfaceHeight: args.imageSize.height,
    surfaceWidth: args.imageSize.width,
  };
}

/** Prefers right, then left, then below, and finally a clamped position above. */
export function computeCommentEditorPlacement({
  metrics,
  isEditingExistingComment,
}: {
  metrics: CommentEditorLayoutMetrics;
  isEditingExistingComment: boolean;
}): CommentEditorPlacement {
  const anchorX = metrics.x * metrics.surfaceWidth;
  const anchorY = metrics.y * metrics.surfaceHeight;
  const markerOffset =
    IMAGE_COMMENT_MARKER_DIAMETER_PX / 2 + IMAGE_COMMENT_EDITOR_GAP_PX;
  const width = Math.min(
    IMAGE_COMMENT_EDITOR_MAX_WIDTH_PX,
    metrics.editorMaxX - metrics.editorMinX,
  );
  const height = isEditingExistingComment
    ? IMAGE_COMMENT_EDITOR_EDIT_HEIGHT_PX
    : IMAGE_COMMENT_EDITOR_NEW_HEIGHT_PX;
  const maxLeft = metrics.editorMaxX - width;
  const maxTop = metrics.editorMaxY - height;
  const verticallyCenteredTop = Math.min(
    Math.max(anchorY - height / 2, metrics.editorMinY),
    maxTop,
  );
  const right = anchorX + markerOffset;

  if (right <= maxLeft) {
    return { height, left: right, top: verticallyCenteredTop, width };
  }

  const left = anchorX - markerOffset - width;
  if (left >= metrics.editorMinX) {
    return { height, left, top: verticallyCenteredTop, width };
  }

  const horizontallyCenteredLeft = Math.min(
    Math.max(anchorX - width / 2, metrics.editorMinX),
    maxLeft,
  );
  const below = anchorY + markerOffset;
  if (below <= maxTop) {
    return { height, left: horizontallyCenteredLeft, top: below, width };
  }

  return {
    height,
    left: horizontallyCenteredLeft,
    top: Math.max(anchorY - markerOffset - height, metrics.editorMinY),
    width,
  };
}

export function clampImageZoomPercent(zoomPercent: number): number {
  if (!Number.isFinite(zoomPercent)) return IMAGE_ZOOM_MIN_PERCENT;
  return Math.min(
    IMAGE_ZOOM_MAX_PERCENT,
    Math.max(IMAGE_ZOOM_MIN_PERCENT, zoomPercent),
  );
}

export function computeWheelZoomPercent(
  zoomPercent: number,
  deltaY: number,
): number {
  return clampImageZoomPercent(
    Math.round(zoomPercent * Math.exp(-deltaY * IMAGE_ZOOM_WHEEL_FACTOR)),
  );
}

export function computePinchZoomPercent(args: {
  initialDistance: number;
  initialZoomPercent: number;
  nextDistance: number;
}): number {
  if (
    !isPositiveFinite(args.initialDistance) ||
    !isPositiveFinite(args.nextDistance)
  ) {
    return clampImageZoomPercent(args.initialZoomPercent);
  }

  return clampImageZoomPercent(
    Math.round(
      (args.nextDistance / args.initialDistance) * args.initialZoomPercent,
    ),
  );
}

export function computeImagePointDistance(
  from: ImagePoint,
  to: ImagePoint,
): number {
  return Math.hypot(from.x - to.x, from.y - to.y);
}

export function computeZoomAnchorCorrection(args: {
  anchorClientPoint: ImagePoint;
  anchorRatio: ImagePoint;
  nextTargetRect: ImageClientRect;
  windowZoom?: number;
}): ImagePoint {
  const anchorRatio = clampImagePoint(args.anchorRatio);
  const windowZoom = isPositiveFinite(args.windowZoom ?? 1)
    ? (args.windowZoom ?? 1)
    : 1;
  return {
    x: (
      args.nextTargetRect.left +
      args.nextTargetRect.width * anchorRatio.x -
      args.anchorClientPoint.x
    ) / windowZoom,
    y: (
      args.nextTargetRect.top +
      args.nextTargetRect.height * anchorRatio.y -
      args.anchorClientPoint.y
    ) / windowZoom,
  };
}

export function computeZoomViewportCenter(args: {
  direction: "ltr" | "rtl";
  inlineOffset?: number;
  viewportRect: ImageClientRect;
  windowZoom?: number;
}): ImagePoint {
  const windowZoom = isPositiveFinite(args.windowZoom ?? 1)
    ? (args.windowZoom ?? 1)
    : 1;
  const inlineDirection = args.direction === "rtl" ? -1 : 1;
  return {
    x: args.viewportRect.left
      + args.viewportRect.width / 2
      + (args.inlineOffset ?? 0) * windowZoom * inlineDirection,
    y: args.viewportRect.top + args.viewportRect.height / 2,
  };
}
