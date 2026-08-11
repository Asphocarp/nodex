import type { Session } from "electron";
import {
  MCP_APP_SANDBOX_PARTITION_PREFIX,
  parseMcpAppSandboxPartition,
  parseMcpAppSandboxSourceUrl,
  type ParsedMcpAppSandboxSource,
} from "../../shared/mcp-app/mcp-app-sandbox-contract";

export interface McpAppPendingAttachment {
  initId: string;
  origin: string;
  partition: string;
  sandboxId: string;
  session: Session;
  skybridgeCacheState?: "cold" | "warming" | "warm";
  source: ParsedMcpAppSandboxSource;
  sourceUrl: string;
}

export type McpAppAttachmentDecision =
  | {
    ok: true;
    initId: string;
    sandboxId: string;
    source: ParsedMcpAppSandboxSource;
  }
  | {
    ok: false;
    reason:
      | "invalid-init-id"
      | "invalid-partition"
      | "invalid-source";
  };

export function isMcpAppSandboxPartition(value: string | null | undefined): boolean {
  return value?.startsWith(MCP_APP_SANDBOX_PARTITION_PREFIX) === true;
}

export function decideMcpAppWebviewAttachment(input: {
  partition: string | null | undefined;
  src: string | null | undefined;
}): McpAppAttachmentDecision {
  const partition = input.partition ?? "";
  const sandboxId = parseMcpAppSandboxPartition(partition);
  if (!sandboxId) return { ok: false, reason: "invalid-partition" };

  const source = parseMcpAppSandboxSourceUrl(input.src ?? "");
  if (!source) return { ok: false, reason: "invalid-source" };
  if (!source.initId) return { ok: false, reason: "invalid-init-id" };

  return {
    ok: true,
    initId: source.initId,
    sandboxId,
    source,
  };
}
