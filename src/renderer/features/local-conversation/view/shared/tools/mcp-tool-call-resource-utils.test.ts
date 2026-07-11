import { describe, expect, test } from "vitest";
import type { CodexMcpToolCallView, ProtocolMcpResourceReadResponse, ProtocolMcpServerStatus } from "../../../../../lib/types";
import {
  MCP_APP_HTML_MAX_BYTES,
  getMcpAppHtmlByteSize,
  isMcpAppHtmlTooLarge,
  resolveMcpEmbeddedRenderableResource,
  resolveMcpAppResourceUri,
  resolveMcpAppResourceScopeUri,
  resolveMcpExpandedSuccessDisplay,
  resolveMcpRenderableResource,
  resolveMcpWidgetMetadata,
  shouldHideDuplicateMcpTextContent,
  shouldShowMcpStructuredContent,
} from "./mcp-tool-call-resource-utils";

function buildPayload(overrides: Partial<CodexMcpToolCallView> = {}): CodexMcpToolCallView {
  return {
    callId: "call-1",
    functionName: "docs__search",
    invocation: { server: "docs", tool: "search", arguments: {} },
    result: null,
    durationMs: null,
    completed: true,
    ...overrides,
  };
}

describe("mcp-tool-call-resource-utils", () => {
  test("resolves resource URI using tool metadata before result metadata and item URI", () => {
    const payload = buildPayload({
      mcpAppResourceUri: "ui://item.html",
      result: {
        type: "success",
        content: [],
        structuredContent: null,
        meta: { "openai/outputTemplate": "ui://result.html" },
        raw: { content: [], structuredContent: null },
      },
    });
    const statuses: ProtocolMcpServerStatus[] = [{
      name: "docs",
      serverInfo: null,
      tools: {
        search: {
          name: "search",
          inputSchema: {},
          _meta: { "openai/outputTemplate": "ui://tool.html" },
        },
      },
      resources: [],
      resourceTemplates: [],
      authStatus: "unsupported",
    }];

    expect(resolveMcpAppResourceUri({ payload, serverStatuses: statuses })).toBe("ui://tool.html");
    expect(resolveMcpAppResourceScopeUri({ payload, serverStatuses: statuses })).toBe("ui://tool.html");
  });

  test("matches server status tool metadata by tool name when the map key differs", () => {
    const payload = buildPayload({
      invocation: { server: "docs", tool: "search", arguments: {} },
    });
    const statuses: ProtocolMcpServerStatus[] = [{
      name: "docs",
      serverInfo: null,
      tools: {
        aliased: {
          name: "search",
          inputSchema: {},
          _meta: { "openai/outputTemplate": "ui://named-tool.html" },
        },
      },
      resources: [],
      resourceTemplates: [],
      authStatus: "unsupported",
    }];

    expect(resolveMcpAppResourceUri({ payload, serverStatuses: statuses })).toBe("ui://named-tool.html");
  });

  test("keeps item resource URI separate from metadata resource scope", () => {
    const payload = buildPayload({
      mcpAppResourceUri: "ui://item.html",
      result: {
        type: "success",
        content: [],
        structuredContent: null,
        raw: { content: [], structuredContent: null },
      },
    });

    expect(resolveMcpAppResourceScopeUri({ payload, serverStatuses: [] })).toBe(null);
    expect(resolveMcpAppResourceUri({ payload, serverStatuses: [] })).toBe("ui://item.html");
  });

  test("parses widget metadata aliases", () => {
    const metadata = resolveMcpWidgetMetadata({
      "openai/widgetDomain": "https://widgets.example.com",
      "openai/widgetHeightHint": 420,
      "openai/widgetMinFrameHeight": 360,
      "openai/widgetPrefersBorder": true,
      "openai/widgetShowCodexWidgetInline": true,
      "openai/widgetCSP": {
        connect_domains: ["https://api.example.com"],
        resource_domains: ["https://cdn.example.com"],
      },
    });

    expect(metadata.domain).toBe("https://widgets.example.com");
    expect(metadata.heightHint).toBe(420);
    expect(metadata.minFrameHeight).toBe(360);
    expect(metadata.prefersBorder).toBe(true);
    expect(metadata.isCollapsible).toBe(false);
    expect(metadata.csp?.connectDomains?.join(",") ?? "").toBe("https://api.example.com");
    expect(metadata.csp?.resourceDomains?.join(",") ?? "").toBe("https://cdn.example.com");
  });

  test("selects HTML MCP app resources and hides duplicate text fallback", () => {
    const response: ProtocolMcpResourceReadResponse = {
      contents: [{
        uri: "ui://docs/search.html",
        mimeType: "text/html;profile=mcp-app",
        text: "<main>Docs</main>",
        _meta: { "openai/widgetHeightHint": 320 },
      }],
    };
    const resource = resolveMcpRenderableResource("ui://docs/search.html", response);

    expect(resource?.mode ?? "").toBe("html");
    expect(resource?.metadata.heightHint ?? 0).toBe(320);
    expect(shouldHideDuplicateMcpTextContent({ type: "text", text: "<main>Docs</main>" }, resource)).toBe(true);
  });

  test("resolves embedded HTML MCP app resources from successful tool results", () => {
    const payload = buildPayload({
      result: {
        type: "success",
        content: [{
          type: "embedded_resource",
          resource: {
            uri: "ui://docs/search.html",
            mimeType: "text/html;profile=mcp-app",
            text: "<main>Embedded Docs</main>",
            meta: { "openai/widgetHeightHint": 360 },
          },
        }],
        structuredContent: null,
        meta: { "openai/outputTemplate": "ui://docs/search.html" },
        raw: { content: [], structuredContent: null },
      },
    });

    const resource = resolveMcpEmbeddedRenderableResource({ payload });

    expect(resource?.uri ?? "").toBe("ui://docs/search.html");
    expect(resource?.html ?? "").toBe("<main>Embedded Docs</main>");
    expect(resource?.metadata.heightHint ?? 0).toBe(360);
  });

  test("uses HTML fallback for DIL resources while DIL rendering is disabled", () => {
    const dilOnly: ProtocolMcpResourceReadResponse = {
      contents: [{
        uri: "ui://docs/app.dil",
        mimeType: "text/x-dil;profile=mcp-app",
        text: "component tree",
      }],
    };
    const withHtmlFallback: ProtocolMcpResourceReadResponse = {
      contents: [
        {
          uri: "ui://docs/app.dil",
          mimeType: "text/x-dil;profile=mcp-app",
          text: "component tree",
        },
        {
          uri: "ui://docs/app.html",
          mimeType: "text/html",
          text: "<main>Fallback app</main>",
        },
      ],
    };

    expect(resolveMcpRenderableResource("ui://docs/app.dil", dilOnly)).toBe(null);
    expect(resolveMcpRenderableResource("ui://docs/app.dil", withHtmlFallback)?.html ?? "").toBe("<main>Fallback app</main>");
  });

  test("deduplicates single JSON text content against structured content when expanded", () => {
    const display = resolveMcpExpandedSuccessDisplay({
      content: [{ type: "text", text: "{\"ok\":true}" }],
      structuredContentJson: "{\n  \"ok\": true\n}",
      isExpanded: true,
    });

    expect(display.displayContent.length).toBe(0);
    expect(display.displayStructuredContentJson ?? "").toBe("{\n  \"ok\": true\n}");
  });

  test("keeps annotated JSON text visible because it is not a structured duplicate", () => {
    const display = resolveMcpExpandedSuccessDisplay({
      content: [{ type: "text", text: "{\"ok\":true}", annotations: { source: "tool" } }],
      structuredContentJson: "{\n  \"ok\": true\n}",
      isExpanded: true,
    });

    expect(display.displayContent.length).toBe(1);
    expect(display.displayStructuredContentJson ?? "").toBe("{\n  \"ok\": true\n}");
  });

  test("hides structured JSON only for scope-backed MCP app branches", () => {
    expect(shouldShowMcpStructuredContent({
      structuredContentJson: "{\n  \"ok\": true\n}",
      hasMcpAppBranch: true,
      hasResourceScope: true,
    })).toBe(false);
    expect(shouldShowMcpStructuredContent({
      structuredContentJson: "{\n  \"ok\": true\n}",
      hasMcpAppBranch: true,
      hasResourceScope: false,
    })).toBe(true);
    expect(shouldShowMcpStructuredContent({
      structuredContentJson: null,
      hasMcpAppBranch: false,
      hasResourceScope: false,
    })).toBe(false);
  });

  test("checks MCP app HTML size using encoded byte size", () => {
    const resource = {
      uri: "ui://docs/app.html",
      mode: "html" as const,
      html: "x".repeat(MCP_APP_HTML_MAX_BYTES + 1),
      mimeType: "text/html",
      metadata: resolveMcpWidgetMetadata(null),
    };

    expect(getMcpAppHtmlByteSize("é")).toBe(2);
    expect(isMcpAppHtmlTooLarge(resource)).toBe(true);
  });
});
