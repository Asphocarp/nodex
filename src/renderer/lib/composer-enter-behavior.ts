export type ComposerEnterBehavior = "enter" | "cmdIfMultiline";

export const COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY = "nodex-composer-enter-behavior-v1";
export const DEFAULT_COMPOSER_ENTER_BEHAVIOR: ComposerEnterBehavior = "enter";

export function normalizeComposerEnterBehavior(value: unknown): ComposerEnterBehavior {
  if (value === "enter" || value === "cmdIfMultiline") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "enter") return "enter";
    if (
      normalized === "cmdifmultiline" ||
      normalized === "cmd-if-multiline" ||
      normalized === "cmd_if_multiline" ||
      normalized === "cmd+enter-long-prompts"
    ) {
      return "cmdIfMultiline";
    }
  }

  return DEFAULT_COMPOSER_ENTER_BEHAVIOR;
}

export function readComposerEnterBehavior(): ComposerEnterBehavior {
  try {
    const raw = localStorage.getItem(COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY);
    return normalizeComposerEnterBehavior(raw);
  } catch {
    return DEFAULT_COMPOSER_ENTER_BEHAVIOR;
  }
}

export function writeComposerEnterBehavior(value: ComposerEnterBehavior): ComposerEnterBehavior {
  const normalized = normalizeComposerEnterBehavior(value);
  try {
    localStorage.setItem(COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY, normalized);
  } catch {
    // localStorage may be unavailable.
  }
  return normalized;
}
