import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type {
  CodexCanonicalOptionPickerResponse,
  CodexOptionPickerRequest,
} from "@/lib/types";
import { render, settleAsyncRender } from "@/test/dom";
import { CodexOptionPickerRequestCard } from "./codex-option-picker-request-card";

const request: CodexOptionPickerRequest = {
  type: "optionPicker",
  requestId: "option-picker-1",
  projectId: "project-1",
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "call-option-picker-1",
  question: "Choose the next parity slice",
  options: [
    { label: "Projection", description: "Work on projection." },
    { label: "Surface", description: "Work on the surface." },
  ],
  allowMultiple: false,
  submitLabel: "Continue",
  skipLabel: "Not now",
  createdAt: 1,
};

describe("CodexOptionPickerRequestCard", () => {
  test("submits the selected option and trimmed freeform answer", async () => {
    const responses: CodexCanonicalOptionPickerResponse[] = [];
    const { getByRole, getByLabelText } = render(
      <CodexOptionPickerRequestCard
        request={request}
        onRespond={async (_requestId, response) => {
          responses.push(response);
        }}
      />,
    );
    await settleAsyncRender();

    const submit = getByRole("button", { name: /Continue/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(getByRole("radio", { name: "Projection" }));
      fireEvent.change(getByLabelText("Something else"), { target: { value: "  Keep it flat  " } });
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.click(submit);
      await settleAsyncRender();
    });

    expect(JSON.stringify(responses[0])).toBe(JSON.stringify({
      action: "submit",
      selectedOptions: ["Projection"],
      freeformAnswer: "Keep it flat",
    }));
  });

  test("preserves current answers for skip and clears them for dismiss", async () => {
    const responses: CodexCanonicalOptionPickerResponse[] = [];
    const { container, getByRole, getByLabelText } = render(
      <CodexOptionPickerRequestCard
        request={{ ...request, allowMultiple: true }}
        onRespond={async (_requestId, response) => {
          responses.push(response);
        }}
      />,
    );
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(getByRole("checkbox", { name: "Projection" }));
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.click(getByRole("checkbox", { name: "Surface" }));
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Not now" }));
      await settleAsyncRender();
    });
    expect(JSON.stringify(responses[0])).toBe(JSON.stringify({
      action: "skip",
      selectedOptions: ["Projection", "Surface"],
      freeformAnswer: null,
    }));

    await act(async () => {
      fireEvent.keyDown(container.firstElementChild as HTMLElement, { key: "Escape" });
      await settleAsyncRender();
    });
    expect(JSON.stringify(responses[1])).toBe(JSON.stringify({
      action: "dismiss",
      selectedOptions: [],
      freeformAnswer: null,
    }));

    await act(async () => {
      fireEvent.change(getByLabelText("Something else"), { target: { value: "Freeform" } });
      fireEvent.keyDown(getByLabelText("Something else"), { key: "Enter" });
      await settleAsyncRender();
    });
    expect(responses[2]?.action).toBe("submit");
  });
});
