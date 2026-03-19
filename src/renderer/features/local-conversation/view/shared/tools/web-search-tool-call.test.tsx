import { describe, expect, test } from "bun:test";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { render, textContent } from "../../../../../test/dom";
import {
  describeWebSearchAction,
  getWebSearchSummaryDetail,
  WebSearchToolCall,
} from "./web-search-tool-call";

function buildWebSearchEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "tool-1",
    entryId: "tool-1",
    type: "web_search",
    kind: "toolCall",
    semanticKind: "webSearch",
    status: "completed",
    toolCall: {
      subtype: "webSearch",
      toolName: "web_search",
      args: {
        query: "storybook react vite args",
      },
      result: {
        type: "search",
        query: "storybook react vite args",
      },
    },
    rawItem: {
      action: {
        type: "search",
        query: "storybook react vite args",
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("describeWebSearchAction", () => {
  test("uses the first non-empty query and appends an ellipsis for multi-query searches", () => {
    expect(describeWebSearchAction({
      type: "search",
      queries: ["storybook args", "storybook decorators"],
    }, "")).toBe("storybook args ...");
  });

  test("formats find-in-page actions the same way as Codex Electron", () => {
    expect(describeWebSearchAction({
      type: "findInPage",
      pattern: "play function",
      url: "https://storybook.js.org/docs/writing-stories/play-function",
    }, "")).toBe("'play function' in https://storybook.js.org/docs/writing-stories/play-function");
  });
});

describe("getWebSearchSummaryDetail", () => {
  test("prefers the raw action payload over generic fallback result data", () => {
    expect(getWebSearchSummaryDetail(buildWebSearchEntry({
      toolCall: {
        subtype: "webSearch",
        toolName: "web_search",
        args: { query: "ignored fallback query" },
        result: {
          sources: ["storybook"],
        },
      },
      rawItem: {
        action: {
          type: "openPage",
          url: "https://storybook.js.org/docs/writing-stories/args",
        },
      },
    }))).toBe("https://storybook.js.org/docs/writing-stories/args");
  });
});

describe("WebSearchToolCall", () => {
  test("renders the compact Codex-style summary row", () => {
    const { container } = render(
      <WebSearchToolCall
        item={buildWebSearchEntry({
          rawItem: {
            action: {
              type: "findInPage",
              pattern: "decorators",
              url: "https://storybook.js.org/docs/writing-stories/decorators",
            },
          },
        })}
      />,
    );

    const renderedText = textContent(container);
    expect(Boolean(renderedText.includes("Searched web"))).toBeTrue();
    expect(Boolean(renderedText.includes("'decorators' in https://storybook.js.org/docs/writing-stories/decorators"))).toBeTrue();
  });

  test("switches the summary verb while the search is running", () => {
    const { container } = render(
      <WebSearchToolCall
        item={buildWebSearchEntry({
          status: "inProgress",
        })}
      />,
    );

    expect(Boolean(textContent(container).includes("Searching web"))).toBeTrue();
  });
});
