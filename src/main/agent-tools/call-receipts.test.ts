import { describe, expect, test } from "vitest";

import {
  nodexAgentAuthorityFingerprint,
  type FrozenNodexAgentTurnAuthority,
} from "../../shared/nodex-agent-authority";
import {
  requireMatchingNodexAgentCallReceipt,
  type NodexAgentCallKey,
  type NodexAgentCallReceiptRow,
} from "./call-receipts";

const authority: FrozenNodexAgentTurnAuthority = {
  threadId: "thread-authority",
  turnId: "turn-authority",
  rootThreadId: "thread-authority",
  actorProjectId: "project-actor",
  libraryId: "library-current",
  storeEpoch: "epoch-current",
  scope: "library",
  source: "builtin_full_access",
};

const key: NodexAgentCallKey = {
  threadId: authority.threadId,
  callId: "call-write",
  projectId: authority.actorProjectId,
  tool: "update_page",
  authority,
};

const receipt = (
  overrides: Partial<NodexAgentCallReceiptRow> = {},
): NodexAgentCallReceiptRow => ({
  call_identity: "a".repeat(64),
  thread_id: key.threadId,
  turn_id: authority.turnId,
  call_id: key.callId,
  project_id: key.projectId,
  tool: key.tool,
  request_hash: "b".repeat(64),
  mutation_id: "mutation-call-write",
  authority_fingerprint: nodexAgentAuthorityFingerprint(authority),
  provenance_version: 1,
  allocations_json: "[]",
  result_metadata_json: "{}",
  status: "committed",
  ...overrides,
});

describe("Nodex Agent call receipt provenance", () => {
  test("accepts exact v1 authority provenance and rejects a different Turn", () => {
    expect(() => requireMatchingNodexAgentCallReceipt(
      receipt(),
      key,
      "b".repeat(64),
    )).not.toThrow();

    expect(() => requireMatchingNodexAgentCallReceipt(
      receipt(),
      {
        ...key,
        authority: { ...authority, turnId: "turn-other" },
      },
      "b".repeat(64),
    )).toThrow("already bound to different semantics");
  });

  test("replays historical committed receipts but rejects historical prepared receipts", () => {
    const legacyProvenance = {
      turn_id: null,
      authority_fingerprint: null,
      provenance_version: null,
    } as const;
    expect(() => requireMatchingNodexAgentCallReceipt(
      receipt({ ...legacyProvenance, status: "committed" }),
      key,
      "b".repeat(64),
    )).not.toThrow();

    expect(() => requireMatchingNodexAgentCallReceipt(
      receipt({ ...legacyProvenance, status: "prepared" }),
      key,
      "b".repeat(64),
    )).toThrow("already bound to different semantics");
  });
});
