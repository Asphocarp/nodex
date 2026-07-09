import type { CodexGitSettings } from "./types";

export function isCodexGitSettings(value: unknown): value is CodexGitSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CodexGitSettings>;
  return typeof candidate.branchPrefix === "string"
    && typeof candidate.commitInstructions === "string"
    && typeof candidate.pullRequestInstructions === "string";
}
