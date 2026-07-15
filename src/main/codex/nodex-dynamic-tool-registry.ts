import type { z } from "zod";
import {
  NODEX_AGENT_TOOL_CONTRACTS,
  NODEX_APP_TOOLS,
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_TOOLSET_REVISION,
  type NodexAgentToolName,
} from "../../shared/nodex-agent-tools";
import {
  DynamicToolRegistry,
  type DynamicToolExecutionRequest,
} from "./dynamic-tool-registry";

export const NODEX_APP_TOOL_NAMESPACE_DESCRIPTION =
  "Read and edit the current Nodex Project as stable Blocks, complete NFM documents, Databases, and Views.";

type NodexAgentToolContracts = typeof NODEX_AGENT_TOOL_CONTRACTS;

export type NodexAgentToolInput<TTool extends NodexAgentToolName> = z.output<
  NodexAgentToolContracts[TTool]["inputSchema"]
>;

export type NodexAgentToolOutput<TTool extends NodexAgentToolName> = z.input<
  NodexAgentToolContracts[TTool]["outputSchema"]
>;

export type NodexAgentToolHandlers<TContext> = {
  readonly [TTool in NodexAgentToolName]: (
    request: DynamicToolExecutionRequest<NodexAgentToolInput<TTool>, TContext>,
  ) => Promise<NodexAgentToolOutput<TTool>> | NodexAgentToolOutput<TTool>;
};

function registerNodexAgentTool<
  TContext,
  TTool extends NodexAgentToolName,
>(
  registry: DynamicToolRegistry<TContext>,
  handlers: NodexAgentToolHandlers<TContext>,
  tool: TTool,
): void {
  const contract = NODEX_AGENT_TOOL_CONTRACTS[tool];
  registry.register({
    namespace: NODEX_APP_TOOL_NAMESPACE,
    namespaceDescription: NODEX_APP_TOOL_NAMESPACE_DESCRIPTION,
    toolsetRevision: NODEX_APP_TOOLSET_REVISION,
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
  for (const tool of NODEX_APP_TOOLS) {
    registerNodexAgentTool(registry, handlers, tool);
  }
  return registry;
}
