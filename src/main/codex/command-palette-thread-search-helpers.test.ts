import { describe, expect, test } from "bun:test";
import type { CodexConversationSnapshot, CodexThreadDetail } from "../../shared/types";
import {
  buildThreadContentFtsMatchQuery,
  extractThreadSearchUnitsFromConversation,
  extractThreadSearchUnitsFromDetail,
  parseMarkedSnippetSegments,
} from "./command-palette-thread-search-helpers";

function makeConversation(): CodexConversationSnapshot {
  return {
    threadId: "thr_1",
    projectId: null,
    source: null,
    threadName: "Search test",
    threadPreview: "",
    modelProvider: "openai",
    cwd: null,
    statusType: "notLoaded",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-01-01T00:00:00.000Z",
    resumeState: "resumed",
    turns: [{
      threadId: "thr_1",
      turnId: "turn_1",
      status: "completed",
      itemIds: [],
      items: [
        {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "user_1",
          type: "userMessage",
          kind: "userMessage",
          role: "user",
          markdownText: "Find this user text",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "assistant_1",
          type: "agentMessage",
          kind: "assistantMessage",
          role: "assistant",
          markdownText: "Find this assistant text",
          createdAt: 2,
          updatedAt: 2,
        },
        {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "reasoning_1",
          type: "reasoning",
          kind: "reasoning",
          markdownText: "Hidden reasoning text",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: true,
      canCollapseTurns: false,
    },
  };
}

describe("command palette thread search helpers", () => {
  test("extracts only visible user and assistant conversation units", () => {
    const units = extractThreadSearchUnitsFromConversation(makeConversation());
    const texts = units.map((unit) => unit.text).join("\n");

    expect(units.length).toBe(2);
    expect(texts.includes("Find this user text")).toBeTrue();
    expect(texts.includes("Find this assistant text")).toBeTrue();
    expect(texts.includes("Hidden reasoning text")).toBeFalse();
  });

  test("extracts only visible user and assistant detail transcript entries", () => {
    const detail: CodexThreadDetail = {
      ...makeConversation(),
      turns: [],
      transcript: [
        {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "user_1",
          type: "userMessage",
          kind: "userMessage",
          role: "user",
          markdownText: "Searchable user",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "tool_1",
          type: "commandExecution",
          kind: "commandExecution",
          markdownText: "Tool output",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };

    const units = extractThreadSearchUnitsFromDetail(detail);

    expect(units.length).toBe(1);
    expect(units[0]?.text).toBe("Searchable user");
  });

  test("builds a sanitized FTS prefix query", () => {
    expect(buildThreadContentFtsMatchQuery("  Thread/search: hello-world  ")).toBe("thread* search* hello* world*");
    expect(buildThreadContentFtsMatchQuery(" -- ")).toBe(null);
  });

  test("parses FTS marked snippets into highlight segments", () => {
    const segments = parseMarkedSnippetSegments("hello \u0001world\u0002 again");

    expect(JSON.stringify(segments)).toBe(JSON.stringify([
      { text: "hello ", highlight: false },
      { text: "world", highlight: true },
      { text: " again", highlight: false },
    ]));
  });
});
