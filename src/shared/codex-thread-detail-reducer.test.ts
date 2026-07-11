import { describe, expect, test } from "vitest";
import { mergeCodexTurnSummaries, mergeCodexTurnSummary } from "./codex-thread-detail-reducer";
import type { CodexTurnSummary } from "./types";

function buildTurn(overrides: Partial<CodexTurnSummary> = {}): CodexTurnSummary {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    status: "inProgress",
    itemIds: [],
    ...overrides,
  };
}

describe("codex thread detail reducer", () => {
  test("preserves first work item timing across turn summary merges", () => {
    const existing = buildTurn({
      firstTurnWorkItemStartedAtMs: 123,
      itemIds: ["exec_1"],
    });
    const incoming = buildTurn({
      status: "completed",
      itemIds: ["assistant_1"],
    });

    const merged = mergeCodexTurnSummary(existing, incoming);

    expect(merged.firstTurnWorkItemStartedAtMs ?? 0).toBe(123);
    expect(merged.itemIds.join(",")).toBe("exec_1,assistant_1");
  });

  test("keeps cached first work item timing when refreshing turn lists", () => {
    const merged = mergeCodexTurnSummaries(
      [buildTurn({ status: "completed", itemIds: ["assistant_1"] })],
      [buildTurn({ firstTurnWorkItemStartedAtMs: 456, itemIds: ["exec_1"] })],
    );

    expect(merged.length).toBe(1);
    expect(merged[0]?.firstTurnWorkItemStartedAtMs ?? 0).toBe(456);
    expect(merged[0]?.itemIds.join(",") ?? "").toBe("exec_1,assistant_1");
  });
});
