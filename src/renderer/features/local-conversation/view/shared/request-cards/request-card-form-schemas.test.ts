import { describe, expect, test } from "vitest";
import {
  buildUserInputAnswers,
  createUserInputComposerStateSchema,
  type RequestComposerRequest,
} from "./request-card-form-schemas";

const request: RequestComposerRequest = {
  requestId: "input_1",
  questions: [
    {
      id: "q_1",
      header: "Need your call",
      question: "What is 1 + 1?",
      isOther: true,
      isSecret: false,
      options: [
        { label: "2 (Recommended)", description: "Matches arithmetic." },
        { label: "3", description: "Marks the previous answer as wrong." },
      ],
    },
    {
      id: "q_2",
      header: "More context",
      question: "Tell Codex what to change next",
      isOther: false,
      isSecret: false,
      options: undefined,
    },
  ],
};

describe("request card form schemas", () => {
  test("accepts valid option + freeform responses", () => {
    const schema = createUserInputComposerStateSchema(request);
    const parsed = schema.safeParse({
      drafts: { q_1: "", q_2: "Focus on the failing type errors." },
      modes: { q_1: "option", q_2: "other" },
      selectedOptions: { q_1: "2 (Recommended)", q_2: "" },
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects unanswered questions", () => {
    const schema = createUserInputComposerStateSchema(request);
    const parsed = schema.safeParse({
      drafts: { q_1: "", q_2: "   " },
      modes: { q_1: "other", q_2: "other" },
      selectedOptions: { q_1: "", q_2: "" },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message ?? "").toBe("Enter a response before submitting.");
  });

  test("builds transcript answers from the selected mode", () => {
    const answers = buildUserInputAnswers(request, {
      drafts: {
        q_1: "Try another approach",
        q_2: "Focus on the failing type errors.",
      },
      modes: {
        q_1: "other",
        q_2: "other",
      },
      selectedOptions: {
        q_1: "2 (Recommended)",
        q_2: "",
      },
    });

    expect(JSON.stringify(answers)).toBe(JSON.stringify({
      q_1: ["Try another approach"],
      q_2: ["Focus on the failing type errors."],
    }));
  });
});
