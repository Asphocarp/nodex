import { describe, expect, it } from "vitest";

import { blockRecordCommitToLocalCommit } from "./block-record-local-commit";

describe("blockRecordCommitToLocalCommit", () => {
  it("expands a promotion into canonical record and placement effects", () => {
    const envelope = blockRecordCommitToLocalCommit({
      cursor: { store_epoch: "epoch:a", commit_seq: 7 },
      commit_id: "commit:a",
      operation_id: "operation:a",
      intent_hash: "a".repeat(64),
      canonical_hash: "b".repeat(64),
      actor_id: "actor:a",
      session_id: "session:a",
      committed_at: "2026-08-06T00:00:00Z",
      effects: [{
        kind: "promotion",
        value: {
          blockId: "block:a",
          from: { kind: "block", id: "page:source" },
          to: { kind: "data_source", id: "source:a" },
          rankKey: "a",
          blockRevision: 1,
          placementRevision: 1,
        },
      }],
      audience: { kind: "library", projectIds: [] },
      payload_completeness: "rich",
      duplicate: false,
    });

    expect(envelope).toMatchObject({
      cursor: { storeEpoch: "epoch:a", commitSeq: 7 },
      payloadCompleteness: "rich",
      audience: { kind: "library", projectIds: [] },
      effects: [
        { kind: "record", value: { blockId: "block:a", kind: "page" } },
        {
          kind: "placement",
          value: {
            blockId: "block:a",
            from: "block:page:source",
            to: "data_source:source:a",
          },
        },
      ],
    });
  });

  it("fails closed for an audience that is not Core-shaped", () => {
    expect(() => blockRecordCommitToLocalCommit({
      cursor: { store_epoch: "epoch:a", commit_seq: 1 },
      commit_id: "commit:a",
      operation_id: "operation:a",
      intent_hash: "a".repeat(64),
      canonical_hash: "b".repeat(64),
      actor_id: "actor:a",
      session_id: "session:a",
      committed_at: "2026-08-06T00:00:00Z",
      effects: [],
      audience: { kind: "window", windowId: "renderer:a" },
      payload_completeness: "rich",
      duplicate: false,
    })).toThrow(/audience/iu);
  });
});
