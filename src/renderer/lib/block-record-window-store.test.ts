import type { components } from "@nodex/core-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockRecordCommitToLocalCommit } from "../../shared/block-records";
import type { LocalCommitEnvelope } from "../../shared/local-commit";

const mocks = vi.hoisted(() => ({
  applyBlockRecord: vi.fn(),
  readBlockRecord: vi.fn(),
  subscribeBlockRecordCommits: vi.fn(),
}));

vi.mock("./api", () => mocks);

import { createBlockRecordWindowStore } from "./block-record-window-store";

type Snapshot = components["schemas"]["BlockRecordReadSnapshot"];
type Committed = components["schemas"]["BlockRecordCommittedValue"];

const snapshot = (commitSeq = 0): Snapshot => ({
  library_id: "library-1",
  graph: {
    library_id: "library-1",
    blocks: [],
    placements: [],
  },
  content: [],
  view_positions: [],
  observed_cursor: {
    store_epoch: "epoch-1",
    commit_seq: commitSeq,
  },
});

const createdCommit = (): Committed => ({
  cursor: { store_epoch: "epoch-1", commit_seq: 1 },
  commit_id: "commit:page-a",
  operation_id: "operation:page-a",
  intent_hash: "intent:page-a",
  canonical_hash: "canonical:page-a",
  actor_id: "actor:test",
  session_id: "session:test",
  committed_at: "2026-08-06T00:00:00.000Z",
  effects: [
    {
      kind: "record",
      value: {
        blockId: "page-a",
        libraryId: "library-1",
        kind: "page",
        lifecycle: "active",
        properties: { title: "Page A" },
        contentShardId: "shard:page-a",
        revision: 0,
      },
    },
    {
      kind: "placement",
      value: {
        blockId: "page-a",
        from: null,
        to: { kind: "library" },
        rankKey: "a",
        revision: 0,
      },
    },
  ],
  audience: { kind: "library", projectIds: [] },
  payload_completeness: "rich",
  duplicate: false,
});

describe("BlockRecordWindowStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBlockRecord.mockResolvedValue(snapshot());
    mocks.subscribeBlockRecordCommits.mockImplementation(() => () => {});
  });

  it("projects a create from an empty snapshot and ignores the duplicate tail frame", async () => {
    const committed = createdCommit();
    mocks.applyBlockRecord.mockResolvedValue(committed);
    let tailListener: ((envelope: LocalCommitEnvelope) => void) | undefined;
    mocks.subscribeBlockRecordCommits.mockImplementation((listener) => {
      tailListener = listener;
      return () => {};
    });

    const store = createBlockRecordWindowStore();
    const published: string[] = [];
    store.subscribe((window) => published.push(window.observedLocalCommit.commitSeq.toString()));
    await store.load({ kind: "window", include_content: false });
    store.startCommitSubscription();

    await store.apply({
      operation_id: "operation:page-a",
      intent_hash: "intent:page-a",
      commit_id: "commit:page-a",
      canonical_hash: "canonical:page-a",
      actor_id: "actor:test",
      session_id: "session:test",
      committed_at: "2026-08-06T00:00:00.000Z",
      operation: {
        kind: "create",
        block_id: "page-a",
        block_kind: "page",
        properties: { title: "Page A" },
        content_shard_id: "shard:page-a",
        parent: { kind: "library" },
        rank_key: "a",
      },
    });

    const current = store.getSnapshot();
    expect(current?.records).toEqual([{
      id: "page-a",
      libraryId: "library-1",
      kind: "page",
      lifecycle: "active",
      properties: { title: "Page A" },
      contentShardId: "shard:page-a",
      revision: 0,
    }]);
    expect(current?.placements).toEqual([{
      blockId: "page-a",
      parent: { kind: "library", libraryId: "library-1" },
      rankKey: "a",
      revision: 0,
    }]);
    expect(current?.observedLocalCommit).toEqual({
      storeEpoch: "epoch-1",
      commitSeq: 1,
    });
    expect(published).toEqual(["0", "1"]);

    tailListener?.(blockRecordCommitToLocalCommit(committed));
    expect(published).toEqual(["0", "1"]);
  });

  it("does not let a projection-gap reread overwrite a newer local commit", async () => {
    const committed = createdCommit();
    mocks.applyBlockRecord.mockResolvedValue({
      ...committed,
      effects: [{
        kind: "data_source",
        value: { dataSourceId: "board-1" },
      }],
    });
    mocks.readBlockRecord
      .mockResolvedValueOnce(snapshot(0))
      .mockResolvedValueOnce(snapshot(0));

    const store = createBlockRecordWindowStore();
    const published: number[] = [];
    store.subscribe((window) => published.push(window.observedLocalCommit.commitSeq));
    await store.load({ kind: "window", include_content: false });
    await store.apply({
      operation_id: committed.operation_id,
      intent_hash: committed.intent_hash,
      commit_id: committed.commit_id,
      canonical_hash: committed.canonical_hash,
      actor_id: committed.actor_id,
      session_id: committed.session_id,
      committed_at: committed.committed_at,
      operation: {
        kind: "ensure_data_source",
        data_source_id: "board-1",
      },
    });

    await Promise.resolve();
    expect(published).toEqual([0]);
    expect(store.getSnapshot()?.observedLocalCommit.commitSeq).toBe(0);
  });

  it("projects a Board view position in the same local commit as promotion", async () => {
    const committed: Committed = {
      ...createdCommit(),
      effects: [
        ...createdCommit().effects,
        {
          kind: "view_position",
          value: {
            viewId: "view:board",
            dataSourceId: "board:1",
            blockId: "page-a",
            groupKey: "in_progress",
            rankKey: "m",
            revision: 0,
          },
        },
      ],
    };
    mocks.readBlockRecord.mockResolvedValue({
      ...snapshot(),
      view_positions: [],
    });
    mocks.applyBlockRecord.mockResolvedValue(committed);

    const store = createBlockRecordWindowStore();
    await store.load({
      kind: "window",
      parent: { kind: "data_source", id: "board:1" },
      view_id: "view:board",
      include_content: false,
    });
    await store.apply({
      operation_id: committed.operation_id,
      intent_hash: committed.intent_hash,
      commit_id: committed.commit_id,
      canonical_hash: committed.canonical_hash,
      actor_id: committed.actor_id,
      session_id: committed.session_id,
      committed_at: committed.committed_at,
      operation: {
        kind: "promote_to_page",
        block_id: "page-a",
        data_source_id: "board:1",
        view_id: "view:board",
        view_group_key: "in_progress",
        view_rank_key: "m",
        rank_key: "m",
        expected_block_revision: 0,
        expected_placement_revision: 0,
      },
    });

    expect(store.getSnapshot()?.viewId).toBe("view:board");
    expect(store.getSnapshot()?.viewPositions).toEqual([{
      viewId: "view:board",
      dataSourceId: "board:1",
      blockId: "page-a",
      groupKey: "in_progress",
      rankKey: "m",
      revision: 0,
    }]);
  });

  it("does not let a same-window canonical read regress an admitted apply response", async () => {
    const committed = createdCommit();
    mocks.readBlockRecord
      .mockResolvedValueOnce(snapshot(0))
      .mockResolvedValueOnce(snapshot(0));
    mocks.applyBlockRecord.mockResolvedValue(committed);

    const store = createBlockRecordWindowStore();
    const published: number[] = [];
    store.subscribe((window) => published.push(window.observedLocalCommit.commitSeq));
    const read = { kind: "window" as const, include_content: false };
    await store.load(read);
    await store.apply({
      operation_id: committed.operation_id,
      intent_hash: committed.intent_hash,
      commit_id: committed.commit_id,
      canonical_hash: committed.canonical_hash,
      actor_id: committed.actor_id,
      session_id: committed.session_id,
      committed_at: committed.committed_at,
      operation: {
        kind: "create",
        block_id: "page-a",
        block_kind: "page",
        properties: { title: "Page A" },
        content_shard_id: "shard:page-a",
        parent: { kind: "library" },
        rank_key: "a",
      },
    });

    await expect(store.load(read)).resolves.toBe(store.getSnapshot());
    expect(store.getSnapshot()?.observedLocalCommit.commitSeq).toBe(1);
    expect(store.getSnapshot()?.records[0]?.id).toBe("page-a");
    expect(published).toEqual([0, 1]);
  });
});
