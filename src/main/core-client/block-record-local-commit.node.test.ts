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

  it("preserves Database receipt effects inside the canonical LocalCommit", () => {
    const envelope = blockRecordCommitToLocalCommit({
      cursor: { store_epoch: "epoch:a", commit_seq: 8 },
      commit_id: "commit:database",
      operation_id: "operation:database",
      intent_hash: "a".repeat(64),
      canonical_hash: "b".repeat(64),
      actor_id: "actor:a",
      session_id: "session:a",
      committed_at: "2026-08-06T00:00:00Z",
      effects: [{
        kind: "database",
        value: {
          value: { operation_count: 1 },
          receipt: {
            operation_id: "operation:database",
            operation_kinds: ["put_property"],
          },
          event_sequence: 41,
          store_epoch: "epoch:a",
        },
      }],
      audience: { kind: "library", projectIds: [] },
      payload_completeness: "rich",
      duplicate: false,
    });

    expect(envelope.effects).toEqual([{
      kind: "database",
      value: {
        value: { operation_count: 1 },
        receipt: {
          operation_id: "operation:database",
          operation_kinds: ["put_property"],
        },
        eventSequence: 41,
        storeEpoch: "epoch:a",
      },
    }]);
  });

  it("preserves Library receipts inside the canonical LocalCommit", () => {
    const envelope = blockRecordCommitToLocalCommit({
      cursor: { store_epoch: "epoch:a", commit_seq: 11 },
      commit_id: "commit:library",
      operation_id: "operation:library",
      intent_hash: "a".repeat(64),
      canonical_hash: "b".repeat(64),
      actor_id: "agent:project:a",
      session_id: "agent-grants:project:a",
      committed_at: "2026-08-06T00:00:00Z",
      effects: [{
        kind: "library",
        value: {
          value: { affected_resource_ids: ["page:a"] },
          receipt: { operation_kind: "persist_agent_project_resource_grants" },
          event_sequence: 12,
          store_epoch: "epoch:a",
        },
      }],
      audience: { kind: "library", projectIds: [] },
      payload_completeness: "rich",
      duplicate: false,
    });

    expect(envelope.effects).toEqual([{
      kind: "library",
      value: {
        value: { affected_resource_ids: ["page:a"] },
        receipt: { operation_kind: "persist_agent_project_resource_grants" },
        eventSequence: 12,
        storeEpoch: "epoch:a",
      },
    }]);
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

  it("parses canonical Data Source property-value effects", () => {
    const envelope = blockRecordCommitToLocalCommit({
      cursor: { store_epoch: "epoch:a", commit_seq: 9 },
      commit_id: "commit:values",
      operation_id: "operation:values",
      intent_hash: "a".repeat(64),
      canonical_hash: "b".repeat(64),
      actor_id: "actor:a",
      session_id: "session:a",
      committed_at: "2026-08-06T00:00:00Z",
      effects: [{
        kind: "property_values",
        value: {
          blockId: "page:a",
          dataSourceId: "source:a",
          values: [{ propertyId: "status", value: "done", revision: 4 }],
          revision: 6,
        },
      }],
      audience: { kind: "library", projectIds: [] },
      payload_completeness: "rich",
      duplicate: false,
    });

    expect(envelope.effects).toEqual([{
      kind: "property_values",
      value: {
        blockId: "page:a",
        dataSourceId: "source:a",
        values: [{ propertyId: "status", value: "done", revision: 4 }],
        revision: 6,
      },
    }]);
  });

  it("parses canonical View-position removals", () => {
    const envelope = blockRecordCommitToLocalCommit({
      cursor: { store_epoch: "epoch:a", commit_seq: 10 },
      commit_id: "commit:view-remove",
      operation_id: "operation:view-remove",
      intent_hash: "a".repeat(64),
      canonical_hash: "b".repeat(64),
      actor_id: "actor:a",
      session_id: "session:a",
      committed_at: "2026-08-06T00:00:00Z",
      effects: [{
        kind: "view_position_remove",
        value: {
          viewId: "view:a",
          dataSourceId: "source:a",
          blockId: "page:a",
          revision: 5,
        },
      }],
      audience: { kind: "library", projectIds: [] },
      payload_completeness: "rich",
      duplicate: false,
    });

    expect(envelope.effects).toEqual([{
      kind: "view_position_remove",
      value: {
        viewId: "view:a",
        dataSourceId: "source:a",
        blockId: "page:a",
        revision: 5,
      },
    }]);
  });
});
