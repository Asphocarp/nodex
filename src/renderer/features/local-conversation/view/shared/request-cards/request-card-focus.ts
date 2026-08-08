import type { RequestComposerQuestion } from "./request-card-questionnaire-state";

export type UserInputFocusTarget = "options" | "other" | "answer";

export function resolveUserInputQuestionFocusTarget(
  question: RequestComposerQuestion,
  target: UserInputFocusTarget | null,
): UserInputFocusTarget | null {
  if (target === null) return null;

  if (!question.options?.length) {
    return "answer";
  }

  if (target === "other" || target === "answer") {
    return "other";
  }

  return "options";
}

export function canMoveUserInputFocusToOptionsFromOtherField(
  selectionStart: number | null,
  selectionEnd: number | null,
): boolean {
  if (selectionStart === null || selectionEnd === null) return false;
  return selectionStart === 0 && selectionEnd === 0;
}
