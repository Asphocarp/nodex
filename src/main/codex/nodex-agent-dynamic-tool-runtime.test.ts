import { describe, expect, test } from "vitest";
import {
  NODEX_APP_TOOLSET_REVISION,
  NODEX_APP_V2_TOOLSET_REVISION,
  type NodexAgentAccess,
} from "../../shared/nodex-agent-tools";
import {
  buildNodexAgentDynamicToolSpecs,
  executeNodexAgentDynamicToolCall,
} from "./nodex-agent-dynamic-tool-runtime";

const access: NodexAgentAccess = {
  read: "allowed",
  write: "consent_required",
  domains: ["document", "placement", "database"],
};

describe("Nodex agent dynamic-tool runtime", () => {
  test("publishes the complete revisioned nodex_app catalog", () => {
    const [catalog] = buildNodexAgentDynamicToolSpecs();
    expect(catalog?.type).toBe("namespace");
    if (!catalog || catalog.type !== "namespace") return;

    expect(catalog.name).toBe("nodex_app");
    expect(catalog.tools.map((tool) => tool.name)).toEqual([
      "advanced_update_page",
      "create_pages",
      "duplicate_page",
      "fetch",
      "get_context",
      "move_pages",
      "query_data_source",
      "query_database_view",
      "search",
      "update_page",
    ]);
  });

  test("returns machine-readable stale-catalog and argument failures", async () => {
    const stale = await executeNodexAgentDynamicToolCall({
      threadId: "thread-old",
      turnId: "turn-1",
      callId: "call-1",
      namespace: "nodex_app",
      tool: "get_context",
      arguments: {},
    }, {
      toolsetRevision: null,
      authority: null,
      access,
      authorize: async () => "deny",
    });
    const staleFailure = JSON.parse(stale.contentItems[0]?.type === "inputText"
      ? stale.contentItems[0].text
      : "null") as { error?: { code?: string; recovery?: string } };
    expect(stale.success).toBe(false);
    expect(staleFailure.error).toEqual({
      code: "tool_catalog_stale",
      message: "This task was not launched with the Nodex agent-tool catalog",
      retryable: false,
      recovery: "start_new_task",
    });

    const retired = await executeNodexAgentDynamicToolCall({
      threadId: "thread-v2",
      turnId: "turn-1",
      callId: "call-v2",
      namespace: "nodex_app",
      tool: "get_block",
      arguments: { blockId: "card-old" },
    }, {
      toolsetRevision: NODEX_APP_V2_TOOLSET_REVISION,
      authority: null,
      access,
      authorize: async () => "deny",
    });
    const retiredFailure = JSON.parse(retired.contentItems[0]?.type === "inputText"
      ? retired.contentItems[0].text
      : "null") as { error?: { code?: string; recovery?: string } };
    expect(retired.success).toBe(false);
    expect(retiredFailure.error).toMatchObject({
      code: "tool_catalog_stale",
      recovery: "start_new_task",
    });

    const invalid = await executeNodexAgentDynamicToolCall({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-2",
      namespace: "nodex_app",
      tool: "fetch",
      arguments: {},
    }, {
      toolsetRevision: NODEX_APP_TOOLSET_REVISION,
      authority: null,
      access,
      authorize: async () => "deny",
    });
    const invalidFailure = JSON.parse(invalid.contentItems[0]?.type === "inputText"
      ? invalid.contentItems[0].text
      : "null") as { error?: { code?: string } };
    expect(invalid.success).toBe(false);
    expect(invalidFailure.error?.code).toBe("invalid_arguments");
  });
});
