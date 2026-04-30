import { describe, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { CodexPlanImplementationRequest, CodexUserInputRequest } from "@/lib/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";

const optionRequest: CodexUserInputRequest = {
  type: "userInput",
  requestId: "input_1",
  projectId: "project_1",
  cardId: "card_1",
  threadId: "thread_1",
  turnId: "turn_1",
  itemId: "item_1",
  createdAt: Date.now(),
  questions: [
    {
      id: "q_1",
      header: "Need your call",
      question: "What is 1 + 1?",
      isOther: true,
      isSecret: false,
      options: [
        { label: "2 (Recommended)", description: "Matches the obvious arithmetic result." },
        { label: "3", description: "Lets Codex know the previous answer was wrong." },
      ],
    },
  ],
};

const optionRequestWithoutOtherFlag: CodexUserInputRequest = {
  ...optionRequest,
  requestId: "input_2",
  questions: optionRequest.questions.map((question) => ({
    ...question,
    isOther: false,
  })),
};

const multiQuestionRequest: CodexUserInputRequest = {
  ...optionRequest,
  requestId: "input_3",
  questions: [
    ...optionRequest.questions,
    {
      id: "q_freeform",
      header: "More context",
      question: "Tell Codex what to change next",
      isOther: false,
      isSecret: false,
      options: undefined,
    },
  ],
};

const planImplementationRequest: CodexPlanImplementationRequest = {
  type: "implementPlan",
  requestId: "implement-plan:turn_plan",
  projectId: "project_1",
  cardId: "card_1",
  threadId: "thread_1",
  turnId: "turn_plan",
  itemId: "plan_item",
  planContent: "1. Review\n2. Ship",
  createdAt: Date.now(),
};

describe("local-conversation request cards", () => {
  test("defaults option questions to the first choice and treats them as submittable", async () => {
    const { buildUserInputAnswers, isUserInputComposerSubmittable } = await import("./local-conversation-request-cards");
    const state = {
      drafts: { q_1: "" },
      modes: { q_1: "option" as const },
      selectedOptions: { q_1: "2 (Recommended)" },
    };

    expect(JSON.stringify(buildUserInputAnswers(optionRequest, state))).toBe(JSON.stringify({ q_1: ["2 (Recommended)"] }));
    expect(isUserInputComposerSubmittable(optionRequest, state)).toBeTrue();
  });

  test("prefers the freeform answer when the other path is active", async () => {
    const { buildUserInputAnswers } = await import("./local-conversation-request-cards");
    const state = {
      drafts: { q_1: "Try again and use a calculator." },
      modes: { q_1: "other" as const },
      selectedOptions: { q_1: "2 (Recommended)" },
    };

    expect(JSON.stringify(buildUserInputAnswers(optionRequest, state))).toBe(
      JSON.stringify({ q_1: ["Try again and use a calculator."] }),
    );
  });

  test("does not render the final freeform row for option questions when isOther is false", async () => {
    const { buildUserInputAnswers, UserInputComposerView } = await import("./local-conversation-request-cards");
    const state = {
      drafts: { q_1: "Choose none of the above and revise the plan." },
      modes: { q_1: "other" as const },
      selectedOptions: { q_1: "2 (Recommended)" },
    };

    expect(JSON.stringify(buildUserInputAnswers(optionRequestWithoutOtherFlag, state))).toBe(
      JSON.stringify({ q_1: ["Choose none of the above and revise the plan."] }),
    );

    const { container } = render(
      <NodexTooltipProvider>
        <UserInputComposerView
          request={optionRequestWithoutOtherFlag}
          onRespond={async () => { }}
        />
      </NodexTooltipProvider>,
    );

    expect(textContent(container).includes("Tell Codex what to do differently")).toBeFalse();
  });

  test("requires text for freeform-only questions before submit is enabled", async () => {
    const { isUserInputComposerSubmittable } = await import("./local-conversation-request-cards");
    const request: CodexUserInputRequest = {
      ...optionRequest,
      questions: [
        {
          id: "q_freeform",
          header: "Input required",
          question: "Tell Codex what to do differently",
          isOther: false,
          isSecret: false,
          options: undefined,
        },
      ],
    };

    expect(
      isUserInputComposerSubmittable(request, {
        drafts: { q_freeform: "" },
        modes: { q_freeform: "other" },
        selectedOptions: { q_freeform: "" },
      }),
    ).toBeFalse();
    expect(
      isUserInputComposerSubmittable(request, {
        drafts: { q_freeform: "Focus on the failing type errors only." },
        modes: { q_freeform: "other" },
        selectedOptions: { q_freeform: "" },
      }),
    ).toBeTrue();
  });

  test("shows a validation error when a freeform question is submitted blank", async () => {
    const { UserInputComposerView } = await import("./local-conversation-request-cards");
    let respondCount = 0;
    const onRespond = async () => {
      respondCount += 1;
    };
    const freeformRequest: CodexUserInputRequest = {
      ...optionRequest,
      requestId: "input_blank",
      questions: [
        {
          id: "q_freeform",
          header: "Input required",
          question: "Tell Codex what to do differently",
          isOther: false,
          isSecret: false,
          options: undefined,
        },
      ],
    };

    const { container } = render(
      <UserInputComposerView
        request={freeformRequest}
        onRespond={onRespond}
      />,
    );

    await act(async () => {
      fireEvent.submit(container.querySelector("form") as HTMLFormElement);
      await settleAsyncRender();
    });

    expect(Boolean(textContent(container).includes("Enter a response before submitting."))).toBeTrue();
    expect(respondCount).toBe(0);
  });

  test("maps preserved focus targets onto the next question shape", async () => {
    const { resolveUserInputQuestionFocusTarget } = await import("./local-conversation-request-cards");

    expect(resolveUserInputQuestionFocusTarget(multiQuestionRequest.questions[0]!, "options")).toBe("options");
    expect(resolveUserInputQuestionFocusTarget(multiQuestionRequest.questions[0]!, "answer")).toBe("other");
    expect(resolveUserInputQuestionFocusTarget(multiQuestionRequest.questions[1]!, "options")).toBe("answer");
    expect(resolveUserInputQuestionFocusTarget(multiQuestionRequest.questions[1]!, null)).toBe(null);
  });

  test("only allows arrow-up escape from the freeform row when the caret is at the start", async () => {
    const { canMoveUserInputFocusToOptionsFromOtherField } = await import("./local-conversation-request-cards");

    expect(canMoveUserInputFocusToOptionsFromOtherField(0, 0)).toBeTrue();
    expect(canMoveUserInputFocusToOptionsFromOtherField(1, 1)).toBeFalse();
    expect(canMoveUserInputFocusToOptionsFromOtherField(0, 2)).toBeFalse();
    expect(canMoveUserInputFocusToOptionsFromOtherField(null, null)).toBeFalse();
  });

  test("renders the composer-style request surface with hover metadata affordance", async () => {
    const { UserInputComposerView } = await import("./local-conversation-request-cards");
    const { container, getByLabelText, getByText } = render(
      <NodexTooltipProvider>
        <UserInputComposerView
          request={optionRequest}
          onRespond={async () => { }}
        />
      </NodexTooltipProvider>,
    );

    expect(getByText("What is 1 + 1?").textContent).toBe("What is 1 + 1?");
    expect(getByText("2 (Recommended)").textContent).toBe("2 (Recommended)");
    expect(getByLabelText("About 2 (Recommended)").getAttribute("aria-label")).toBe("About 2 (Recommended)");
    expect(textContent(container).includes("Tell Codex what to do differently")).toBeTrue();
    expect(container.querySelector('[data-user-input-focus-target="options"]')).not.toBeNull();
    expect(container.querySelector('[data-user-input-focus-target="other"]')).not.toBeNull();
    expect(container.innerHTML.includes("focus-visible:ring-1")).toBeFalse();
    expect(getByText("Dismiss").textContent).toBe("Dismiss");
    expect(getByText("Submit").textContent).toBe("Submit");
  });

  test("dismisses user input requests through the dismiss action", async () => {
    const { UserInputComposerView } = await import("./local-conversation-request-cards");
    const responses: string[] = [];
    const { getByText } = render(
      <NodexTooltipProvider>
        <UserInputComposerView
          request={optionRequest}
          onRespond={async (_requestId, answers) => {
            responses.push(JSON.stringify(answers));
          }}
        />
      </NodexTooltipProvider>,
    );

    await act(async () => {
      fireEvent.click(getByText("Dismiss"));
      await settleAsyncRender();
    });

    expect(responses[0]).toBe("{}");
  });

  test("renders the official plan implementation composer copy", async () => {
    const { PlanImplementationComposerView } = await import("./local-conversation-request-cards");
    const { container, getByText } = render(
      <PlanImplementationComposerView
        request={planImplementationRequest}
        onRespond={async () => { }}
      />,
    );

    expect(getByText("Implement this plan?").textContent).toBe("Implement this plan?");
    expect(getByText("Yes, implement this plan").textContent).toBe("Yes, implement this plan");
    expect(getByText("No, and tell Codex what to do differently").textContent).toBe("No, and tell Codex what to do differently");
    expect(container.querySelector('[data-user-input-focus-target="options"]')).not.toBeNull();
    expect(container.querySelector('[data-user-input-focus-target="other"]')).not.toBeNull();
  });

  test("renders the completed transcript row with an expandable answer list", async () => {
    const { UserInputTranscriptView } = await import("./local-conversation-request-cards");
    const { container, getByRole } = render(
      <UserInputTranscriptView
        item={{
          userInputQuestions: optionRequest.questions,
          userInputAnswers: {
            q_1: ["2 (Recommended)"],
          },
          status: "completed",
        }}
      />,
    );

    const toggle = getByRole("button", { name: /Asked 1 question/i });
    expect(Boolean(textContent(container).includes("Asked 1 question"))).toBeTrue();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      fireEvent.click(toggle);
      await settleAsyncRender();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(Boolean(textContent(container).includes("What is 1 + 1?"))).toBeTrue();
    expect(Boolean(textContent(container).includes("2 (Recommended)"))).toBeTrue();
  });

  test("keeps the completed summary visible even when no answers were recorded", async () => {
    const { UserInputTranscriptView } = await import("./local-conversation-request-cards");
    const { container, getByRole } = render(
      <UserInputTranscriptView
        item={{
          userInputQuestions: optionRequest.questions,
          userInputAnswers: {},
          status: "completed",
        }}
      />,
    );

    const toggle = getByRole("button", { name: /Asked 1 question/i });
    expect(Boolean(textContent(container).includes("Asked 1 question"))).toBeTrue();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      fireEvent.click(toggle);
      await settleAsyncRender();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(Boolean(textContent(container).includes("No answer provided"))).toBeTrue();
  });

  test("renders the in-progress shimmer summary while waiting for answers", async () => {
    const { UserInputTranscriptView } = await import("./local-conversation-request-cards");
    const { container } = render(
      <UserInputTranscriptView
        item={{
          userInputQuestions: optionRequest.questions,
          userInputAnswers: {},
          status: "inProgress",
        }}
      />,
    );

    expect(Boolean(textContent(container).includes("Asking 1 question"))).toBeTrue();
    expect(container.querySelector(".loading-shimmer-pure-text")).not.toBeNull();
  });
});
