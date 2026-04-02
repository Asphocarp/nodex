import type { CodexReasoningEffort } from "../../shared/types";
import { sanitizeCodexThreadTitlePrompt } from "../../shared/codex-thread-title";

export const THREAD_TITLE_MIN_LENGTH = 18;
export const THREAD_TITLE_MAX_LENGTH = 36;
export const THREAD_TITLE_TIMEOUT_MS = 30_000;
export const THREAD_TITLE_MODEL = "gpt-5.1-codex-mini";
export const THREAD_TITLE_REASONING_EFFORT: CodexReasoningEffort = "low";
export const THREAD_TITLE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: {
      type: "string",
      minLength: THREAD_TITLE_MIN_LENGTH,
      maxLength: THREAD_TITLE_MAX_LENGTH,
    },
  },
};

const THREAD_TITLE_INSTRUCTIONS = [
  "Generate a concise thread title for the user's request.",
  "Return JSON that matches the provided schema.",
  "The title must describe the concrete technical task.",
  "Do not use surrounding quotes or markdown.",
  "Do not mention Codex, assistant, thread, chat, or conversation.",
  "Prefer imperative or noun-phrase titles that would work in a sidebar.",
  "Keep the meaning specific even when the request contains multiple details.",
].join("\n");

export function buildThreadTitleGenerationPrompt(userPrompt: string): string {
  const normalizedPrompt = sanitizeCodexThreadTitlePrompt(userPrompt);
  if (!normalizedPrompt) {
    return "";
  }

  return `${THREAD_TITLE_INSTRUCTIONS}\n\nUser request:\n${normalizedPrompt}`;
}

export function normalizeGeneratedThreadTitle(rawTitle: string): string | null {
  let title = (rawTitle.replace(/\r\n/g, "\n").split("\n").find((line) => line.trim().length > 0) ?? "").trim();
  if (!title) return null;

  title = title.replace(/^title[:\s]+/i, "");
  title = title.replace(/^[`"'\u201c\u201d\u2018\u2019]+|[`"'\u201c\u201d\u2018\u2019]+$/g, "");
  title = title.replace(/\s+/g, " ").trim();
  title = title.replace(/[.?!]+$/g, "").trim();
  if (!title) return null;
  if (title.length < THREAD_TITLE_MIN_LENGTH) return null;
  if (title.length > THREAD_TITLE_MAX_LENGTH) {
    return `${title.slice(0, THREAD_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
  }
  return title;
}

export function parseGeneratedThreadTitleResponse(raw: string | null | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return normalizeGeneratedThreadTitle(text);
    }

    const candidate = parsed as { title?: unknown };
    if (typeof candidate.title !== "string") {
      return normalizeGeneratedThreadTitle(text);
    }
    return normalizeGeneratedThreadTitle(candidate.title);
  } catch {
    return normalizeGeneratedThreadTitle(text);
  }
}
