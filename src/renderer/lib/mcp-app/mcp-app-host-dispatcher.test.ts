import { describe, expect, test } from "vitest";
import type { McpAppScopeSnapshot } from "../../../shared/mcp-app/mcp-app-scope";
import { McpAppHostDispatcher } from "./mcp-app-host-dispatcher";

function scope(toolName: string): McpAppScopeSnapshot {
  return {
    allowedTools: new Map([[toolName, { name: toolName, inputSchema: { type: "object" } }]]),
    codexAppsToolScope: null,
    originResourceUri: "ui://calendar/widget",
    resourceTemplates: [],
    resources: [],
    server: "calendar",
    threadId: "thread-1",
  };
}

describe("MCP App host dispatcher", () => {
  test("resolves the latest trusted tool scope for every list request", async () => {
    let current = scope("list-events");
    const dispatcher = new McpAppHostDispatcher({
      getScope: () => current,
      scope: current,
    });
    const callMcp = dispatcher.handlers().callMcp;

    await expect(callMcp({ method: "tools/list" })).resolves.toMatchObject({
      tools: [{ name: "list-events" }],
    });
    current = scope("create-event");
    await expect(callMcp({ method: "tools/list" })).resolves.toMatchObject({
      tools: [{ name: "create-event" }],
    });
  });
});
