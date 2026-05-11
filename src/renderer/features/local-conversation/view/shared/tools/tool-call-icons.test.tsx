import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render } from "../../../../../test/dom";
import type { CodexConversationItem, CodexMcpServerElicitationRequest, CodexTranscriptEntry } from "../../../../../lib/types";
import {
  ConnectorLogo,
  ToolActivityIcon,
  resolveCollapsedToolActivityIcon,
  resolveMcpElicitationIcon,
  resolveMcpSourceIcon,
  resolveWebSearchIcon,
  semanticToolIcon,
  toolCallIconTestHelpers,
} from "./tool-call-icons";
import { CodexConnectorFallbackIcon } from "./codex-tool-icons";

function buildEntry(overrides: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    entryId: "item-1",
    type: "tool",
    kind: "toolCall",
    semanticKind: "exec",
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("tool-call icon helpers", () => {
  test("maps semantic tool icons to decorative SVG wrappers", () => {
    const { container } = render(<ToolActivityIcon descriptor={semanticToolIcon("run-command")} />);
    const wrapper = container.querySelector("[data-tool-activity-icon='run-command']");
    const svg = wrapper?.querySelector("svg");

    expect(Boolean(wrapper)).toBeTrue();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(Boolean(svg?.getAttribute("class")?.includes("icon-xs"))).toBeTrue();
  });

  test("builds Google favicons from normalized hostnames", () => {
    expect(toolCallIconTestHelpers.normalizeFaviconHostname("docs.storybook.js.org")).toBe("js.org");
    expect(toolCallIconTestHelpers.normalizeFaviconHostname("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(toolCallIconTestHelpers.buildGoogleFaviconUrl("www.bbc.co.uk")).toBe("https://www.google.com/s2/favicons?domain=bbc.co.uk&sz=32");
  });

  test("extracts favicons from open-page actions and site queries", () => {
    const openPage = toolCallIconTestHelpers.resolveWebFaviconDescriptor({
      type: "openPage",
      url: "https://storybook.js.org/docs",
    });
    const siteQuery = toolCallIconTestHelpers.resolveWebFaviconDescriptor({
      type: "search",
      query: "site:github.com/openai/codex renderer",
    });

    expect(openPage?.kind).toBe("favicon");
    expect(openPage?.kind === "favicon" ? openPage.hostname : "").toBe("js.org");
    expect(siteQuery?.kind).toBe("favicon");
    expect(siteQuery?.kind === "favicon" ? siteQuery.hostname : "").toBe("github.com");
  });

  test("uses theme-specific connector logo URLs and falls back on image failure", () => {
    expect(toolCallIconTestHelpers.selectConnectorLogoUrl({
      isDarkTheme: true,
      logoUrl: "https://example.com/light.svg",
      logoDarkUrl: "https://example.com/dark.svg",
    })).toBe("https://example.com/dark.svg");

    const { container } = render(
      <ConnectorLogo
        alt="Example logo"
        className="icon-xs object-contain"
        logoUrl="https://example.com/light.svg"
        logoDarkUrl={null}
        fallback={<CodexConnectorFallbackIcon aria-hidden className="icon-xs" />}
      />,
    );

    const image = container.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("Example logo");
    fireEvent.error(image as HTMLImageElement);
    expect(Boolean(container.querySelector("img"))).toBeFalse();
    expect(Boolean(container.querySelector("svg"))).toBeTrue();
  });

  test("resolves MCP source and elicitation metadata logos", () => {
    const mcpEntry = buildEntry({
      semanticKind: "mcpToolCall",
      toolCall: {
        subtype: "mcp",
        server: "browser-use",
        toolName: "open",
      },
      mcpToolCall: {
        callId: "call-1",
        functionName: "browser-use__open",
        invocation: {
          server: "browser-use",
          tool: "open",
          arguments: {},
        },
        durationMs: null,
        completed: true,
        result: null,
      },
    });
    const elicitationRequest: CodexMcpServerElicitationRequest = {
      type: "mcpServerElicitation",
      requestId: "req-1",
      projectId: null,
      cardId: null,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "toolSuggestion",
      mode: "url",
      serverName: "Linear",
      message: "Install Linear",
      meta: {
        logoUrl: "https://example.com/linear.svg",
        logoDarkUrl: "https://example.com/linear-dark.svg",
      },
      createdAt: 1,
    };

    const mcpIcon = resolveMcpSourceIcon(mcpEntry);
    const elicitationIcon = resolveMcpElicitationIcon(elicitationRequest);
    expect(mcpIcon.kind === "semantic" ? mcpIcon.icon : "").toBe("browser-use");
    expect(elicitationIcon.kind).toBe("logo");
    expect(elicitationIcon.kind === "logo" ? elicitationIcon.fallbackIcon : "").toBe("plugin");
  });

  test("resolves collapsed activity icon priority before MCP fallback", () => {
    const commandEntry = buildEntry({
      semanticKind: "exec",
      commandActions: [
        {
          type: "search",
          command: "rg ToolActivityIcon",
          query: "ToolActivityIcon",
          path: "src",
        },
      ],
    }) as CodexConversationItem;
    const webEntry = buildEntry({
      semanticKind: "webSearch",
      rawItem: {
        action: {
          type: "openPage",
          url: "https://storybook.js.org/docs",
        },
      },
    }) as CodexConversationItem;

    const descriptor = resolveCollapsedToolActivityIcon([
      {
        id: "exploration",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 1,
        searchableText: "Explored",
        type: "explorationGroup",
        entries: [commandEntry],
        summary: "Explored",
        status: "completed",
      },
      {
        id: "web",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 1,
        searchableText: "Web",
        type: "webSearch",
        entry: webEntry,
      },
    ]);

    expect(descriptor?.kind).toBe("favicon");
    expect(descriptor?.kind === "favicon" ? descriptor.hostname : "").toBe("js.org");
  });

  test("web search row resolver falls back to the semantic globe", () => {
    const descriptor = resolveWebSearchIcon(buildEntry({
      semanticKind: "webSearch",
      toolCall: {
        subtype: "webSearch",
        toolName: "web_search",
        args: { query: "no domain here" },
      },
    }));

    expect(descriptor.kind === "semantic" ? descriptor.icon : "").toBe("web-search");
  });
});
