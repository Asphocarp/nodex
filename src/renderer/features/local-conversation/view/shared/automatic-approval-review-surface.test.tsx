import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { render, textContent } from "../../../../test/dom";
import { AutomaticApprovalReviewSurface } from "./automatic-approval-review-surface";

function buildReviewItem(overrides?: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-review",
    entryId: "item-review",
    type: "automaticApprovalReview",
    kind: "systemEvent",
    semanticKind: "automaticApprovalReview",
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    rawItem: {
      targetItemId: "item-command",
      review: {
        status: "approved",
        riskScore: 0.11,
        riskLevel: "low",
        rationale: "Only local tests are executed.",
      },
      action: {
        type: "commandExecution",
        command: "bun test",
      },
    },
    ...overrides,
  };
}

describe("AutomaticApprovalReviewSurface", () => {
  test("renders the Codex-style compact header and expandable rationale", () => {
    const item = buildReviewItem();
    const { getByRole, container } = render(<AutomaticApprovalReviewSurface item={item} />);

    const trigger = getByRole("button");
    const summary = textContent(trigger);
    expect(summary.includes("Automatic approval review")).toBeTrue();
    expect(summary.includes("Approved")).toBeTrue();
    expect(summary.includes("Low risk")).toBeTrue();
    expect(summary.includes("Only local tests are executed.")).toBeFalse();

    fireEvent.click(trigger);
    expect(textContent(container).includes("Only local tests are executed.")).toBeTrue();
  });

  test("uses the Codex fallback copy while the review is in progress", () => {
    const item = buildReviewItem({
      status: "inProgress",
      rawItem: {
        targetItemId: "item-command",
        review: {
          status: "inProgress",
          riskScore: 0.45,
          riskLevel: "medium",
          rationale: null,
        },
        action: {
          type: "commandExecution",
          command: "bun test",
        },
      },
    });

    const { container } = render(<AutomaticApprovalReviewSurface item={item} />);
    const content = textContent(container);
    expect(content.includes("Reviewing")).toBeTrue();
    expect(content.includes("Medium risk")).toBeTrue();
    expect(content.includes("carefully prompted reviewer agent is reviewing this request")).toBeFalse();
  });
});
