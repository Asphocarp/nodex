import { resolveCodexMcpResourceUriFromMetadata } from "../codex-mcp-tool-call";
import type { ProtocolListMcpServerStatusResponse, ProtocolMcpServerStatus } from "../types";
import type { McpAppSandboxOriginScope } from "./mcp-app-sandbox-contract";

export type McpAppToolDefinition = NonNullable<ProtocolMcpServerStatus["tools"][string]>;

export interface McpAppScopeSnapshot {
  allowedTools: ReadonlyMap<string, McpAppToolDefinition>;
  codexAppsToolScope: McpAppCodexAppsToolScope | null;
  originResourceUri: string;
  resourceTemplates: ProtocolMcpServerStatus["resourceTemplates"];
  resources: ProtocolMcpServerStatus["resources"];
  server: string;
  threadId: string;
}

export type McpAppCodexAppsToolScope =
  | { connectorId: string; kind: "connector" }
  | { connectorId: string; kind: "target"; targetId: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readCodexAppsResourceScope(meta: unknown): {
  actionName: string;
  connectorId: string;
  targetId: string;
} | null {
  const metadata = asRecord(meta);
  const codexApps = asRecord(metadata?._codex_apps);
  const resourceUri = codexApps?.resource_uri;
  if (typeof resourceUri !== "string") return null;
  const parts = resourceUri.split("/");
  if (parts.length !== 4 || parts[0] !== "" || !parts[1] || !parts[2]) return null;
  const actionName = parts[3];
  if (!actionName) return null;
  return {
    actionName,
    connectorId: parts[1],
    targetId: parts[2],
  };
}

export function mcpAppToolAcceptsFileParameters(tool: McpAppToolDefinition): boolean {
  const meta = asRecord(tool._meta);
  return meta ? Object.hasOwn(meta, "openai/fileParams") : false;
}

function findServerTool(
  server: ProtocolMcpServerStatus,
  toolName: string,
): McpAppToolDefinition | null {
  const direct = server.tools[toolName];
  if (direct) return direct;
  return Object.values(server.tools).find((tool) => tool?.name === toolName) ?? null;
}

function readConnectorId(meta: unknown): string | null {
  const metadata = asRecord(meta);
  const value = metadata?.connectorId ?? metadata?.connector_id;
  if (typeof value !== "string") return null;
  const connectorId = value.trim();
  return connectorId || null;
}

function deriveCodexAppsToolScope(
  tool: McpAppToolDefinition | null,
): McpAppCodexAppsToolScope | null {
  const connectorId = readConnectorId(tool?._meta);
  if (!connectorId) return null;
  const resource = readCodexAppsResourceScope(tool?._meta);
  if (!resource) return { connectorId, kind: "connector" };
  if (resource.connectorId !== connectorId) return null;
  return {
    connectorId,
    kind: "target",
    targetId: resource.targetId,
  };
}

function toolMatchesCodexAppsScope(
  tool: McpAppToolDefinition,
  scope: McpAppCodexAppsToolScope,
): boolean {
  if (readConnectorId(tool._meta) !== scope.connectorId) return false;
  if (scope.kind === "connector") return true;
  const resource = readCodexAppsResourceScope(tool._meta);
  return resource?.connectorId === scope.connectorId && resource.targetId === scope.targetId;
}

export function resolveMcpAppSandboxOriginScope(input: {
  currentToolName: string;
  instanceFallbackId: string;
  server: string;
  statuses: ProtocolListMcpServerStatusResponse;
}): McpAppSandboxOriginScope {
  if (input.server !== "codex_apps") {
    return { kind: "mcp_server", server: input.server };
  }
  const status = input.statuses.data.find((entry) => entry.name === input.server);
  const tool = status ? findServerTool(status, input.currentToolName) : null;
  return {
    connectorId: readConnectorId(tool?._meta),
    instanceFallbackId: input.instanceFallbackId,
    kind: "codex_app",
  };
}

export function createMcpAppScopeSnapshot(input: {
  currentToolName: string;
  originResourceUri: string;
  server: string;
  statuses: ProtocolListMcpServerStatusResponse;
  threadId: string;
}): McpAppScopeSnapshot {
  const status = input.statuses.data.find((entry) => entry.name === input.server);
  if (!status) throw new Error(`MCP server is unavailable: ${input.server}`);

  const tools = Object.values(status.tools).filter((tool): tool is McpAppToolDefinition =>
    Boolean(tool),
  );
  const currentTool = findServerTool(status, input.currentToolName);
  const linkedTools = tools.filter(
    (tool) => resolveCodexMcpResourceUriFromMetadata(tool._meta) === input.originResourceUri,
  );

  let scopedTools = linkedTools.length > 0 ? linkedTools : currentTool ? [currentTool] : [];
  let codexAppsToolScope: McpAppCodexAppsToolScope | null = null;
  if (input.server !== "codex_apps") {
    scopedTools = tools;
  } else {
    const trustedScope = deriveCodexAppsToolScope(currentTool);
    codexAppsToolScope = trustedScope;
    scopedTools = trustedScope
      ? tools.filter((tool) => toolMatchesCodexAppsScope(tool, trustedScope))
      : [];
  }

  return {
    allowedTools: new Map(
      scopedTools
        .filter((tool) => !mcpAppToolAcceptsFileParameters(tool))
        .map((tool) => [tool.name, tool]),
    ),
    codexAppsToolScope,
    originResourceUri: input.originResourceUri,
    resourceTemplates: input.server === "codex_apps" ? [] : status.resourceTemplates,
    resources: input.server === "codex_apps" ? [] : status.resources,
    server: input.server,
    threadId: input.threadId,
  };
}

export function requireMcpAppScopedTool(
  scope: McpAppScopeSnapshot,
  toolName: string,
  toolArguments?: Record<string, unknown>,
): McpAppToolDefinition {
  const tool = scope.allowedTools.get(toolName);
  if (!tool) {
    throw new Error(`MCP App cannot call tool outside its scope: ${toolName}`);
  }
  if (mcpAppToolAcceptsFileParameters(tool)) {
    throw new Error(`MCP App cannot call tools that accept file parameters: ${toolName}`);
  }
  const trustedScope = scope.codexAppsToolScope;
  if (
    trustedScope?.kind === "target" &&
    toolArguments?.link_id !== undefined &&
    toolArguments.link_id !== trustedScope.targetId
  ) {
    const meta = asRecord(tool._meta);
    const codexApps = asRecord(meta?._codex_apps);
    if (meta?.link_id != null && codexApps?.synthetic_link !== true) {
      throw new Error(`MCP App cannot call tool outside its trusted tool scope: ${toolName}`);
    }
  }
  return tool;
}

export function requireMcpAppScopedResource(scope: McpAppScopeSnapshot, uri: string): void {
  if (scope.server !== "codex_apps") return;
  if (uri !== scope.originResourceUri) {
    throw new Error(`MCP App cannot read resource outside its widget scope: ${uri}`);
  }
}
