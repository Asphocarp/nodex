import { describe, expect, it } from "vitest";

import type {
  BlockContentSnapshot,
  BlockPlacement,
  BlockRecord,
  BlockRecordWindow,
} from "./contracts";
import {
  BlockRecordGraphError,
  materializeBlockRecordWindow,
} from "./record-graph";

const record = (id: string, kind: BlockRecord["kind"] = "paragraph"): BlockRecord => ({
  id,
  libraryId: "library-a",
  kind,
  lifecycle: "active",
  properties: { source: id },
  contentShardId: `shard-${id}`,
  revision: 0,
});

const placement = (
  blockId: string,
  parent: BlockPlacement["parent"],
  rankKey: string,
): BlockPlacement => ({
  blockId,
  parent,
  rankKey,
  revision: 0,
});

const content = (blockId: string, text: string): BlockContentSnapshot => ({
  blockId,
  slot: "inline",
  content: [{ type: "text", text }],
  shardId: `shard-${blockId}`,
  head: 1,
});

const window = (): BlockRecordWindow => ({
  libraryId: "library-a",
  rootParent: { kind: "library", libraryId: "library-a" },
  records: [record("page", "page"), record("title-a", "heading"), record("child")],
  placements: [
    placement("page", { kind: "library", libraryId: "library-a" }, "a"),
    placement("title-a", { kind: "block", blockId: "page" }, "a"),
    placement("child", { kind: "block", blockId: "title-a" }, "a"),
  ],
  content: [content("title-a", "title-A"), content("child", "child")],
  observedLocalCommit: { storeEpoch: "epoch-a", commitSeq: 1 },
  continuation: null,
});

describe("BlockRecord graph materialization", () => {
  it("materializes nested BlockNote values from placements, preserving IDs", () => {
    const materialized = materializeBlockRecordWindow(window());

    expect(materialized).toHaveLength(1);
    const page = materialized[0];
    expect(page).toBeDefined();
    expect(page).toMatchObject({ id: "page", type: "page" });
    const title = page?.children?.[0];
    expect(title).toBeDefined();
    expect(title).toMatchObject({
      id: "title-a",
      type: "heading",
      content: [{ type: "text", text: "title-A" }],
    });
    expect(title?.children?.[0]).toMatchObject({
      id: "child",
      content: [{ type: "text", text: "child" }],
    });
  });

  it("rejects a partial window instead of inventing a second parent authority", () => {
    const source = window();
    const partial: BlockRecordWindow = {
      ...source,
      placements: source.placements.slice(0, 2),
    };

    expect(() => materializeBlockRecordWindow(partial)).toThrowError(
      new BlockRecordGraphError(
        "missing_placement",
        "BlockRecord child has no placement in the window",
      ),
    );
  });

  it("rejects cycles before BlockNote receives a tree", () => {
    const source = window();
    const cyclic: BlockRecordWindow = {
      ...source,
      placements: [
      placement("page", { kind: "block", blockId: "title-a" }, "a"),
      placement("title-a", { kind: "block", blockId: "page" }, "a"),
      placement("child", { kind: "block", blockId: "title-a" }, "b"),
      ],
    };

    expect(() => materializeBlockRecordWindow(cyclic)).toThrowError(
      expect.objectContaining({ code: "cycle" }),
    );
  });
});
