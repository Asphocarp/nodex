import type { z } from "zod";
import { NODEX_AGENT_TOOL_CONTRACTS } from "../../shared/nodex-agent-tools/contracts";
import {
  NODEX_APP_V2_TOOLS,
  NODEX_APP_V2_TOOLSET_REVISION,
  NODEX_APP_TOOL_NAMESPACE,
  type NodexAgentV2ToolName,
} from "../../shared/nodex-agent-tools/identity";
import {
  NODEX_APP_V3_TOOLS,
  NODEX_APP_V3_TOOLSET_REVISION,
  type NodexAgentV3ToolName,
} from "../../shared/nodex-agent-tools/identity";
import { NODEX_AGENT_V3_TOOL_CONTRACTS } from "../../shared/nodex-agent-tools/v3-contracts";
import { NESTED_MARKDOWN_COMPACT_HINT } from "../../shared/nfm/agent-guide";
import {
  DynamicToolRegistry,
  type DynamicToolExecutionRequest,
} from "./dynamic-tool-registry";

export const NODEX_APP_TOOL_NAMESPACE_DESCRIPTION =
  "Read and edit the current Nodex Project as stable Blocks, complete NFM documents, Databases, and Views. Outputs are JSON text in this runtime. In Code Mode, use a small wrapper equivalent to `const r = JSON.parse(await call); if (r.error) throw Object.assign(new Error(r.error.message), { result: r }); return r.data;`. Keep intermediate NFM, rows, cursors, and ETags inside JavaScript, serialize dependent writes, and emit only a bounded summary through text().";

export const NODEX_APP_V3_TOOL_NAMESPACE_DESCRIPTION = [
  NESTED_MARKDOWN_COMPACT_HINT,
  "Outputs are JSON text. In Code Mode, compose dependent calls in one JavaScript pipeline, parse each result, throw on result.error, keep intermediate rows, Markdown, cursors, and ETags inside JavaScript, serialize dependent writes, and emit only a bounded summary with text().",
].join(" ");

type NodexAgentToolContracts = typeof NODEX_AGENT_TOOL_CONTRACTS;

export type NodexAgentToolInput<TTool extends NodexAgentV2ToolName> = z.output<
  NodexAgentToolContracts[TTool]["inputSchema"]
>;

export type NodexAgentToolOutput<TTool extends NodexAgentV2ToolName> = z.input<
  NodexAgentToolContracts[TTool]["outputSchema"]
>;

export type NodexAgentToolHandlers<TContext> = {
  readonly [TTool in NodexAgentV2ToolName]: (
    request: DynamicToolExecutionRequest<NodexAgentToolInput<TTool>, TContext>,
  ) => Promise<NodexAgentToolOutput<TTool>> | NodexAgentToolOutput<TTool>;
};

type NodexAgentV3ToolContracts = typeof NODEX_AGENT_V3_TOOL_CONTRACTS;

export type NodexAgentV3ToolInput<TTool extends NodexAgentV3ToolName> = z.output<
  NodexAgentV3ToolContracts[TTool]["inputSchema"]
>;

export type NodexAgentV3ToolOutput<TTool extends NodexAgentV3ToolName> = z.input<
  NodexAgentV3ToolContracts[TTool]["outputSchema"]
>;

export type NodexAgentV3ToolHandlers<TContext> = {
  readonly [TTool in NodexAgentV3ToolName]: (
    request: DynamicToolExecutionRequest<NodexAgentV3ToolInput<TTool>, TContext>,
  ) => Promise<NodexAgentV3ToolOutput<TTool>> | NodexAgentV3ToolOutput<TTool>;
};

function catalogOnlyHandler(): never {
  throw new Error("Catalog-only Nodex tool handlers cannot execute");
}

interface CatalogContract {
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly deferLoading: boolean;
}

function registerNodexAgentTool<
  TContext,
  TTool extends NodexAgentV2ToolName,
>(
  registry: DynamicToolRegistry<TContext>,
  handlers: NodexAgentToolHandlers<TContext>,
  tool: TTool,
): void {
  const contract = NODEX_AGENT_TOOL_CONTRACTS[tool];
  registry.register({
    namespace: NODEX_APP_TOOL_NAMESPACE,
    namespaceDescription: NODEX_APP_TOOL_NAMESPACE_DESCRIPTION,
    toolsetRevision: NODEX_APP_V2_TOOLSET_REVISION,
    tool,
    description: contract.description,
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    deferLoading: contract.deferLoading,
    classifyEffect: (input) => contract.classifyEffect(input as never),
    execute: (request) => handlers[tool](request as never),
  });
}

export function createNodexDynamicToolRegistry<TContext>(
  handlers: NodexAgentToolHandlers<TContext>,
): DynamicToolRegistry<TContext> {
  const registry = new DynamicToolRegistry<TContext>();
  for (const tool of NODEX_APP_V2_TOOLS) {
    registerNodexAgentTool(registry, handlers, tool);
  }
  return registry;
}

function registerNodexAgentV3Tool<
  TContext,
  TTool extends NodexAgentV3ToolName,
>(
  registry: DynamicToolRegistry<TContext>,
  handlers: NodexAgentV3ToolHandlers<TContext>,
  tool: TTool,
): void {
  const contract = NODEX_AGENT_V3_TOOL_CONTRACTS[tool];
  registry.register({
    namespace: NODEX_APP_TOOL_NAMESPACE,
    namespaceDescription: NODEX_APP_V3_TOOL_NAMESPACE_DESCRIPTION,
    toolsetRevision: NODEX_APP_V3_TOOLSET_REVISION,
    tool,
    description: contract.description,
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    deferLoading: contract.deferLoading,
    classifyEffect: (input) => contract.classifyEffect(input as never),
    execute: (request) => handlers[tool](request as never),
  });
}

export function createNodexV3DynamicToolRegistry<TContext>(
  handlers: NodexAgentV3ToolHandlers<TContext>,
): DynamicToolRegistry<TContext> {
  const registry = new DynamicToolRegistry<TContext>();
  for (const tool of NODEX_APP_V3_TOOLS) {
    registerNodexAgentV3Tool(registry, handlers, tool);
  }
  return registry;
}

/**
 * Build the exact production catalog without importing the Agent service or
 * constructing any runtime/store dependencies.
 */
export function buildNodexAgentV2DynamicToolCatalog() {
  return buildNodexCatalogOnly({
    tools: NODEX_APP_V2_TOOLS,
    contracts: NODEX_AGENT_TOOL_CONTRACTS,
    namespaceDescription: NODEX_APP_TOOL_NAMESPACE_DESCRIPTION,
    toolsetRevision: NODEX_APP_V2_TOOLSET_REVISION,
  });
}

function buildNodexCatalogOnly(input: {
  readonly tools: readonly string[];
  readonly contracts: Readonly<Record<string, CatalogContract>>;
  readonly namespaceDescription: string;
  readonly toolsetRevision: number;
}) {
  const registry = new DynamicToolRegistry<never>();
  for (const tool of input.tools) {
    const contract = input.contracts[tool];
    if (!contract) throw new Error(`Missing Nodex catalog contract: ${tool}`);
    registry.register({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      namespaceDescription: input.namespaceDescription,
      toolsetRevision: input.toolsetRevision,
      tool,
      description: contract.description,
      inputSchema: contract.inputSchema,
      outputSchema: contract.outputSchema,
      deferLoading: contract.deferLoading,
      classifyEffect: () => "read",
      execute: catalogOnlyHandler,
    });
  }
  return registry.buildCatalog([{
    namespace: NODEX_APP_TOOL_NAMESPACE,
    toolsetRevision: input.toolsetRevision,
  }]);
}

export function buildNodexAgentV3DynamicToolCatalog() {
  return buildNodexCatalogOnly({
    tools: NODEX_APP_V3_TOOLS,
    contracts: NODEX_AGENT_V3_TOOL_CONTRACTS,
    namespaceDescription: NODEX_APP_V3_TOOL_NAMESPACE_DESCRIPTION,
    toolsetRevision: NODEX_APP_V3_TOOLSET_REVISION,
  });
}
