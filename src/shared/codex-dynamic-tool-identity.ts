import type { DynamicToolCallParams } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallParams";

export const CODEX_APP_TOOL_NAMESPACE = "codex_app";
export const CODEX_APP_TOOLSET_REVISION = 1 as const;

export interface CodexDynamicToolIdentity {
  readonly namespace: string;
  readonly tool: string;
}

export function hasCodexDynamicToolIdentity(
  params: Pick<DynamicToolCallParams, "namespace" | "tool">,
  identity: CodexDynamicToolIdentity,
): boolean {
  return params.namespace === identity.namespace && params.tool === identity.tool;
}

export function isCodexAppDynamicTool(
  params: Pick<DynamicToolCallParams, "namespace">,
): boolean {
  return params.namespace === CODEX_APP_TOOL_NAMESPACE;
}
