import { describe, expect, test } from "vitest";
import {
  NODEX_APP_V2_TOOLS,
  NODEX_APP_V2_TOOLSET_REVISION,
  NODEX_APP_V3_TOOLS,
  NODEX_APP_V3_TOOLSET_REVISION,
  NODEX_APP_TOOL_NAMESPACE,
} from "../../shared/nodex-agent-tools";
import {
  createNodexDynamicToolRegistry,
  createNodexV3DynamicToolRegistry,
  type NodexAgentToolHandlers,
  type NodexAgentV3ToolHandlers,
} from "./nodex-dynamic-tool-registry";

function unimplemented(): never {
  throw new Error("Executor is not used by this catalog test");
}

describe("createNodexDynamicToolRegistry", () => {
  test("publishes exactly one registration for every shared contract", () => {
    const handlers: NodexAgentToolHandlers<null> = {
      get_context: unimplemented,
      get_block: unimplemented,
      search: unimplemented,
      query_database: unimplemented,
      create: unimplemented,
      edit_document: unimplemented,
      transfer_blocks: unimplemented,
      edit_database: unimplemented,
    };
    const registry = createNodexDynamicToolRegistry(handlers);

    const catalog = registry.buildCatalog([{
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V2_TOOLSET_REVISION,
    }]);
    const namespace = catalog[0];
    expect(namespace?.type).toBe("namespace");
    if (!namespace || namespace.type !== "namespace") return;

    expect(namespace.name).toBe(NODEX_APP_TOOL_NAMESPACE);
    expect(namespace.description).toContain("Outputs are JSON text");
    expect(namespace.description).toContain("Keep intermediate NFM, rows, cursors, and ETags inside JavaScript");
    expect(namespace.description).toContain("bounded summary through text()");
    expect(namespace.tools.map((tool) => tool.name).sort()).toEqual(
      [...NODEX_APP_V2_TOOLS].sort(),
    );
    expect(namespace.tools.filter((tool) => tool.deferLoading === false).map(
      (tool) => tool.name,
    ).sort()).toEqual(["get_block", "get_context", "search"]);
  });

  test("publishes the smaller v3 intent catalog with only common reads eager", () => {
    const handlers = Object.fromEntries(
      NODEX_APP_V3_TOOLS.map((tool) => [tool, unimplemented]),
    ) as unknown as NodexAgentV3ToolHandlers<null>;
    const registry = createNodexV3DynamicToolRegistry(handlers);
    const catalog = registry.buildCatalog([{
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V3_TOOLSET_REVISION,
    }]);
    const namespace = catalog[0];
    expect(namespace?.type).toBe("namespace");
    if (!namespace || namespace.type !== "namespace") return;

    expect(namespace.description).toContain("Use one literal tab per child level");
    expect(namespace.description).not.toContain("NFM");
    expect(namespace.tools.map((tool) => tool.name).sort()).toEqual(
      [...NODEX_APP_V3_TOOLS].sort(),
    );
    expect(namespace.tools.filter((tool) => tool.deferLoading === false).map(
      (tool) => tool.name,
    ).sort()).toEqual(["fetch", "get_context", "search"]);
  });
});
