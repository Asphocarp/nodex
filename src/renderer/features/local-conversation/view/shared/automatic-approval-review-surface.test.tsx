import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexConversationItem } from "../../../../lib/types";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { AutomaticApprovalReviewRow, AutomaticApprovalReviewSurface } from "./automatic-approval-review-surface";

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
        type: "command",
        source: "shell",
        command: "bun test",
        cwd: "/tmp/project",
      },
    },
    ...overrides,
  };
}

describe("AutomaticApprovalReviewSurface", () => {
  test("renders the standalone action activity with the compact review row nested inside", async () => {
    const item = buildReviewItem();
    const { getByRole, container } = render(<AutomaticApprovalReviewSurface item={item} />);

    const trigger = getByRole("button");
    const summary = textContent(trigger);
    expect(summary.includes("bun test")).toBeTrue();
    expect(summary.includes("Auto-review approved")).toBeFalse();
    expect(summary.includes("Automatic approval review")).toBeFalse();
    expect(summary.includes("Low risk")).toBeFalse();
    expect(summary.includes("Only local tests are executed.")).toBeFalse();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    await settleAsyncRender();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const reviewTrigger = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"))
      .find((button) => textContent(button).includes("Auto-review approved")) ?? null;
    expect(reviewTrigger === null).toBeFalse();
    expect(reviewTrigger?.getAttribute("aria-expanded") ?? "").toBe("false");

    fireEvent.click(reviewTrigger as HTMLButtonElement);
    await settleAsyncRender();
    expect(textContent(container).includes("Only local tests are executed.")).toBeTrue();
  });

  test("uses the request fallback summary and nests the high-risk denied title", async () => {
    const item = buildReviewItem({
      rawItem: {
        targetItemId: "item-command",
        review: {
          status: "denied",
          riskScore: 0.9,
          riskLevel: "high",
          rationale: "The request edits outside the workspace.",
        },
        action: null,
      },
    });

    const { getByRole, container } = render(<AutomaticApprovalReviewSurface item={item} />);
    const trigger = getByRole("button");
    const summary = textContent(trigger);
    expect(summary.includes("Request")).toBeTrue();
    expect(summary.includes("Auto-review denied high risk")).toBeFalse();
    expect(summary.includes("High risk")).toBeFalse();

    fireEvent.click(trigger);
    await settleAsyncRender();

    const body = textContent(container);
    expect(body.includes("Auto-review denied high risk")).toBeTrue();
    expect(body.includes("High risk")).toBeFalse();
  });

  test("keeps the reviewed action in the standalone header while the review is in progress", async () => {
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
          type: "command",
          source: "shell",
          command: "bun test",
          cwd: "/tmp/project",
        },
      },
    });

    const { getByRole, container } = render(<AutomaticApprovalReviewSurface item={item} />);
    const trigger = getByRole("button");
    const content = textContent(trigger);
    expect(content.includes("bun test")).toBeTrue();
    expect(content.includes("Auto-reviewing")).toBeFalse();
    expect(content.includes("Medium risk")).toBeFalse();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    await settleAsyncRender();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(textContent(container).includes("Auto-reviewing")).toBeTrue();
    expect(textContent(container).includes("Medium risk")).toBeFalse();
  });

  test("renders the compact non-expandable branch as title text only", () => {
    const item = buildReviewItem();
    const { container, queryByRole } = render(<AutomaticApprovalReviewRow item={item} isExpandable={false} />);

    expect(queryByRole("button") === null).toBeTrue();
    expect(textContent(container).includes("Auto-review approved")).toBeTrue();
    expect(textContent(container).includes("Only local tests are executed.")).toBeFalse();
  });
});
