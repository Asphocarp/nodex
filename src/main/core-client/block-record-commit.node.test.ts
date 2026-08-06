import { describe, expect, test } from "vitest";

import { applyBlockRecordWithResolution } from "./block-record-commit";
import { CoreModuleResponseError } from "./core-client";
import { FakeCoreClient } from "./testing/fake-core-client";
import type {
  BlockRecordApplyInput,
  BlockRecordCommittedValue,
  LocalMutationResolveInput,
} from "./types";

const input: BlockRecordApplyInput = {
  operation_id: "operation:response-loss",
  intent_hash: "a".repeat(64),
  commit_id: "commit:response-loss",
  canonical_hash: "b".repeat(64),
  actor_id: "actor:test",
  session_id: "session:test",
  committed_at: "2026-08-06T00:00:00Z",
  operation: { kind: "ensure_data_source", data_source_id: "board:test" },
};

const committed: BlockRecordCommittedValue = {
  actor_id: input.actor_id,
  audience: { kind: "library", project_ids: [] },
  canonical_hash: input.canonical_hash,
  commit_id: input.commit_id,
  committed_at: input.committed_at,
  cursor: { store_epoch: "epoch:test", commit_seq: 4 },
  duplicate: true,
  effects: [],
  intent_hash: input.intent_hash,
  operation_id: input.operation_id,
  payload_completeness: "rich",
  session_id: input.session_id,
};

class ResponseLossClient extends FakeCoreClient {
  resolvedInput: LocalMutationResolveInput | undefined;

  override blockRecordApply(): ReturnType<FakeCoreClient["blockRecordApply"]> {
    return Promise.reject(new Error("socket closed after Core commit"));
  }

  override resolveLocalMutation(
    resolveInput: LocalMutationResolveInput,
  ): ReturnType<FakeCoreClient["resolveLocalMutation"]> {
    this.resolvedInput = resolveInput;
    return Promise.resolve(committed);
  }
}

class DefinitiveCoreErrorClient extends FakeCoreClient {
  override blockRecordApply(): ReturnType<FakeCoreClient["blockRecordApply"]> {
    return Promise.reject(new CoreModuleResponseError({
      code: "revision_conflict",
      message: "BlockRecord revision is stale",
      retryable: false,
      recovery: { kind: "none" },
    }));
  }
}

describe("BlockRecord apply response-loss resolution", () => {
  test("resolves the original operation instead of generating a retry identity", async () => {
    const client = new ResponseLossClient();

    await expect(applyBlockRecordWithResolution({
      client,
      input,
      storeEpoch: "epoch:test",
    })).resolves.toBe(committed);
    expect(client.resolvedInput).toEqual({
      store_epoch: "epoch:test",
      operation_id: input.operation_id,
      intent_hash: input.intent_hash,
    });
  });

  test("does not resolve a definitive Core validation error", async () => {
    const client = new DefinitiveCoreErrorClient();

    await expect(applyBlockRecordWithResolution({
      client,
      input,
      storeEpoch: "epoch:test",
    })).rejects.toMatchObject({
      coreError: { code: "revision_conflict" },
    });
  });
});
