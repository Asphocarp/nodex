import { describe, expect, test } from "vite-plus/test";
import type { RequestComposerQuestion } from "./request-card-questionnaire-state";
import {
  canMoveUserInputFocusToOptionsFromOtherField,
  resolveUserInputQuestionFocusTarget,
} from "./request-card-focus";

const optionQuestion: RequestComposerQuestion = {
  id: "q_option",
  header: "Choose one",
  question: "Which option should Codex use?",
  isOther: true,
  isSecret: false,
  options: [{ label: "First", description: "Use the first option." }],
};

const freeformQuestion: RequestComposerQuestion = {
  id: "q_freeform",
  header: "More context",
  question: "Tell Codex what to change next",
  isOther: false,
  isSecret: false,
  options: undefined,
};

describe("request card focus rules", () => {
  test("maps a preserved focus target onto the next question shape", () => {
    expect(resolveUserInputQuestionFocusTarget(optionQuestion, "options")).toBe("options");
    expect(resolveUserInputQuestionFocusTarget(optionQuestion, "answer")).toBe("other");
    expect(resolveUserInputQuestionFocusTarget(freeformQuestion, "options")).toBe("answer");
    expect(resolveUserInputQuestionFocusTarget(freeformQuestion, null)).toBe(null);
  });

  test("allows arrow-up escape only when the caret is at the start", () => {
    expect(canMoveUserInputFocusToOptionsFromOtherField(0, 0)).toBe(true);
    expect(canMoveUserInputFocusToOptionsFromOtherField(1, 1)).toBe(false);
    expect(canMoveUserInputFocusToOptionsFromOtherField(0, 2)).toBe(false);
    expect(canMoveUserInputFocusToOptionsFromOtherField(null, null)).toBe(false);
  });
});
