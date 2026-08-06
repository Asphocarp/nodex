import { describe, expect, test } from "vitest";
import type { BlockRecordWindow } from "../../shared/block-records";
import { projectBlockRecordWindowToBoard } from "./block-record-board-projection";

const windowWith = (
  records: BlockRecordWindow["records"],
  positions: BlockRecordWindow["viewPositions"],
  content: BlockRecordWindow["content"] = [],
): BlockRecordWindow => ({
  libraryId: "library-1",
  rootParent: { kind: "dataSource", dataSourceId: "source-1" },
  viewId: "view-1",
  records,
  placements: records.map((record, index) => ({
    blockId: record.id,
    parent: { kind: "dataSource", dataSourceId: "source-1" },
    rankKey: `${index.toString().padStart(4, "0")}`,
    revision: 0,
  })),
  viewPositions: positions,
  content,
  observedLocalCommit: { storeEpoch: "epoch-1", commitSeq: 4 },
  continuation: null,
});

const record = (
  id: string,
  kind: string,
  properties: Readonly<Record<string, unknown>> = {},
) => ({
  id,
  libraryId: "library-1",
  kind,
  lifecycle: "active" as const,
  properties,
  contentShardId: "shard-1",
  revision: 0,
});

describe("BlockRecord Board projection", () => {
  test("projects direct Page records and ignores descendants", () => {
    const board = projectBlockRecordWindowToBoard(windowWith(
      [
        record("page-a", "page", { title: "A", status: "build" }),
        record("child-a", "paragraph", { title: "Child" }),
        record("page-b", "page", { title: "B", status: "triage" }),
      ],
      [
        {
          viewId: "view-1",
          dataSourceId: "source-1",
          blockId: "page-b",
          groupKey: "triage",
          rankKey: "0002",
          revision: 0,
        },
        {
          viewId: "view-1",
          dataSourceId: "source-1",
          blockId: "page-a",
          groupKey: "build",
          rankKey: "0001",
          revision: 0,
        },
      ],
    ));

    expect(board.columns.find((column) => column.id === "build")?.cards.map((card) => card.id)).toEqual(["page-a"]);
    expect(board.columns.find((column) => column.id === "triage")?.cards.map((card) => card.title)).toEqual(["B"]);
    expect(board.columns.flatMap((column) => column.cards).map((card) => card.id)).not.toContain("child-a");
  });

  test("uses the LocalCommit view position immediately for a newly promoted Page", () => {
    const board = projectBlockRecordWindowToBoard(windowWith(
      [record("page-new", "page", { title: "Promoted" })],
      [{
        viewId: "view-1",
        dataSourceId: "source-1",
        blockId: "page-new",
        groupKey: "review",
        rankKey: "8000",
        revision: 0,
      }],
    ));

    expect(board.columns.find((column) => column.id === "review")?.cards[0]).toMatchObject({
      id: "page-new",
      title: "Promoted",
      status: "review",
    });
  });

  test("uses the canonical title content instead of stale record metadata", () => {
    const board = projectBlockRecordWindowToBoard(windowWith(
      [record("page-a", "page", { title: "stale metadata", status: "build" })],
      [{
        viewId: "view-1",
        dataSourceId: "source-1",
        blockId: "page-a",
        groupKey: "build",
        rankKey: "0001",
        revision: 1,
      }],
      [{
        blockId: "page-a",
        slot: "title",
        content: [{ type: "text", text: "canonical title", styles: {} }],
        shardId: "shard-1",
        head: 2,
      }],
    ));

    expect(board.columns.find((column) => column.id === "build")?.cards[0]).toMatchObject({
      id: "page-a",
      title: "canonical title",
    });
  });
});
