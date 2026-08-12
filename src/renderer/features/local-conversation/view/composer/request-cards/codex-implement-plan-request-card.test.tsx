import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { render } from "@/test/dom";
import type { CodexPlanImplementationRequest } from "@/lib/types";
import { CodexImplementPlanRequestCard } from "./codex-implement-plan-request-card";

const request: CodexPlanImplementationRequest = {
  type: "implementPlan",
  requestId: "implement-plan:turn-plan",
  projectId: "project-1",
  threadId: "thread-1",
  turnId: "turn-plan",
  itemId: "plan-item",
  planContent: "1. Review\n2. Ship",
  createdAt: 1,
};

describe("CodexImplementPlanRequestCard", () => {
  test("implements once after the choice acknowledgement window", async () => {
    vi.useFakeTimers();
    try {
      const responses: string[] = [];
      const view = render(
        <CodexImplementPlanRequestCard
          request={request}
          onRespond={async (response) => {
            responses.push(response.type);
          }}
        />,
      );

      await act(async () => {
        const option = view.getByRole("radio", {
          name: "Yes, implement this plan",
        });
        fireEvent.click(option);
        fireEvent.click(option);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(179);
      });
      expect(responses).toEqual([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
      });
      expect(responses).toEqual(["implement"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("submits a freeform follow-up on Enter", async () => {
    const responses: string[] = [];
    const view = render(
      <CodexImplementPlanRequestCard
        request={request}
        onRespond={async (response) => {
          responses.push(
            response.type === "followUp"
              ? `followUp:${response.prompt}`
              : response.type,
          );
        }}
      />,
    );
    const input = view.getByPlaceholderText(
      "No, and tell Codex what to do differently",
    );

    await act(async () => {
      fireEvent.change(input, {
        target: { value: "Revise step two" },
      });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
    });

    expect(responses).toEqual(["followUp:Revise step two"]);
  });

  test("keeps a failed dismissal retryable with plan-specific guidance", async () => {
    const view = render(
      <CodexImplementPlanRequestCard
        request={request}
        onRespond={async () => {
          throw new Error("Internal settings failure");
        }}
      />,
    );

    await act(async () => {
      const form = view.container.querySelector("form");
      if (!form) throw new Error("Expected plan request form");
      fireEvent.keyDown(form, { key: "Escape" });
      await Promise.resolve();
    });

    expect(await view.findByText("Could not dismiss plan — try again")).toBeTruthy();
    expect(view.getByRole("radio", { name: "Yes, implement this plan" })).toBeTruthy();
  });
});
