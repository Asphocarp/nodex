import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { render, textContent } from "../../../../../test/dom";
import { DynamicToolCall } from "./dynamic-tool-call";

function buildDynamicEntry(overrides?: Partial<NonNullable<CodexTranscriptEntry["dynamicToolCall"]>>): CodexTranscriptEntry {
  const dynamicToolCall: NonNullable<CodexTranscriptEntry["dynamicToolCall"]> = {
    callId: "dynamic-1",
    namespace: "codex_app",
    tool: "read_thread",
    arguments: { threadId: "thread-1" },
    status: "completed",
    contentItems: [{ type: "inputText", text: "{\"schemaVersion\":1}" }],
    success: true,
    durationMs: 12,
    completed: true,
    ...overrides,
  };

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
      toolName: dynamicToolCall.tool,
      server: dynamicToolCall.namespace ?? undefined,
      args: dynamicToolCall.arguments,
      result: dynamicToolCall.contentItems ?? undefined,
    },
    dynamicToolCall,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("DynamicToolCall", () => {
  test("renders Codex app meta thread calls as compact rows", () => {
    const { container } = render(<DynamicToolCall item={buildDynamicEntry()} />);

    expect(textContent(container)).toBe("Read thread");
    expect(textContent(container).includes("schemaVersion")).toBeFalse();
    expect(textContent(container).includes("Arguments")).toBeFalse();
  });

  test("renders completed create_thread success as an open-chat card", () => {
    const openedThreads: string[] = [];
    const { getByRole, container } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          tool: "create_thread",
          arguments: {
            prompt: "Continue in a background chat",
            target: { type: "projectless" },
          },
          contentItems: [{ type: "inputText", text: "{\"threadId\":\"thread-created\"}" }],
        })}
        onOpenThread={(threadId) => {
          openedThreads.push(threadId);
        }}
      />,
    );

    expect(textContent(container).includes("Chat created")).toBeTrue();
    expect(textContent(container).includes("Open chat")).toBeTrue();
    expect(getByRole("button").getAttribute("aria-label")).toBe("Open chat");

    fireEvent.click(getByRole("button"));

    expect(openedThreads.join(",")).toBe("thread-created");
  });

  test("keeps create_thread worktree setup card on the pending-worktree hash fallback", () => {
    const previousHash = window.location.hash;
    window.location.hash = "";

    try {
      const { getByRole, container } = render(
        <DynamicToolCall
          item={buildDynamicEntry({
            tool: "create_thread",
            arguments: {
              prompt: "Continue in a worktree chat",
              target: {
                type: "project",
                projectId: "project-1",
                environment: { type: "worktree" },
              },
            },
            contentItems: [{ type: "inputText", text: "{\"pendingWorktreeId\":\"pending-worktree\"}" }],
          })}
        />,
      );

      expect(textContent(container).includes("Worktree chat queued")).toBeTrue();
      expect(textContent(container).includes("Open setup")).toBeTrue();

      fireEvent.click(getByRole("button"));

      expect(window.location.hash).toBe("#/worktrees/pending/pending-worktree");
    } finally {
      window.location.hash = previousHash;
    }
  });
});
