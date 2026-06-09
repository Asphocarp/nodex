import { describe, expect, test } from "bun:test";
import type { CodexMcpToolCallView, ProtocolMcpResourceReadResponse, ProtocolMcpServerStatus } from "../../../../../lib/types";
import {
  resolveMcpAppResourceUri,
  resolveMcpRenderableResource,
  resolveMcpWidgetMetadata,
  shouldHideDuplicateMcpTextContent,
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
  });

  test("parses widget metadata aliases", () => {
    const metadata = resolveMcpWidgetMetadata({
      "openai/widgetDomain": "https://widgets.example.com",
      "openai/widgetHeightHint": 420,
      "openai/widgetPrefersBorder": true,
      "openai/widgetCSP": {
        connect_domains: ["https://api.example.com"],
        resource_domains: ["https://cdn.example.com"],
      },
    });

    expect(metadata.domain).toBe("https://widgets.example.com");
    expect(metadata.heightHint).toBe(420);
    expect(metadata.prefersBorder).toBeTrue();
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
    expect(shouldHideDuplicateMcpTextContent({ type: "text", text: "<main>Docs</main>" }, resource)).toBeTrue();
  });
});
