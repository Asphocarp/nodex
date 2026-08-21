import type { AppInfo } from "@nodex/codex-app-server-protocol/v2/AppInfo";
import type { ListMcpServerStatusResponse } from "@nodex/codex-app-server-protocol/v2/ListMcpServerStatusResponse";
import type { McpResourceReadParams } from "@nodex/codex-app-server-protocol/v2/McpResourceReadParams";
import type { McpResourceReadResponse } from "@nodex/codex-app-server-protocol/v2/McpResourceReadResponse";
import type { McpServerToolCallParams } from "@nodex/codex-app-server-protocol/v2/McpServerToolCallParams";
import type { McpServerToolCallResponse } from "@nodex/codex-app-server-protocol/v2/McpServerToolCallResponse";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexToolRuntime } from "./CodexToolRuntime";

export interface CodexToolRuntimePromiseAdapter {
  readonly readResource: (params: McpResourceReadParams) => Promise<McpResourceReadResponse>;
  readonly callTool: (params: McpServerToolCallParams) => Promise<McpServerToolCallResponse>;
  readonly listApps: () => Promise<AppInfo[]>;
  readonly listServerStatuses: () => Promise<ListMcpServerStatusResponse>;
}

export const makeCodexToolRuntimePromiseAdapter = (
  runtime: CodexToolRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): CodexToolRuntimePromiseAdapter => ({
  readResource: (params) => callbacks.runPromise(runtime.readResource(params)),
  callTool: (params) => callbacks.runPromise(runtime.callTool(params)),
  listApps: () => callbacks.runPromise(runtime.listApps).then((apps) => [...apps]),
  listServerStatuses: () => callbacks.runPromise(runtime.listServerStatuses),
});
