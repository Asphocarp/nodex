import { describe, expect, it } from "vitest";
import type { LocalCommitEnvelope } from "../local-commit";
import type { BlockRecordWindow } from "./contracts";
import { applyLocalCommitToBlockRecordWindow } from "./local-commit-projection";

const windowFor = (): BlockRecordWindow => ({
  libraryId: "library-1",
  rootParent: { kind: "library", libraryId: "library-1" },
  viewId: null,
  records: [
    {
      id: "page-a",
      libraryId: "library-1",
      kind: "paragraph",
      lifecycle: "active",
      properties: {},
      contentShardId: "shard-a",
      revision: 1,
    },
  ],
  placements: [{
    blockId: "page-a",
    parent: { kind: "library", libraryId: "library-1" },
    rankKey: "a",
    revision: 1,
  }],
  viewPositions: [],
  content: [],
  observedLocalCommit: { storeEpoch: "epoch-1", commitSeq: 1 },
  continuation: null,
});

const commit = (effects: LocalCommitEnvelope["effects"], commitSeq = 2): LocalCommitEnvelope => ({
  cursor: { storeEpoch: "epoch-1", commitSeq },
  commitId: `commit-${commitSeq}`,
  operationId: `operation-${commitSeq}`,
  intentHash: "intent-hash",
  canonicalHash: "canonical-hash",
  committedAt: "2026-08-06T00:00:00.000Z",
  actorId: "actor",
  sessionId: "session",
  payloadCompleteness: "rich",
  audience: { kind: "library", projectIds: [] },
  effects,
});

describe("BlockRecord local commit projection", () => {
  it("moves a page in the local window without rereading its descendants", () => {
    const result = applyLocalCommitToBlockRecordWindow(windowFor(), commit([
      {
        kind: "placement",
        value: {
          blockId: "page-a",
          from: "library",
          to: "library",
          rankKey: "m",
          revision: 2,
        },
      },
    ]));

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.window.placements[0]?.parent).toEqual({
      kind: "library",
      libraryId: "library-1",
    });
    expect(result.window.observedLocalCommit.commitSeq).toBe(2);
  });

  it("applies a materialized content effect to an already loaded slot", () => {
    const current = {
      ...windowFor(),
      content: [{
        blockId: "page-a",
        slot: "inline" as const,
        content: [{ type: "text", text: "before" }],
        crdt: {
          fullStateV1: [],
          stateVectorV1: [],
          stateHash: "old-hash",
        },
        shardId: "shard-a",
        head: 1,
      }],
    };
    const result = applyLocalCommitToBlockRecordWindow(current, commit([
      {
        kind: "content",
        value: {
          blockId: "page-a",
          slot: "inline",
          shardId: "shard-a",
          head: 2,
          stateHash: null,
          materializedJson: [{ type: "text", text: "after" }],
        },
      },
    ]));

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.window.content[0]).toMatchObject({
      blockId: "page-a",
      slot: "inline",
      content: [{ type: "text", text: "after" }],
      head: 2,
      crdt: { stateHash: "old-hash" },
    });
  });

  it("requests a read for content effects outside a sparse window", () => {
    const result = applyLocalCommitToBlockRecordWindow(windowFor(), commit([
      {
        kind: "content",
        value: {
          blockId: "missing",
          slot: "inline",
          shardId: "shard-a",
          head: 1,
          materializedJson: [],
        },
      },
    ]));

    expect(result).toMatchObject({ kind: "requires_read" });
  });

  it("creates a missing content slot when the commit carries the materialization", () => {
    const result = applyLocalCommitToBlockRecordWindow(windowFor(), commit([
      {
        kind: "content",
        value: {
          blockId: "page-a",
          slot: "title",
          shardId: "shard-a",
          head: 0,
          materializedJson: [{ type: "text", text: "Page A" }],
        },
      },
    ]));

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.window.content).toEqual([{
      blockId: "page-a",
      slot: "title",
      content: [{ type: "text", text: "Page A" }],
      shardId: "shard-a",
      head: 0,
    }]);
  });

  it("requests a bounded reread when a rich effect targets an absent record", () => {
    const result = applyLocalCommitToBlockRecordWindow(windowFor(), commit([
      {
        kind: "record",
        value: {
          blockId: "missing",
          kind: "page",
          lifecycle: "active",
          revision: 1,
        },
      },
    ]));

    expect(result).toMatchObject({ kind: "requires_read" });
  });

  it("moves a rich record out of one window and into another without rereading", () => {
    const richEffects: LocalCommitEnvelope["effects"] = [
      {
        kind: "record",
        value: {
          blockId: "page-a",
          kind: "page",
          lifecycle: "active",
          revision: 0,
          libraryId: "library-1",
          properties: { title: "Page A" },
          contentShardId: "shard-a",
        },
      },
      {
        kind: "placement",
        value: {
          blockId: "page-a",
          from: "library",
          to: "data_source:board-1",
          rankKey: "m",
          revision: 2,
        },
      },
    ];
    const source = applyLocalCommitToBlockRecordWindow(windowFor(), commit(richEffects));
    expect(source).toMatchObject({ kind: "applied" });
    if (source.kind !== "applied") return;
    expect(source.window.records).toEqual([]);
    expect(source.window.placements).toEqual([]);

    const target: BlockRecordWindow = {
      ...windowFor(),
      rootParent: { kind: "dataSource", dataSourceId: "board-1" },
      records: [],
      placements: [],
    };
    const targetResult = applyLocalCommitToBlockRecordWindow(target, commit(richEffects));
    expect(targetResult).toMatchObject({ kind: "applied" });
    if (targetResult.kind !== "applied") return;
    expect(targetResult.window.records[0]?.id).toBe("page-a");
    expect(targetResult.window.placements[0]?.parent).toEqual({
      kind: "dataSource",
      dataSourceId: "board-1",
    });
  });

  it("removes an archived descendant from the loaded window", () => {
    const current: BlockRecordWindow = {
      ...windowFor(),
      records: [
        ...windowFor().records,
        {
          id: "child-a",
          libraryId: "library-1",
          kind: "paragraph",
          lifecycle: "active",
          properties: {},
          contentShardId: "shard-child-a",
          revision: 0,
        },
      ],
      placements: [
        ...windowFor().placements,
        {
          blockId: "child-a",
          parent: { kind: "block", blockId: "page-a" },
          rankKey: "b",
          revision: 0,
        },
      ],
    };
    const result = applyLocalCommitToBlockRecordWindow(current, commit([
      {
        kind: "remove",
        value: { blockId: "child-a", lifecycle: "archived", revision: 1 },
      },
    ]));

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.window.records.map((record) => record.id)).toEqual(["page-a"]);
    expect(result.window.placements.map((placement) => placement.blockId)).toEqual(["page-a"]);
  });

  it("ignores a commit already covered by the read cursor", () => {
    const result = applyLocalCommitToBlockRecordWindow(windowFor(), commit([], 1));
    expect(result).toMatchObject({ kind: "ignored" });
  });
});
