import { describe, expect, it } from "vitest";

import { createRecordBackedBlockNoteAdapter } from "./record-backed-blocknote-adapter";
import type { BlockRecordWindow } from "./contracts";

const windowFor = (rootParent: BlockRecordWindow["rootParent"]): BlockRecordWindow => ({
  libraryId: "library:test",
  rootParent,
  records: [
    {
      id: "title-a",
      libraryId: "library:test",
      kind: "paragraph",
      lifecycle: "active",
      properties: {},
      contentShardId: "shard:a",
      revision: 1,
    },
    {
      id: "child-a",
      libraryId: "library:test",
      kind: "paragraph",
      lifecycle: "active",
      properties: {},
      contentShardId: "shard:a",
      revision: 1,
    },
  ],
  placements: [
    {
      blockId: "title-a",
      parent: rootParent,
      rankKey: "a",
      revision: 1,
    },
    {
      blockId: "child-a",
      parent: { kind: "block", blockId: "title-a" },
      rankKey: "a",
      revision: 1,
    },
  ],
  content: [],
  observedLocalCommit: { storeEpoch: "epoch:test", commitSeq: 4 },
  continuation: null,
});

describe("RecordBackedBlockNoteAdapter", () => {
  it("keeps BlockNote identity stable when ownership parent changes", () => {
    const adapter = createRecordBackedBlockNoteAdapter();
    const previous = windowFor({ kind: "library", libraryId: "library:test" });
    const next = windowFor({ kind: "dataSource", dataSourceId: "board:test" });

    const result = adapter.reconcile(previous, next);

    expect(result.addedBlockIds).toEqual([]);
    expect(result.removedBlockIds).toEqual([]);
    expect(result.changedBlockIds).toEqual([]);
    expect(result.materialization.blockIds).toEqual(["title-a", "child-a"]);
  });

  it("reports content or record revisions without treating a move as a new Block", () => {
    const adapter = createRecordBackedBlockNoteAdapter();
    const previous = windowFor({ kind: "library", libraryId: "library:test" });
    const next = {
      ...windowFor({ kind: "library", libraryId: "library:test" }),
      records: windowFor({ kind: "library", libraryId: "library:test" }).records.map(
        (record, index) => index === 0 ? { ...record, revision: 2 } : record,
      ),
    } satisfies BlockRecordWindow;

    const result = adapter.reconcile(previous, next);

    expect(result.changedBlockIds).toEqual(["title-a"]);
    expect(result.materialization.observedLocalCommit.commitSeq).toBe(4);
  });
});
