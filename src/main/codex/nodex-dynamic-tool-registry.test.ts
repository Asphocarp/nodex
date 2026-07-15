import { describe, expect, test } from "vitest";
import {
  NODEX_APP_TOOLS,
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_TOOLSET_REVISION,
} from "../../shared/nodex-agent-tools";
import {
  createNodexDynamicToolRegistry,
  type NodexAgentToolHandlers,
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
      toolsetRevision: NODEX_APP_TOOLSET_REVISION,
    }]);
    const namespace = catalog[0];
    expect(namespace?.type).toBe("namespace");
    if (!namespace || namespace.type !== "namespace") return;

    expect(namespace.name).toBe(NODEX_APP_TOOL_NAMESPACE);
    expect(namespace.tools.map((tool) => tool.name).sort()).toEqual(
      [...NODEX_APP_TOOLS].sort(),
    );
    expect(namespace.tools.filter((tool) => tool.deferLoading === false).map(
      (tool) => tool.name,
    ).sort()).toEqual(["get_block", "get_context", "search"]);
  });
});
