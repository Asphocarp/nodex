import { describe, expect, test } from "vitest";
import type {
  CodexBackgroundTerminalRow,
  CodexConversationItem,
  CodexConversationSnapshot,
} from "@/lib/types";
import type { CodexBackgroundTerminalProcessRow } from "@/lib/codex-background-terminal-processes";
import {
  buildProcessOutputTargetFromManagerRow,
  buildProcessOutputTargetFromSummaryRow,
  findProcessOutputCommandItem,
} from "./workbench-process-output-target";

function commandItem(
  input: Partial<CodexConversationItem> & {
    itemId: string;
    turnId: string;
  },
): CodexConversationItem {
  return {
    kind: "commandExecution",
    type: "commandExecution",
    command: "conversation command",
    cwd: "/conversation",
    createdAt: 0,
    updatedAt: 0,
    ...input,
  } as CodexConversationItem;
}

function conversation(
  itemsByTurn: Array<[string, CodexConversationItem[]]>,
): CodexConversationSnapshot {
  return {
    turns: itemsByTurn.map(([turnId, items]) => ({
      turnId,
      items,
    })),
  } as CodexConversationSnapshot;
}

describe("workbench process output target", () => {
  test("restricts lookup to an optional turn and ignores other item kinds", () => {
    const matching = commandItem({
      itemId: "item-1",
      turnId: "turn-2",
    });
    const snapshot = conversation([
      [
        "turn-1",
        [
          {
            ...matching,
            turnId: "turn-1",
            kind: "assistantMessage",
          },
        ],
      ],
      ["turn-2", [matching]],
    ]);
    expect(findProcessOutputCommandItem(snapshot, "item-1", "turn-1")).toBeNull();
    expect(findProcessOutputCommandItem(snapshot, "item-1", "turn-2")).toBe(matching);
    expect(findProcessOutputCommandItem(snapshot, "item-1")).toBe(matching);
  });

  test("prefers hydrated conversation fields over manager fallback", () => {
    const item = commandItem({
      itemId: "item-1",
      turnId: "turn-hydrated",
    });
    const row = {
      threadId: "thread-1",
      itemId: "item-1",
      turnId: "turn-fallback",
      command: "fallback command",
      cwd: "/fallback",
      terminalSessionId: "terminal-1",
    } as CodexBackgroundTerminalProcessRow;
    expect(
      buildProcessOutputTargetFromManagerRow(row, conversation([["turn-fallback", [item]]])),
    ).toEqual({
      threadId: "thread-1",
      itemId: "item-1",
      turnId: "turn-hydrated",
      command: "conversation command",
      cwd: "/conversation",
      terminalSessionId: "terminal-1",
    });
  });

  test("projects summary rows without inventing runtime identity", () => {
    const row = {
      id: "item-1",
      turnId: "turn-1",
      command: "pnpm test",
      cwd: "/workspace",
      previewLine: null,
    } satisfies CodexBackgroundTerminalRow;
    expect(buildProcessOutputTargetFromSummaryRow("thread-1", row)).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      command: "pnpm test",
      cwd: "/workspace",
      terminalSessionId: null,
    });
  });
});
