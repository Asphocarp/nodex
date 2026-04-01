import type { CodexFileChange, CodexFileChangeKind } from "./types";

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
