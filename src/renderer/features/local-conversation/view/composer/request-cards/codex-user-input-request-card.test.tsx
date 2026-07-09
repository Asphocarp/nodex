import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { CodexUserInputRequest } from "@/lib/types";
import { render, settleAsyncRender } from "@/test/dom";
import { CodexUserInputRequestCard } from "./codex-user-input-request-card";

const ordinaryRequest: CodexUserInputRequest = {
  type: "userInput",
  requestId: "ordinary-input",
  projectId: "project-1",
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "ordinary-input-item",
  questions: [{
    id: "scope",
    header: "Scope",
    question: "Which scope should Codex use?",
    isOther: false,
    options: [
      { label: "Focused", description: "Change only the selected surface." },
      { label: "Broad", description: "Refactor the full request lane." },
    ],
  }],
  createdAt: 1,
};

describe("CodexUserInputRequestCard", () => {
  test("forces the Other path and empty-response dismiss for onboarding dynamic input", async () => {
    const log: string[] = [];
    const { getByPlaceholderText, getByText } = render(
      <TooltipProvider>
        <CodexUserInputRequestCard
          request={{
            ...ordinaryRequest,
            requestId: "onboarding-input",
            isOnboardingDynamicInput: true,
          }}
          onRespond={async (requestId, answers) => {
            log.push(`respond:${requestId}:${JSON.stringify(answers)}`);
          }}
          onInterrupt={async () => {
            log.push("interrupt");
          }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect((getByPlaceholderText("Something else") as HTMLTextAreaElement).value).toBe("");
    await act(async () => {
      fireEvent.click(getByText("Dismiss"));
      await settleAsyncRender();
    });

    expect(JSON.stringify(log)).toBe(JSON.stringify([
      "respond:onboarding-input:{}",
    ]));
  });

  test("interrupts ordinary input on dismiss unless auto-resolution owns the empty reply", async () => {
    const log: string[] = [];
    const { getByText, unmount } = render(
      <TooltipProvider>
        <CodexUserInputRequestCard
          request={ordinaryRequest}
          onRespond={async () => {
            log.push("respond");
          }}
          onInterrupt={async () => {
            log.push("interrupt");
          }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(getByText("Dismiss"));
      await settleAsyncRender();
    });
    expect(JSON.stringify(log)).toBe(JSON.stringify(["interrupt"]));
    unmount();

    const autoResolved = render(
      <TooltipProvider>
        <CodexUserInputRequestCard
          request={{ ...ordinaryRequest, autoResolutionMs: 60_000 }}
          onRespond={async (_requestId, answers) => {
            log.push(`auto:${JSON.stringify(answers)}`);
          }}
          onInterrupt={async () => {
            log.push("unexpected-interrupt");
          }}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();
    await act(async () => {
      fireEvent.click(autoResolved.getByText("Dismiss"));
      await settleAsyncRender();
    });

    expect(JSON.stringify(log)).toBe(JSON.stringify([
      "interrupt",
      "auto:{}",
    ]));
  });
});
