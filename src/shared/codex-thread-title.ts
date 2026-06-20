export const CODEX_THREAD_TITLE_PROMPT_MAX_CHARS = 2_000;
export const CODEX_MANUAL_THREAD_TITLE_MAX_CHARS = 60;
const CODEX_REQUEST_MARKER = "## My request for Codex:";

export function cleanCodexAutoTitlePrompt(
  prompt: string,
  maxChars = CODEX_THREAD_TITLE_PROMPT_MAX_CHARS,
): string {
  const parts = prompt.split(CODEX_REQUEST_MARKER);
  const normalizedPrompt = (parts.length <= 1 ? prompt : parts[parts.length - 1] ?? "").trim();
  if (!normalizedPrompt) {
    return "";
  }

  if (normalizedPrompt.length <= maxChars) {
    return normalizedPrompt;
  }

  return normalizedPrompt.slice(0, maxChars).trimEnd();
}

export function normalizeCodexGeneratedThreadTitle(rawTitle: string | null | undefined): string | null {
  const normalizedTitle = rawTitle?.trim() ?? "";
  return normalizedTitle.length === 0 ? null : normalizedTitle;
}

export function normalizeCodexManualThreadTitle(
  rawTitle: string,
  maxChars = CODEX_MANUAL_THREAD_TITLE_MAX_CHARS,
): string | null {
  const normalizedTitle = rawTitle.trim().replace(/\s+/g, " ");
  if (normalizedTitle.length === 0) {
    return null;
  }

  if (normalizedTitle.length <= maxChars) {
    return normalizedTitle;
  }

  return `${normalizedTitle.slice(0, maxChars - 1).trimEnd()}…`;
}

export interface CodexElectronDisplayThreadTitleInput {
  threadName?: string | null;
  threadPreview?: string | null;
  firstUserText?: string | null;
  fallback?: string;
}

export function resolveCodexElectronDisplayThreadTitle(input: CodexElectronDisplayThreadTitleInput): string {
  const explicitTitle = input.threadName?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }

  const derivedTitle = normalizeCodexManualThreadTitle(
    input.firstUserText?.trim() || input.threadPreview?.trim() || "",
  );
  if (derivedTitle) {
    return derivedTitle;
  }

  return input.fallback ?? "Untitled";
}
