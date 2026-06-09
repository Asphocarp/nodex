import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { render, textContent } from "../../../../../test/dom";
import { DynamicToolCall } from "./dynamic-tool-call";

function buildDynamicEntry(): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "dynamic-1",
    entryId: "dynamic-1",
    type: "dynamicToolCall",
    kind: "toolCall",
    semanticKind: "dynamicToolCall",
    status: "completed",
    toolCall: {
      subtype: "dynamic",
      toolName: "read_thread",
      server: "codex_app",
      args: { threadId: "thread-1" },
      result: [{ type: "inputText", text: "{\"schemaVersion\":1}" }],
    },
    dynamicToolCall: {
      callId: "dynamic-1",
      namespace: "codex_app",
      tool: "read_thread",
      arguments: { threadId: "thread-1" },
      status: "completed",
      contentItems: [{ type: "inputText", text: "{\"schemaVersion\":1}" }],
      success: true,
      durationMs: 12,
      completed: true,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("DynamicToolCall", () => {
  test("renders Codex-style summary and expandable JSON output", () => {
    const { getByRole, container } = render(<DynamicToolCall item={buildDynamicEntry()} />);

    const button = getByRole("button");
    expect(textContent(button).includes("Read")).toBeTrue();
    expect(textContent(button).includes("thread")).toBeTrue();

    fireEvent.click(button);

    expect(textContent(container).includes("schemaVersion")).toBeTrue();
    expect(textContent(container).includes("Arguments")).toBeTrue();
  });
});
