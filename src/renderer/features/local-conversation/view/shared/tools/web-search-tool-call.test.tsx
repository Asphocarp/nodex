import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { render, textContent } from "../../../../../test/dom";
import { describeWebSearchAction } from "../../../web-search-display";
import {
  getWebSearchSummaryDetail,
  WebSearchToolCall,
  WebSearchToolCallGroup,
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

  test("normalizes site filters in search action detail text", () => {
    expect(describeWebSearchAction({
      type: "search",
      query: "site:github.com/openai/codex renderer OR site:www.example.com docs",
    }, "")).toBe("renderer docs | github.com \u00b7 example.com");
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
    expect(Boolean(renderedText.includes("Searched the web"))).toBe(true);
    expect(Boolean(renderedText.includes("'decorators' in https://storybook.js.org/docs/writing-stories/decorators"))).toBe(true);
    expect(Boolean(container.querySelector("[data-tool-activity-icon='favicon']"))).toBe(true);
  });

  test("shimmers the Codex active summary verb while the search is running", () => {
    const { container } = render(
      <WebSearchToolCall
        item={buildWebSearchEntry({
          status: "inProgress",
        })}
      />,
    );

    expect(Boolean(textContent(container).includes("Searching the web"))).toBe(true);
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(true);
  });

  test("renders favicon-only detail rows inside collapsed activity bodies", () => {
    const { container } = render(
      <WebSearchToolCall
        hideHeader
        item={buildWebSearchEntry({
          rawItem: {
            action: {
              type: "search",
              query: "site:github.com/openai/codex renderer",
            },
          },
        })}
      />,
    );

    expect(Boolean(textContent(container).includes("renderer | github.com"))).toBe(true);
    expect(Boolean(container.querySelector("[data-tool-activity-icon='favicon']"))).toBe(true);
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
  });

  test("omits the semantic globe in detail rows when no favicon URL exists", () => {
    const { container } = render(
      <WebSearchToolCall
        hideHeader
        item={buildWebSearchEntry({
          toolCall: {
            subtype: "webSearch",
            toolName: "web_search",
            args: {
              query: "no domain here",
            },
            result: {
              type: "search",
              query: "no domain here",
            },
          },
          rawItem: {
            action: {
              type: "search",
              query: "no domain here",
            },
          },
        })}
      />,
    );

    expect(Boolean(textContent(container).includes("no domain here"))).toBe(true);
    expect(Boolean(container.querySelector("[data-tool-activity-icon]"))).toBe(false);
  });
});

describe("WebSearchToolCallGroup", () => {
  test("renders the active header with the newest incomplete detail", async () => {
    const { container } = render(
      <WebSearchToolCallGroup
        isActive
        items={[
          buildWebSearchEntry({
            itemId: "web-old",
            entryId: "web-old",
            status: "completed",
            toolCall: {
              subtype: "webSearch",
              toolName: "web_search",
              args: { query: "old query" },
              result: { type: "search", query: "old query" },
            },
            rawItem: { action: { type: "search", query: "old query" } },
          }),
          buildWebSearchEntry({
            itemId: "web-new",
            entryId: "web-new",
            status: "inProgress",
            toolCall: {
              subtype: "webSearch",
              toolName: "web_search",
              args: { query: "site:github.com/openai/codex renderer OR site:www.example.com docs" },
              result: {
                type: "search",
                query: "site:github.com/openai/codex renderer OR site:www.example.com docs",
              },
            },
            rawItem: {
              action: {
                type: "search",
                query: "site:github.com/openai/codex renderer OR site:www.example.com docs",
              },
            },
          }),
        ]}
      />,
    );

    const renderedText = textContent(container);
    expect(Boolean(renderedText.includes("Searching the web"))).toBe(true);
    expect(Boolean(renderedText.includes("for renderer docs | github.com \u00b7 example.com"))).toBe(true);
    expect(Boolean(renderedText.includes("old query"))).toBe(false);
    expect(Boolean(container.querySelector("[data-tool-activity-icon='web-search']"))).toBe(true);
    expect(Boolean(container.querySelector("[data-tool-activity-icon='favicon']"))).toBe(false);
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(true);

    const collapsedList = container.querySelector<HTMLElement>("[data-testid='web-search-group-lines']");
    expect(collapsedList?.style.maxHeight ?? "").toBe("0px");
    expect(Boolean(textContent(collapsedList ?? container).includes("old query"))).toBe(false);

    await act(async () => {
      fireEvent.click(container.querySelector("button") as HTMLButtonElement);
      await Promise.resolve();
    });

    const expandedList = container.querySelector<HTMLElement>("[data-testid='web-search-group-lines']");
    expect(expandedList?.style.maxHeight ?? "").toBe("20rem");
    expect(Boolean(expandedList?.classList.contains("vertical-scroll-fade-mask"))).toBe(true);
    expect(Boolean(expandedList?.classList.contains("flex-col-reverse"))).toBe(false);
    expect(Boolean(textContent(expandedList ?? container).includes("old query"))).toBe(true);
    expect(Boolean(textContent(expandedList ?? container).includes("renderer docs | github.com \u00b7 example.com"))).toBe(true);
  });

  test("renders the completed header without detail text", () => {
    const { container } = render(
      <WebSearchToolCallGroup
        items={[
          buildWebSearchEntry({
            itemId: "web-completed",
            entryId: "web-completed",
            status: "completed",
            toolCall: {
              subtype: "webSearch",
              toolName: "web_search",
              args: { query: "completed query" },
              result: { type: "search", query: "completed query" },
            },
            rawItem: { action: { type: "search", query: "completed query" } },
          }),
        ]}
      />,
    );

    const renderedText = textContent(container);
    expect(renderedText).toBe("Searched the web");
    expect(Boolean(renderedText.includes("completed query"))).toBe(false);
    expect(Boolean(container.querySelector("[data-tool-activity-icon='web-search']"))).toBe(true);
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
  });

  test("settles the header when isActive is true but every line completed", () => {
    const { container } = render(
      <WebSearchToolCallGroup
        isActive
        items={[
          buildWebSearchEntry({
            itemId: "web-completed-active-prop",
            entryId: "web-completed-active-prop",
            status: "completed",
            toolCall: {
              subtype: "webSearch",
              toolName: "web_search",
              args: { query: "completed query" },
              result: { type: "search", query: "completed query" },
            },
            rawItem: { action: { type: "search", query: "completed query" } },
          }),
        ]}
      />,
    );

    const renderedText = textContent(container);
    expect(renderedText).toBe("Searched the web");
    expect(Boolean(renderedText.includes("completed query"))).toBe(false);
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBe(false);
  });

  test("renders nested body-only groups through the shared bounded list", () => {
    const { container } = render(
      <WebSearchToolCallGroup
        hideHeader
        items={[
          buildWebSearchEntry({
            itemId: "web-body",
            entryId: "web-body",
            status: "completed",
            toolCall: {
              subtype: "webSearch",
              toolName: "web_search",
              args: { query: "site:github.com/openai/codex body detail" },
              result: { type: "search", query: "site:github.com/openai/codex body detail" },
            },
            rawItem: {
              action: { type: "search", query: "site:github.com/openai/codex body detail" },
            },
          }),
        ]}
      />,
    );

    const list = container.querySelector<HTMLElement>("[data-testid='web-search-group-lines']");
    expect(list?.style.maxHeight ?? "").toBe("20rem");
    expect(Boolean(list?.classList.contains("vertical-scroll-fade-mask"))).toBe(true);
    expect(Boolean(list?.classList.contains("flex-col-reverse"))).toBe(false);
    expect(Boolean(textContent(list ?? container).includes("body detail | github.com"))).toBe(true);
    expect(Boolean(container.querySelector("[data-tool-activity-icon='favicon']"))).toBe(true);
    expect(Boolean(container.querySelector("[data-tool-activity-icon='web-search']"))).toBe(false);
    expect(Boolean(container.querySelector("button"))).toBe(false);
  });
});
