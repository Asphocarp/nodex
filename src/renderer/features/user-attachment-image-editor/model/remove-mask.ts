import { isValidImageSize } from "./image-geometry";
import type {
  ImagePoint,
  ImageSize,
  RemoveHistory,
  RemoveMaskDrawingCommand,
  RemoveMaskDrawingPlan,
  RemoveStroke,
} from "./types";

export const IMAGE_REMOVE_BRUSH_DEFAULT = 70;
export const IMAGE_REMOVE_BRUSH_MIN = 5;
export const IMAGE_REMOVE_BRUSH_MAX = 130;
export const IMAGE_REMOVE_BRUSH_STEP = 1;
export const IMAGE_REMOVE_BRUSH_SCALE_DIVISOR = 500;

const EMPTY_REMOVE_HISTORY: RemoveHistory = Object.freeze({
  committed: Object.freeze([]),
  redo: Object.freeze([]),
});

function normalizeBrushSize(brushSize: number): number {
  if (!Number.isFinite(brushSize)) return IMAGE_REMOVE_BRUSH_DEFAULT;
  return Math.min(
    IMAGE_REMOVE_BRUSH_MAX,
    Math.max(IMAGE_REMOVE_BRUSH_MIN, brushSize),
  );
}

export function createRemoveHistory(): RemoveHistory {
  return EMPTY_REMOVE_HISTORY;
}

export function createRemoveStroke(args: {
  brushSize: number;
  point: ImagePoint;
}): RemoveStroke {
  return {
    brushSize: normalizeBrushSize(args.brushSize),
    points: [args.point],
  };
}

export function appendRemoveStrokePoint(
  stroke: RemoveStroke,
  point: ImagePoint,
): RemoveStroke {
  return {
    ...stroke,
    points: [...stroke.points, point],
  };
}

export function commitRemoveStroke(
  history: RemoveHistory,
  stroke: RemoveStroke,
): RemoveHistory {
  if (stroke.points.length === 0) return history;

  return {
    committed: [
      ...history.committed,
      {
        brushSize: normalizeBrushSize(stroke.brushSize),
        points: [...stroke.points],
      },
    ],
    redo: [],
  };
}

export function undoRemoveStroke(history: RemoveHistory): RemoveHistory {
  const stroke = history.committed.at(-1);
  if (stroke === undefined) return history;

  return {
    committed: history.committed.slice(0, -1),
    redo: [...history.redo, stroke],
  };
}

export function redoRemoveStroke(history: RemoveHistory): RemoveHistory {
  const stroke = history.redo.at(-1);
  if (stroke === undefined) return history;

  return {
    committed: [...history.committed, stroke],
    redo: history.redo.slice(0, -1),
  };
}

export function computeRemoveBrushNaturalPixels(args: {
  brushSize: number;
  naturalImageSize: ImageSize | null | undefined;
}): number {
  if (!isValidImageSize(args.naturalImageSize)) return 0;

  return (
    (Math.min(args.naturalImageSize.width, args.naturalImageSize.height) *
      normalizeBrushSize(args.brushSize)) /
    IMAGE_REMOVE_BRUSH_SCALE_DIVISOR
  );
}

export function computeRemoveBrushCssPixels(args: {
  brushSize: number;
  displayedImageWidth: number;
  naturalImageSize: ImageSize | null | undefined;
}): number {
  if (!isValidImageSize(args.naturalImageSize)) return 0;
  if (
    !Number.isFinite(args.displayedImageWidth) ||
    args.displayedImageWidth <= 0
  )
    return 0;

  return (
    (computeRemoveBrushNaturalPixels(args) * args.displayedImageWidth) /
    args.naturalImageSize.width
  );
}

function toNaturalPoint(
  point: ImagePoint,
  naturalImageSize: ImageSize,
): ImagePoint {
  return {
    x: point.x * naturalImageSize.width,
    y: point.y * naturalImageSize.height,
  };
}

function buildStrokeCommands(
  stroke: RemoveStroke,
  naturalImageSize: ImageSize,
): RemoveMaskDrawingCommand[] {
  const lineWidth = computeRemoveBrushNaturalPixels({
    brushSize: stroke.brushSize,
    naturalImageSize,
  });
  const commands: RemoveMaskDrawingCommand[] = [];

  for (let index = 0; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    if (point === undefined) continue;

    const to = toNaturalPoint(point, naturalImageSize);
    const previousPoint = stroke.points[index - 1] ?? point;
    const from = toNaturalPoint(previousPoint, naturalImageSize);
    if (from.x === to.x && from.y === to.y) {
      commands.push({ kind: "circle", center: to, diameter: lineWidth });
      continue;
    }

    commands.push({
      kind: "line",
      from,
      lineCap: "round",
      lineJoin: "round",
      lineWidth,
      to,
    });
  }

  return commands;
}

/** Returns canvas-agnostic commands; the view owns rasterization and PNG encoding. */
export function buildRemoveMaskDrawingPlan(args: {
  naturalImageSize: ImageSize | null | undefined;
  strokes: readonly RemoveStroke[];
}): RemoveMaskDrawingPlan | null {
  if (!isValidImageSize(args.naturalImageSize)) return null;
  const naturalImageSize = args.naturalImageSize;

  return {
    background: "black",
    commands: args.strokes.flatMap((stroke) =>
      buildStrokeCommands(stroke, naturalImageSize),
    ),
    height: naturalImageSize.height,
    mimeType: "image/png",
    strokeColor: "white",
    suggestedFilename: "image-mask.png",
    width: naturalImageSize.width,
  };
}

export function canSubmitRemoveMask(args: {
  history: RemoveHistory;
  isLoading: boolean;
  naturalImageSize: ImageSize | null | undefined;
}): boolean {
  if (args.isLoading) return false;
  if (!isValidImageSize(args.naturalImageSize)) return false;
  return args.history.committed.length > 0;
}
