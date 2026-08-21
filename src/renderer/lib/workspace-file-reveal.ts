import type { CodeViewScrollTarget, SelectedLineRange } from "@pierre/diffs";
import type { WorkspaceFileRevealLocation } from "@/features/workspace-files/workspace-file-types";

export interface WorkspaceFileEditorSelection {
  readonly start: {
    readonly line: number;
    readonly character: number;
  };
  readonly end: {
    readonly line: number;
    readonly character: number;
  };
  readonly direction: "forward";
}

export function resolveWorkspaceFileRevealRange(
  location: WorkspaceFileRevealLocation | null | undefined,
): SelectedLineRange | null {
  const line = location?.line;
  const endLine = location?.endLine;
  if (!line || !endLine || endLine < line) return null;

  return {
    start: line,
    end: endLine,
  };
}

export function buildWorkspaceFileScrollTarget(
  id: string,
  location: WorkspaceFileRevealLocation | null | undefined,
): CodeViewScrollTarget | null {
  const line = location?.line;
  if (!line) return null;

  const range = resolveWorkspaceFileRevealRange(location);
  if (range) {
    return {
      type: "range",
      id,
      range,
      align: "center",
      behavior: "instant",
    };
  }

  return {
    type: "line",
    id,
    lineNumber: line,
    align: "center",
    behavior: "instant",
  };
}

export function buildWorkspaceFileLineSelection(
  id: string,
  location: WorkspaceFileRevealLocation | null | undefined,
): { id: string; range: SelectedLineRange } | null {
  const range = resolveWorkspaceFileRevealRange(location);
  return range ? { id, range } : null;
}

export function buildWorkspaceFileEditorSelection(
  location: WorkspaceFileRevealLocation | null | undefined,
): WorkspaceFileEditorSelection | null {
  const line = location?.line;
  if (!line) return null;
  if (typeof location.endLine === "number" && location.endLine < line) return null;

  const hasCharacterReveal =
    typeof location.column === "number" ||
    typeof location.endColumn === "number" ||
    typeof location.endLine === "number";
  if (!hasCharacterReveal) return null;

  const endLine = location.endLine ?? line;
  const startCharacter = Math.max(0, (location.column ?? 1) - 1);
  const endCharacter = location.endColumn
    ? Math.max(0, location.endColumn - 1)
    : location.endLine
      ? Number.MAX_SAFE_INTEGER
      : startCharacter;

  return {
    start: {
      line: line - 1,
      character: startCharacter,
    },
    end: {
      line: endLine - 1,
      character: endCharacter,
    },
    direction: "forward",
  };
}
