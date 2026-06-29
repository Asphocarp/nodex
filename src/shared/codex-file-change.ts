import type { CodexFileChange, CodexFileChangeKind, CodexTurnDiffPatchBatch } from "./types";

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

  const unifiedDiff = normalizeText(input.diff).trim();
  if (unifiedDiff.length === 0) return null;
  return {
    path,
    type: "update",
    unifiedDiff,
    movePath: input.movePath ?? null,
  };
}

export function buildCodexFileChangeUnifiedDiff(change: CodexFileChange): string | null {
  if (change.type === "update") {
    const currentPath = change.path;
    const previousPath = change.movePath ?? change.path;
    const unifiedDiff = change.unifiedDiff.trimStart();
    const hasFileHeaders = /\n?---\s/.test(unifiedDiff);
    const hasDiffGitHeader = /^diff --git /m.test(unifiedDiff);
    const patch = hasFileHeaders
      ? unifiedDiff
      : `--- a/${previousPath}\n+++ b/${currentPath}\n${unifiedDiff}`;
    return `${hasDiffGitHeader ? "" : `diff --git a/${previousPath} b/${currentPath}\n`}${patch}`;
  }

  const path = change.path;
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
