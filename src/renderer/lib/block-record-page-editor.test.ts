import { describe, expect, it } from "vitest";
import type {
  BlockRecordApplyInput,
  BlockRecordCommittedValue,
} from "../../shared/core-modules/block-record-module";
import type {
  BlockRecordWindow,
} from "../../shared/block-records";
import type { BlockNoteBlockValue } from "../../shared/block-documents/nfm-blocknote-adapter";
import type { BlockRecordWindowStore } from "./block-record-window-store";
import { createRecordBackedPageEditorSession } from "./block-record-page-editor";

const committed = {} as BlockRecordCommittedValue;

const windowFor = (pageId: string, childIds: readonly string[] = []): BlockRecordWindow => ({
  libraryId: "library:test",
  rootParent: { kind: "block", blockId: pageId },
  viewId: null,
  records: [
    {
      id: pageId,
      libraryId: "library:test",
      kind: "page",
      lifecycle: "active",
      properties: {},
      contentShardId: `shard:${pageId}`,
      revision: 0,
    },
    ...childIds.map((id) => ({
      id,
      libraryId: "library:test",
      kind: "paragraph" as const,
      lifecycle: "active" as const,
      properties: {},
      contentShardId: `shard:${id}`,
      revision: 0,
    })),
  ],
  placements: [
    {
      blockId: pageId,
      parent: { kind: "library", libraryId: "library:test" },
      rankKey: "a",
      revision: 0,
    },
    ...childIds.map((id, index) => ({
      blockId: id,
      parent: { kind: "block" as const, blockId: pageId },
      rankKey: String.fromCharCode("a".charCodeAt(0) + index),
      revision: 0,
    })),
  ],
  viewPositions: [],
  content: [
    {
      blockId: pageId,
      slot: "title",
      content: [{ type: "text", text: "Page" }],
      shardId: `shard:${pageId}`,
      head: 0,
    },
    ...childIds.map((id) => ({
      blockId: id,
      slot: "inline",
      content: [],
      shardId: `shard:${id}`,
      head: 0,
    })),
  ],
  observedLocalCommit: { storeEpoch: "epoch:test", commitSeq: 0 },
  continuation: null,
});

const fakeStore = (
  initial: BlockRecordWindow,
  readByParent: ReadonlyMap<string, BlockRecordWindow> = new Map(),
) => {
  let snapshot: BlockRecordWindow | null = initial;
  const applied: BlockRecordApplyInput[] = [];
  const store: BlockRecordWindowStore = {
    getSnapshot: () => snapshot,
    read: async (read) => {
      const parentId = read.parent?.kind === "block" ? read.parent.id : undefined;
      return readByParent.get(parentId ?? "") ?? snapshot ?? initial;
    },
    load: async (read) => {
      const next = await store.read(read);
      snapshot = next;
      return next;
    },
    apply: async (input) => {
      applied.push(input);
      return committed;
    },
    applyCommit: () => null,
    subscribe: () => () => {},
    startCommitSubscription: () => () => {},
  };
  return { store, applied };
};

const paragraph = (
  id: string,
  text: string,
  children: readonly BlockNoteBlockValue[] = [],
): BlockNoteBlockValue => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text }],
  children,
});

const sessionFor = (
  pageId: string,
  store: BlockRecordWindowStore,
) => createRecordBackedPageEditorSession({
  pageId,
  windowStore: store,
  actorId: "actor:test",
  sessionId: "session:test",
  createOperationId: () => "operation:test",
});

describe("record-backed Page editor", () => {
  it("saves the complete BlockNote tree as one reconcile operation", async () => {
    const { store, applied } = fakeStore(windowFor("page:a", ["child:a"]));
    const session = sessionFor("page:a", store);

    await session.saveBody([
      paragraph("child:a", "edited"),
      paragraph("child:b", "new"),
    ]);

    expect(applied).toHaveLength(1);
    const operation = applied[0]?.operation;
    expect(operation?.kind).toBe("reconcile_page_tree");
    if (operation?.kind !== "reconcile_page_tree") throw new Error("wrong operation");
    expect(operation.page_id).toBe("page:a");
    expect(operation.nodes.map((node) => node.block_id)).toEqual(["child:a", "child:b"]);
    expect(operation.nodes[0]?.expected_content_revision).toBe(0);
    expect(operation.nodes[0]?.materialized_json).toEqual([{ type: "text", text: "edited" }]);
    expect(operation.nodes[1]?.expected_block_revision).toBeUndefined();
  });

  it("represents editor deletion by omitting the Block from the submitted tree", async () => {
    const { store, applied } = fakeStore(windowFor("page:a", ["child:a"]));
    const session = sessionFor("page:a", store);

    await session.saveBody([]);

    const operation = applied[0]?.operation;
    expect(operation?.kind).toBe("reconcile_page_tree");
    if (operation?.kind !== "reconcile_page_tree") throw new Error("wrong operation");
    expect(operation.nodes).toEqual([]);
  });

  it("moves selected roots with one placement batch", async () => {
    const source = windowFor("page:a", ["child:a"]);
    const target = windowFor("page:b", ["target:a"]);
    const { store, applied } = fakeStore(source, new Map([["page:b", target]]));
    const session = sessionFor("page:a", store);

    await session.moveBlocksToPage(["child:a"], "page:b");

    expect(applied).toHaveLength(1);
    const operation = applied[0]?.operation;
    expect(operation?.kind).toBe("move_many");
    if (operation?.kind !== "move_many") throw new Error("wrong operation");
    expect(operation.entries).toEqual([
      expect.objectContaining({
        block_id: "child:a",
        target_parent: { kind: "block", id: "page:b" },
        expected_block_revision: 0,
        expected_placement_revision: 0,
      }),
    ]);
  });
});
