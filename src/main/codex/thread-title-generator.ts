import {
  cleanCodexAutoTitlePrompt,
  normalizeCodexGeneratedThreadTitle,
} from "../../shared/codex-thread-title";

export function buildThreadTitleGenerationPrompt(userPrompt: string): string {
  return cleanCodexAutoTitlePrompt(userPrompt);
}

export function parseGeneratedThreadTitleResponse(raw: string | null | undefined): string | null {
  return normalizeCodexGeneratedThreadTitle(raw);
}
