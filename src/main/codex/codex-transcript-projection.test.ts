import { describe, expect, test } from "bun:test";

import { finalizeTurnTranscriptState } from "./codex-transcript-projection";
import type { CodexTranscriptEntry } from "../../shared/types";

function makeEntry(
  input: Partial<CodexTranscriptEntry> & {
    itemId: string;
    type: string;
    kind: string;
    semanticKind: string;
  },
): CodexTranscriptEntry {
  return {
    threadId: "thr_terminalize",
    turnId: "turn_terminalize",
    entryId: input.itemId,
    itemId: input.itemId,
    type: input.type,
    kind: input.kind,
    semanticKind: input.semanticKind,
    status: input.status ?? "inProgress",
    source: "live",
    sequence: input.sequence ?? 0,
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt ?? 1,
    ...(input.toolCall ? { toolCall: input.toolCall } : {}),
    ...(input.markdownText ? { markdownText: input.markdownText } : {}),
  };
}

describe("finalizeTurnTranscriptState", () => {
  test("keeps in-progress command executions alive when a turn completes", () => {
    const transcript = [
      makeEntry({
        itemId: "exec_old",
        type: "commandExecution",
        kind: "commandExecution",
        semanticKind: "exec",
        toolCall: {
          subtype: "command",
          toolName: "bash",
        },
      }),
      makeEntry({
        itemId: "reasoning_old",
        type: "reasoning",
        kind: "reasoning",
        semanticKind: "reasoning",
        markdownText: "Thinking...",
        sequence: 1,
      }),
    ];

    const finalized = finalizeTurnTranscriptState(transcript, "turn_terminalize", "completed");
    expect(finalized[0]?.status).toBe("inProgress");
    expect(finalized[1]?.status).toBe("completed");
  });

  test("interrupting a turn still terminalizes command executions", () => {
    const transcript = [
      makeEntry({
        itemId: "exec_interrupt",
        type: "commandExecution",
        kind: "commandExecution",
        semanticKind: "exec",
      }),
    ];

    const finalized = finalizeTurnTranscriptState(transcript, "turn_terminalize", "interrupted");
    expect(finalized[0]?.status).toBe("interrupted");
  });
});
