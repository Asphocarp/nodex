import { z } from "zod";
import type { CodexUserInputRequest } from "../../../../../lib/types";

type CodexUserInputQuestion = CodexUserInputRequest["questions"][number];
export type RequestComposerQuestion = CodexUserInputQuestion & { otherPlaceholder?: string };
export type RequestComposerRequest = {
  requestId: string;
  questions: RequestComposerQuestion[];
};

export type UserInputComposerMode = "option" | "other";

export interface UserInputComposerState {
  drafts: Record<string, string>;
  modes: Record<string, UserInputComposerMode>;
  selectedOptions: Record<string, string>;
}

const UserInputComposerModeSchema = z.enum(["option", "other"]);

export function createInitialUserInputComposerState(
  request: RequestComposerRequest,
): UserInputComposerState {
  return request.questions.reduce<UserInputComposerState>(
    (acc, question) => {
      const firstOption = question.options?.[0]?.label ?? "";
      acc.drafts[question.id] = "";
      acc.modes[question.id] = question.options?.length ? "option" : "other";
      acc.selectedOptions[question.id] = firstOption;
      return acc;
    },
    {
      drafts: {},
      modes: {},
      selectedOptions: {},
    },
  );
}

function normalizeFreeformAnswer(value: string): string[] {
  const trimmed = value.trim();
  return trimmed ? [trimmed] : [];
}

export function buildUserInputAnswers(
  request: RequestComposerRequest,
  state: UserInputComposerState,
): Record<string, string[]> {
  return request.questions.reduce<Record<string, string[]>>((acc, question) => {
    const draft = state.drafts[question.id] ?? "";
    const selectedOption = state.selectedOptions[question.id] ?? question.options?.[0]?.label ?? "";
    const mode = state.modes[question.id] ?? (question.options?.length ? "option" : "other");

    if (!question.options?.length) {
      acc[question.id] = normalizeFreeformAnswer(draft);
      return acc;
    }

    if (mode === "other") {
      acc[question.id] = normalizeFreeformAnswer(draft);
      return acc;
    }

    acc[question.id] = selectedOption ? [selectedOption] : [];
    return acc;
  }, {});
}

export function createUserInputComposerStateSchema(
  request: RequestComposerRequest,
) {
  return z.object({
    drafts: z.record(z.string(), z.string()),
    modes: z.record(z.string(), UserInputComposerModeSchema),
    selectedOptions: z.record(z.string(), z.string()),
  }).superRefine((state, ctx) => {
    const answersByQuestion = buildUserInputAnswers(request, state);

    for (const question of request.questions) {
      const answers = answersByQuestion[question.id] ?? [];
      if (answers.length > 0) continue;

      const issuePath = question.options?.length
        ? state.modes[question.id] === "other"
          ? ["drafts", question.id]
          : ["selectedOptions", question.id]
        : ["drafts", question.id];

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issuePath,
        message: "Enter a response before submitting.",
      });
    }
  });
}

export function isUserInputComposerSubmittable(
  request: RequestComposerRequest,
  state: UserInputComposerState,
): boolean {
  return createUserInputComposerStateSchema(request).safeParse(state).success;
}
