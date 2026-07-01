import type { CodexCollaborationModeKind } from "@/lib/types";

export function hasPlanMode(modes: readonly { mode: string }[]): boolean {
  return modes.some((mode) => mode.mode === "plan");
}

export function isPlanMode(mode: string | null | undefined): mode is "plan" {
  return mode === "plan";
}

export function hasDefaultMode(modes: readonly { mode: string }[]): boolean {
  return modes.some((mode) => mode.mode === "default");
}

export function resolveNextComposerPlanMode(input: {
  currentMode: CodexCollaborationModeKind;
  modes: readonly { mode: string }[];
}): CodexCollaborationModeKind | null {
  if (!hasPlanMode(input.modes)) {
    return null;
  }
  if (!isPlanMode(input.currentMode)) {
    return "plan";
  }
  return hasDefaultMode(input.modes) ? "default" : null;
}

export function shouldShowComposerPlanKeywordSuggestion(input: {
  prompt: string;
  currentMode: CodexCollaborationModeKind;
  modes: readonly { mode: string }[];
  dismissed: boolean;
}): boolean {
  if (input.dismissed) return false;
  if (!hasPlanMode(input.modes)) return false;
  if (isPlanMode(input.currentMode)) return false;
  return /\bplan\b/iu.test(input.prompt);
}
