import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION,
  nodexAgentAuthorityFingerprint,
  type FrozenNodexAgentTurnAuthority,
} from "../../shared/nodex-agent-authority";
import { NodexAgentReadError } from "./read-support";

export interface NodexAgentCallKey {
  readonly threadId: string;
  readonly callId: string;
  readonly projectId: string;
  readonly tool: string;
  readonly authority?: FrozenNodexAgentTurnAuthority;
}

export interface NodexAgentCallReceiptRow {
  readonly call_identity: string;
  readonly thread_id: string;
  readonly turn_id: string | null;
  readonly call_id: string;
  readonly project_id: string;
  readonly tool: string;
  readonly request_hash: string;
  readonly mutation_id: string;
  readonly authority_fingerprint: string | null;
  readonly provenance_version: number | null;
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
      call_identity, thread_id, turn_id, call_id, project_id, tool, request_hash,
      mutation_id, authority_fingerprint, provenance_version,
      allocations_json, result_metadata_json, status
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
  const baseMatches = (
    receipt.thread_id === key.threadId
    && receipt.call_id === key.callId
    && receipt.project_id === key.projectId
    && receipt.tool === key.tool
    && receipt.request_hash === requestHash
  );
  if (baseMatches && !key.authority) return;
  if (baseMatches && key.authority) {
    const fingerprint = nodexAgentAuthorityFingerprint(key.authority);
    if (
      receipt.turn_id === key.authority.turnId
      && receipt.authority_fingerprint === fingerprint
      && receipt.provenance_version === NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION
    ) {
      return;
    }
    if (
      receipt.status === "committed"
      && receipt.turn_id === null
      && receipt.authority_fingerprint === null
      && receipt.provenance_version === null
    ) {
      return;
    }
  }
  throw new NodexAgentReadError(
    "idempotency_collision",
    "This dynamic call identity is already bound to different semantics",
    false,
    "none",
    { domainCode: "call_identity_collision" },
  );
}

export function nodexAgentCallProvenance(
  key: Pick<NodexAgentCallKey, "authority">,
): readonly [string | null, string | null, number | null] {
  if (!key.authority) return [null, null, null];
  return [
    key.authority.turnId,
    nodexAgentAuthorityFingerprint(key.authority),
    NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION,
  ];
}
