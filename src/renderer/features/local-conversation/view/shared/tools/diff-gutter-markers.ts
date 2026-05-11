import type { FileDiffMetadata } from "@pierre/diffs/react";

export type FileChangeGutterKind = "addition" | "deletion" | "modification";
export type FileChangeGutterPlacement = "line" | "before" | "after";

export interface FileChangeLineMarker {
  lineNumber: number;
  kind: FileChangeGutterKind;
  placement: FileChangeGutterPlacement;
  runStart: boolean;
  runEnd: boolean;
}

interface PendingFileChangeLineMarker {
  lineNumber: number;
  kind: FileChangeGutterKind;
  placement: FileChangeGutterPlacement;
}

interface DeletionPlacementInput {
  currentAdditionLine: number;
  hunkAdditionStart: number;
  hasPreviousSurvivingLine: boolean;
}

export function placeDeletionMarker({
  currentAdditionLine,
  hunkAdditionStart,
  hasPreviousSurvivingLine,
}: DeletionPlacementInput): Pick<FileChangeLineMarker, "lineNumber" | "placement"> {
  if (!hasPreviousSurvivingLine || currentAdditionLine <= hunkAdditionStart) {
    return {
      lineNumber: Math.max(1, currentAdditionLine),
      placement: "before",
    };
  }

  return {
    lineNumber: Math.max(1, currentAdditionLine - 1),
    placement: "after",
  };
}

function withRunBoundaries(markers: PendingFileChangeLineMarker[]): FileChangeLineMarker[] {
  const ordered = [...markers].sort((left, right) => {
    if (left.lineNumber !== right.lineNumber) return left.lineNumber - right.lineNumber;
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.placement.localeCompare(right.placement);
  });

  return ordered.map((marker, index) => {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    const continuesPrevious = previous
      && previous.kind === marker.kind
      && previous.placement === marker.placement
      && previous.lineNumber + 1 === marker.lineNumber;
    const continuesNext = next
      && next.kind === marker.kind
      && next.placement === marker.placement
      && marker.lineNumber + 1 === next.lineNumber;

    return {
      ...marker,
      runStart: !continuesPrevious,
      runEnd: !continuesNext,
    };
  });
}

export function buildLineMarkers(fileDiff: FileDiffMetadata): FileChangeLineMarker[] {
  const markers: PendingFileChangeLineMarker[] = [];

  for (const hunk of fileDiff.hunks) {
    let currentAdditionLine = Math.max(1, hunk.additionStart);
    let hasPreviousSurvivingLine = false;

    for (const hunkContent of hunk.hunkContent) {
      if (hunkContent.type === "context") {
        currentAdditionLine += hunkContent.lines.length;
        hasPreviousSurvivingLine = hasPreviousSurvivingLine || hunkContent.lines.length > 0;
        continue;
      }

      if (hunkContent.additions.length > 0) {
        const kind: FileChangeGutterKind = hunkContent.deletions.length > 0 ? "modification" : "addition";
        hunkContent.additions.forEach((_, index) => {
          markers.push({
            lineNumber: currentAdditionLine + index,
            kind,
            placement: "line",
          });
        });
        currentAdditionLine += hunkContent.additions.length;
        hasPreviousSurvivingLine = true;
        continue;
      }

      if (hunkContent.deletions.length === 0) continue;

      markers.push({
        ...placeDeletionMarker({
          currentAdditionLine,
          hunkAdditionStart: Math.max(1, hunk.additionStart),
          hasPreviousSurvivingLine,
        }),
        kind: "deletion",
      });
    }
  }

  return withRunBoundaries(markers);
}

export function groupMarkersByLine(markers: readonly FileChangeLineMarker[]): Map<number, FileChangeLineMarker[]> {
  const grouped = new Map<number, FileChangeLineMarker[]>();

  for (const marker of markers) {
    const current = grouped.get(marker.lineNumber);
    if (current) {
      current.push(marker);
      continue;
    }
    grouped.set(marker.lineNumber, [marker]);
  }

  return grouped;
}

function parseLineNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveColumnLineNumber(element: Element): number | null {
  return parseLineNumber(element.getAttribute("data-column-number"))
    ?? parseLineNumber(element.textContent?.trim() ?? null);
}

function ensureGutter(column: Element): HTMLElement {
  const existing = column.querySelector<HTMLElement>(":scope > [data-file-change-gutter]");
  if (existing) return existing;

  const gutter = document.createElement("span");
  gutter.setAttribute("data-file-change-gutter", "");
  column.prepend(gutter);
  return gutter;
}

function renderMarker(marker: FileChangeLineMarker): HTMLElement {
  const node = document.createElement("span");
  node.setAttribute("data-file-change-kind", marker.kind);
  node.setAttribute("data-file-change-placement", marker.placement);
  if (marker.runStart) node.setAttribute("data-file-change-run-start", "");
  if (marker.runEnd) node.setAttribute("data-file-change-run-end", "");
  return node;
}

export function applyFileChangeGutters(root: Element, markersByLine: ReadonlyMap<number, readonly FileChangeLineMarker[]>): void {
  const columns = root.querySelectorAll<HTMLElement>("[data-column-number]");

  columns.forEach((column) => {
    const lineNumber = resolveColumnLineNumber(column);
    const markers = lineNumber ? markersByLine.get(lineNumber) : undefined;
    const existingGutter = column.querySelector<HTMLElement>(":scope > [data-file-change-gutter]");

    if (!markers || markers.length === 0) {
      existingGutter?.remove();
      column.removeAttribute("data-file-change-gutter-visible");
      return;
    }

    const gutter = ensureGutter(column);
    gutter.replaceChildren(...markers.map(renderMarker));
    column.setAttribute("data-file-change-gutter-visible", "");
  });
}
