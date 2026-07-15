import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { NodexAgentReadError } from "./read-support";

export interface NodexAgentCallKey {
  readonly threadId: string;
  readonly callId: string;
  readonly projectId: string;
  readonly tool: string;
}

export interface NodexAgentCallReceiptRow {
  readonly call_identity: string;
  readonly thread_id: string;
  readonly call_id: string;
  readonly project_id: string;
  readonly tool: string;
  readonly request_hash: string;
  readonly mutation_id: string;
  readonly allocations_json: string;
  readonly result_metadata_json: string;
  readonly status: "prepared" | "committed";
}

export function nodexAgentCallIdentity(key: Pick<NodexAgentCallKey, "threadId" | "callId" | "tool">): string {
  return createHash("sha256")
    .update(JSON.stringify([key.threadId, key.callId, key.tool]))
    .digest("hex");
}

export function readNodexAgentCallReceipt(
  database: Database.Database,
  identity: string,
): NodexAgentCallReceiptRow | null {
  return (database.prepare(
    `
    SELECT
      call_identity, thread_id, call_id, project_id, tool, request_hash,
      mutation_id, allocations_json, result_metadata_json, status
    FROM nodex_agent_call_receipts
    WHERE call_identity = ?
    LIMIT 1
  `).get(identity) as NodexAgentCallReceiptRow | undefined) ?? null;
}

export function requireMatchingNodexAgentCallReceipt(
  receipt: NodexAgentCallReceiptRow,
  key: NodexAgentCallKey,
  requestHash: string,
): void {
  if (
    receipt.thread_id === key.threadId
    && receipt.call_id === key.callId
    && receipt.project_id === key.projectId
    && receipt.tool === key.tool
    && receipt.request_hash === requestHash
  ) {
    return;
  }
  throw new NodexAgentReadError(
    "idempotency_collision",
    "This dynamic call identity is already bound to different semantics",
    false,
    "none",
    { domainCode: "call_identity_collision" },
  );
}
