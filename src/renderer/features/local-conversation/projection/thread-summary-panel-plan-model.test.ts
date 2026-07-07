import { describe, expect, test } from "bun:test";
import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import { buildThreadSummaryPanelPlanRow } from "./thread-summary-panel-plan-model";

function buildPlanItem(
  itemId: string,
  markdownText: string,
  semanticKind: CodexConversationItem["semanticKind"] = "proposedPlan",
): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId,
    entryId: itemId,
    type: "plan",
    kind: "plan",
    semanticKind,
    status: "completed",
    role: "assistant",
    markdownText,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildTurn(
  turnId: string,
  status: CodexConversationTurn["status"],
  items: CodexConversationItem[],
): CodexConversationTurn {
  return {
    threadId: "thread-1",
    turnId,
    status,
    itemIds: items.map((item) => item.itemId),
    items: items.map((item) => ({ ...item, turnId })),
  };
}

describe("buildThreadSummaryPanelPlanRow", () => {
  test("builds the latest completed proposed-plan row", () => {
    const row = buildThreadSummaryPanelPlanRow({
      activeThreadId: "thread-1",
      cwd: "/repo/project",
      turns: [
        buildTurn("turn-old", "completed", [
          buildPlanItem("old-plan", "# Old plan\n\n- First"),
        ]),
        buildTurn("turn-new", "completed", [
          buildPlanItem("new-plan", "# Summary panel parity\n\n- Compare reference"),
        ]),
      ],
    });

    expect(row?.label ?? "").toBe("Summary panel parity");
    expect(row?.target.planKey ?? "").toBe("turn-new");
    expect(row?.target.itemId ?? "").toBe("new-plan");
    expect(row?.target.cwd ?? "").toBe("/repo/project");
  });

  test("ignores in-progress turns and todo-list plan updates", () => {
    const row = buildThreadSummaryPanelPlanRow({
      activeThreadId: "thread-1",
      cwd: null,
      turns: [
        buildTurn("turn-todo", "completed", [
          buildPlanItem("todo-plan", "- [ ] Inspect\n- [ ] Implement", "todoList"),
        ]),
        buildTurn("turn-live", "inProgress", [
          buildPlanItem("live-plan", "# Live plan\n\nStill streaming"),
        ]),
      ],
    });

    expect(row === null).toBeTrue();
  });

  test("falls back to the section title when the plan has no h1", () => {
    const row = buildThreadSummaryPanelPlanRow({
      activeThreadId: "thread-1",
      cwd: null,
      turns: [
        buildTurn("turn-plan", "completed", [
          buildPlanItem("plan", "1. Inspect\n2. Implement"),
        ]),
      ],
    });

    expect(row?.label ?? "").toBe("Plan");
  });
});
