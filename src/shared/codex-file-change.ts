import type {
  CodexFileChange,
  CodexFileChangeKind,
  CodexFileChangeMap,
  CodexFileChangePatch,
  CodexItemStatus,
  CodexTurnDiffPatchBatch,
} from "./types";

function normalizeText(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function normalizeContentLines(value: string): string[] {
  const normalized = normalizeText(value);
  const lines = normalized.split("\n");
  return lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
}

export function buildCodexFileChangeFromProtocol(input: {
  path: string;
  kind: CodexFileChangeKind;
  diff: string;
  movePath?: string | null;
}): CodexFileChange | null {
  const path = input.path.trim();
  if (path.length === 0) return null;

  if (input.kind === "add") {
    return {
      path,
      type: "add",
      content: input.diff,
    };
  }

  if (input.kind === "delete") {
    return {
      path,
      type: "delete",
      content: input.diff,
    };
  }

  return {
    path,
    type: "update",
    unifiedDiff: normalizeText(input.diff),
    movePath: input.movePath ?? null,
  };
}

export function toCodexFileChangePatch(change: CodexFileChange): CodexFileChangePatch {
  if (change.type === "add") {
    return {
      type: "add",
      content: change.content,
    };
  }

  if (change.type === "delete") {
    return {
      type: "delete",
      content: change.content,
    };
  }

  return {
    type: "update",
    unifiedDiff: change.unifiedDiff,
    movePath: change.movePath,
  };
}

export function materializeCodexFileChange(path: string, change: CodexFileChangePatch): CodexFileChange {
  if (change.type === "add") {
    return {
      path,
      type: "add",
      content: change.content,
    };
  }

  if (change.type === "delete") {
    return {
      path,
      type: "delete",
      content: change.content,
    };
  }

  return {
    path,
    type: "update",
    unifiedDiff: change.unifiedDiff,
    movePath: change.movePath,
  };
}

export function buildCodexFileChangeMap(changes: readonly CodexFileChange[]): CodexFileChangeMap {
  const map: CodexFileChangeMap = {};
  for (const change of changes) {
    map[change.path] = toCodexFileChangePatch(change);
  }
  return map;
}

export function isCodexFileChangePatch(value: unknown): value is CodexFileChangePatch {
  if (typeof value !== "object" || value === null) return false;
  const patch = value as Partial<CodexFileChangePatch>;
  if (patch.type === "add" || patch.type === "delete") return typeof patch.content === "string";
  if (patch.type === "update") return typeof patch.unifiedDiff === "string";
  return false;
}

export function getCodexFileChangeEntries(
  changes: CodexFileChangeMap | null | undefined,
): Array<[string, CodexFileChangePatch]> {
  if (!changes) return [];
  if (Array.isArray(changes)) return [];
  return Object.entries(changes)
    .filter((entry): entry is [string, CodexFileChangePatch] =>
      entry[0].trim().length > 0 && isCodexFileChangePatch(entry[1])
    );
}

export function hasCodexFileChangeEntries(
  changes: CodexFileChangeMap | null | undefined,
): boolean {
  return getCodexFileChangeEntries(changes).length > 0;
}

export function getCodexFileChangeList(
  changes: CodexFileChangeMap | null | undefined,
): CodexFileChange[] {
  return getCodexFileChangeEntries(changes).map(([path, change]) => materializeCodexFileChange(path, change));
}

export function resolveCodexPatchSuccess(status: CodexItemStatus | undefined): boolean | null {
  if (status === "completed") return true;
  if (status === "failed" || status === "declined") return false;
  return null;
}

export function buildCodexFileChangeUnifiedDiff(change: CodexFileChange): string | null;
export function buildCodexFileChangeUnifiedDiff(path: string, change: CodexFileChangePatch): string | null;
export function buildCodexFileChangeUnifiedDiff(
  pathOrChange: string | CodexFileChange,
  maybeChange?: CodexFileChangePatch,
): string | null {
  const path = typeof pathOrChange === "string" ? pathOrChange : pathOrChange.path;
  const change = typeof pathOrChange === "string" ? maybeChange : toCodexFileChangePatch(pathOrChange);
  if (!change) return null;

  if (change.type === "update") {
    const previousPath = path;
    const currentPath = change.movePath ?? path;
    const unifiedDiff = change.unifiedDiff.trimStart();
    const hasFileHeaders = /\n?---\s/.test(unifiedDiff);
    const hasDiffGitHeader = /^diff --git /m.test(unifiedDiff);
    const patch = hasFileHeaders
      ? unifiedDiff
      : `--- a/${previousPath}\n+++ b/${currentPath}\n${unifiedDiff}`;
    return `${hasDiffGitHeader ? "" : `diff --git a/${previousPath} b/${currentPath}\n`}${patch}`;
  }

  const lines = normalizeContentLines(change.content);
  const lineCount = lines.length;

  if (change.type === "add") {
    const additions = lines.map((line) => `+${line}`).join("\n");
    const hunk = lineCount > 0 ? `@@ -0,0 +1,${lineCount} @@\n${additions}\n` : "";
    return [
      `diff --git a/${path} b/${path}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${path}`,
      hunk,
    ].filter(Boolean).join("\n");
  }

  const deletions = lines.map((line) => `-${line}`).join("\n");
  const hunk = lineCount > 0 ? `@@ -1,${lineCount} +0,0 @@\n${deletions}\n` : "";
  return [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    `--- a/${path}`,
    "+++ /dev/null",
    hunk,
  ].filter(Boolean).join("\n");
}

export function isCodexFileChange(value: unknown): value is CodexFileChange {
  if (typeof value !== "object" || value === null) return false;
  const change = value as Partial<CodexFileChange>;
  if (typeof change.path !== "string" || change.path.trim().length === 0) return false;
  if (change.type === "add" || change.type === "delete") return typeof change.content === "string";
  if (change.type === "update") return typeof change.unifiedDiff === "string" && change.unifiedDiff.trim().length > 0;
  return false;
}

function buildPatchMergeKey(cwd: string | null | undefined, path: string): string {
  return `${cwd ?? ""}\0${path}`;
}

function extractHunksForAppend(diff: string): string | null {
  const trimmed = diff.trimStart();
  if (trimmed.startsWith("@@")) return trimmed;

  const hunkStart = trimmed.indexOf("\n@@");
  if (hunkStart === -1) return null;
  return trimmed.slice(hunkStart + 1);
}

function normalizePatchSection(diff: string): string | null {
  const normalized = normalizeText(diff).trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildCodexTurnDiffFromPatchBatches(
  patchBatches: readonly CodexTurnDiffPatchBatch[],
): string {
  const sections: string[] = [];
  const updateSectionIndexByPath = new Map<string, number>();

  for (const batch of patchBatches) {
    const cwd = typeof batch.cwd === "string" && batch.cwd.trim().length > 0 ? batch.cwd : null;
    for (const change of batch.changes) {
      if (!isCodexFileChange(change)) continue;

      const section = normalizePatchSection(buildCodexFileChangeUnifiedDiff(change) ?? "");
      if (!section) continue;

      const mergeKey = buildPatchMergeKey(cwd, change.path);
      const canMergeUpdate = change.type === "update" && change.movePath == null;
      if (!canMergeUpdate) {
        updateSectionIndexByPath.delete(mergeKey);
        if (change.type === "update" && change.movePath) {
          updateSectionIndexByPath.delete(buildPatchMergeKey(cwd, change.movePath));
        }
        sections.push(section);
        continue;
      }

      const existingIndex = updateSectionIndexByPath.get(mergeKey);
      if (existingIndex === undefined) {
        updateSectionIndexByPath.set(mergeKey, sections.length);
        sections.push(section);
        continue;
      }

      const hunks = extractHunksForAppend(section);
      if (!hunks) {
        sections[existingIndex] = section;
        continue;
      }
      sections[existingIndex] = `${sections[existingIndex]?.trimEnd() ?? ""}\n${hunks}`;
    }
  }

  const diff = sections.filter((section) => section.trim().length > 0).join("\n\n");
  return diff.length > 0 ? `${diff}\n` : "";
}
