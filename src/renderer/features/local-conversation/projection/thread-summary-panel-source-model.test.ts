import { describe, expect, test } from "vitest";
import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import { buildThreadSummaryPanelSourceModel } from "./thread-summary-panel-source-model";

function makeTurn(items: CodexConversationItem[]): CodexConversationTurn {
  return {
    turnId: `turn-${items.length}`,
    status: "completed",
    items,
  } as unknown as CodexConversationTurn;
}

function makeMcpItem(
  itemId: string,
  server: string,
  rawItem: Record<string, unknown> = {},
): CodexConversationItem {
  return {
    itemId,
    type: "mcpToolCall",
    semanticKind: "mcpToolCall",
    mcpToolCall: {
      invocation: {
        server,
        tool: "tool",
        arguments: {},
      },
    },
    rawItem: {
      id: itemId,
      type: "mcpToolCall",
      server,
      ...rawItem,
    },
  } as unknown as CodexConversationItem;
}

function makeWebItem(itemId: string, action: Record<string, unknown> | null): CodexConversationItem {
  return {
    itemId,
    type: "webSearch",
    semanticKind: "webSearch",
    rawItem: {
      id: itemId,
      type: "webSearch",
      query: "Codex",
      action,
    },
  } as unknown as CodexConversationItem;
}

function makeMcpAppItem(itemId: string): CodexConversationItem {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId,
    type: "mcpToolCall",
    semanticKind: "mcpToolCall",
    mcpToolCall: {
      callId: "call-1",
      functionName: "docs__search",
      invocation: {
        server: "docs",
        tool: "search",
        arguments: {},
      },
      result: {
        type: "success",
        content: [{
          type: "embedded_resource",
          resource: {
            uri: "ui://docs/search.html",
            mimeType: "text/html;profile=mcp-app",
            text: "<main>Docs app</main>",
          },
        }],
        structuredContent: null,
        meta: { "openai/outputTemplate": "ui://docs/search.html" },
        raw: { content: [], structuredContent: null },
      },
      durationMs: null,
      completed: true,
    },
    rawItem: {
      id: itemId,
      type: "mcpToolCall",
      server: "docs",
    },
  } as unknown as CodexConversationItem;
}

describe("buildThreadSummaryPanelSourceModel", () => {
  test("orders source items by CodexElectron tool-first latest traversal and dedupes by source id", () => {
    const model = buildThreadSummaryPanelSourceModel([
      makeTurn([
        makeMcpItem("older-context7", "context7"),
        makeWebItem("older-page", { type: "openPage", url: "https://www.example.com/docs" }),
      ]),
      makeTurn([
        makeMcpItem("newer-context7", "context7"),
        makeMcpItem("docs", "docs", {
          source: {
            key: "docs-source",
            name: "Docs",
            logoUrl: "https://example.test/docs-light.png",
            logoUrlDark: "https://example.test/docs-dark.png",
          },
        }),
        makeMcpItem("node-repl", "node_repl"),
        makeWebItem("newer-page", { type: "findInPage", url: "https://www.example.com/docs" }),
      ]),
    ]);

    expect(model.count).toBe(3);
    expect(model.items.map((item) => `${item.kind}:${item.label}:${item.openAction?.type ?? "none"}`).join("|")).toBe(
      "tool:Docs:none|tool:Context7:none|webPage:example.com/docs:url",
    );
    expect(model.items[0]?.logoUrl).toBe("https://example.test/docs-light.png");
    expect(model.items[0]?.logoUrlDark).toBe("https://example.test/docs-dark.png");
    const pageAction = model.items[2]?.openAction;
    expect(pageAction?.type === "url" ? pageAction.url : "").toBe("https://www.example.com/docs");
  });

  test("uses a single non-openable web search aggregate when no page source exists", () => {
    const model = buildThreadSummaryPanelSourceModel([
      makeTurn([
        makeWebItem("search-1", { type: "search", query: "Codex app-server" }),
        makeWebItem("search-2", { type: "other" }),
      ]),
    ]);

    expect(model.count).toBe(1);
    expect(model.items.map((item) => `${item.kind}:${item.label}:${item.openAction?.type ?? "none"}`).join("|")).toBe(
      "webSearch:Web search:none",
    );
  });

  test("builds MCP app open actions from embedded HTML resources", () => {
    const model = buildThreadSummaryPanelSourceModel([
      makeTurn([makeMcpAppItem("older-docs-app")]),
      makeTurn([makeMcpItem("newer-docs", "docs")]),
    ]);

    const action = model.items[0]?.openAction;

    expect(model.count).toBe(1);
    expect(model.items[0]?.label).toBe("Docs");
    expect(action?.type).toBe("mcpApp");
    expect(action?.type === "mcpApp" ? action.input.mcpAppId : "").toBe("docs:ui://docs/search.html");
    expect(action?.type === "mcpApp" ? action.input.capabilityId : "").toBe(
      "mcp-capability:thread-1:docs:search:call-1",
    );
    expect(action?.type === "mcpApp" ? action.input.resource.html : "").toBe("<main>Docs app</main>");
  });

  test("falls back to the web search aggregate for non-reference page urls", () => {
    const model = buildThreadSummaryPanelSourceModel([
      makeTurn([
        makeWebItem("credentialed", { type: "openPage", url: "https://user:pass@example.com/docs" }),
        makeWebItem("non-http", { type: "findInPage", url: "file:///tmp/page.html" }),
      ]),
    ]);

    expect(model.count).toBe(1);
    expect(model.items[0]?.kind).toBe("webSearch");
    expect(model.items[0]?.openAction).toBe(null);
  });

  test("returns an empty model when the thread has no tool or web sources", () => {
    const model = buildThreadSummaryPanelSourceModel([
      makeTurn([{ itemId: "assistant", type: "assistantMessage" } as unknown as CodexConversationItem]),
    ]);

    expect(model.count).toBe(0);
    expect(model.items.length).toBe(0);
  });
});
