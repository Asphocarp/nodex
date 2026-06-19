import { describe, expect, test } from "bun:test";
import { Schema, type Node } from "prosemirror-model";

import { getBlockInfoWithManualOffset } from "../../api/getBlockInfoFromPos.js";
import { getNodeById } from "../../api/nodeUtil.js";
import {
  getSideMenuDragBlockPositionsFromSnapshot,
  type SideMenuBlockPositionRange,
} from "./dragging.js";
import { MultipleNodeSelection } from "./MultipleNodeSelection.js";

const schema = new Schema({
  nodes: {
    doc: { content: "blockGroup" },
    blockGroup: { content: "blockContainer*", group: "childContainer" },
    blockContainer: {
      attrs: { id: {} },
      content: "blockContent blockGroup?",
      group: "bnBlock block",
      toDOM: (node) => ["div", { "data-id": node.attrs.id }, 0],
      parseDOM: [{ tag: "div[data-id]" }],
    },
    paragraph: {
      content: "inline*",
      group: "blockContent",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
  },
  marks: {},
});

function makeParagraph(text: string) {
  return schema.node(
    "paragraph",
    null,
    text.length > 0 ? [schema.text(text)] : undefined,
  );
}

function makeBlock(id: string, text = id, children: Node[] = []) {
  return schema.node(
    "blockContainer",
    { id },
    [
      makeParagraph(text),
      ...(children.length > 0
        ? [schema.node("blockGroup", null, children)]
        : []),
    ],
  );
}

function makeDoc(blocks: Node[]) {
  return schema.node("doc", null, [schema.node("blockGroup", null, blocks)]);
}

function contentBounds(doc: Node, blockId: string) {
  const posInfo = getNodeById(blockId, doc);
  if (!posInfo) {
    throw new Error(`Missing test block ${blockId}`);
  }

  const blockInfo = getBlockInfoWithManualOffset(
    posInfo.node,
    posInfo.posBeforeNode,
  );
  if (!blockInfo.isBlockContainer) {
    throw new Error(`Test block ${blockId} is not a blockContainer`);
  }

  return {
    start: blockInfo.blockContent.beforePos + 1,
    end: blockInfo.blockContent.afterPos - 1,
  };
}

function idsFromRange(doc: Node, range: SideMenuBlockPositionRange | undefined) {
  if (!range) return "";
  return MultipleNodeSelection.create(doc, range.from, range.to)
    .nodes
    .map((node) => node.attrs.id)
    .join(",");
}

function dragIdsFromTextSelection(
  doc: Node,
  draggedBlockId: string,
  selectionFrom: number,
  selectionTo: number,
) {
  const range = getSideMenuDragBlockPositionsFromSnapshot({
    doc,
    draggedBlockId,
    selectionFrom,
    selectionTo,
  });

  return range ? idsFromRange(doc, range) : draggedBlockId;
}

function dragIdsFromSelectedBlockIds(
  doc: Node,
  draggedBlockId: string,
  selectedBlockIds: string[],
) {
  const range = getSideMenuDragBlockPositionsFromSnapshot({
    doc,
    draggedBlockId,
    selectedBlockIds,
  });

  return range ? idsFromRange(doc, range) : draggedBlockId;
}

function makeFlatDoc() {
  return makeDoc([
    makeBlock("block-0"),
    makeBlock("block-1"),
    makeBlock("block-2"),
  ]);
}

function makeNestedDoc() {
  return makeDoc([
    makeBlock("block-0", "block-0", [
      makeBlock("block-01"),
      makeBlock("block-02"),
      makeBlock("block-03"),
    ]),
    makeBlock("block-1"),
    makeBlock("block-2"),
  ]);
}

describe("side-menu drag selection bounds", () => {
  test("excludes the next sibling when selection ends at that block start", () => {
    const doc = makeFlatDoc();
    const block0 = contentBounds(doc, "block-0");
    const block1 = contentBounds(doc, "block-1");

    expect(
      dragIdsFromTextSelection(doc, "block-0", block0.start + 3, block1.start),
    ).toBe("block-0");
    expect(
      dragIdsFromTextSelection(doc, "block-1", block0.start + 3, block1.start),
    ).toBe("block-1");
  });

  test("includes the next sibling when selection enters that block content", () => {
    const doc = makeFlatDoc();
    const block0 = contentBounds(doc, "block-0");
    const block1 = contentBounds(doc, "block-1");

    expect(
      dragIdsFromTextSelection(doc, "block-0", block0.start + 3, block1.start + 1),
    ).toBe("block-0,block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-1", block0.start + 3, block1.start + 1),
    ).toBe("block-0,block-1");
  });

  test("keeps the start block when selection starts at its content end", () => {
    const doc = makeFlatDoc();
    const block0 = contentBounds(doc, "block-0");
    const block1 = contentBounds(doc, "block-1");

    expect(
      dragIdsFromTextSelection(doc, "block-0", block0.end, block1.start + 3),
    ).toBe("block-0,block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-1", block0.end, block1.start + 3),
    ).toBe("block-0,block-1");
  });

  test("does not include an end block just because the start is at the previous block end", () => {
    const doc = makeFlatDoc();
    const block0 = contentBounds(doc, "block-0");
    const block1 = contentBounds(doc, "block-1");

    expect(
      dragIdsFromTextSelection(doc, "block-0", block0.end, block1.start),
    ).toBe("block-0");
    expect(
      dragIdsFromTextSelection(doc, "block-1", block0.end, block1.start),
    ).toBe("block-1");
  });

  test("includes complete middle siblings and excludes an end-at-start sibling", () => {
    const doc = makeFlatDoc();
    const block0 = contentBounds(doc, "block-0");
    const block2 = contentBounds(doc, "block-2");

    expect(
      dragIdsFromTextSelection(doc, "block-0", block0.start + 3, block2.start),
    ).toBe("block-0,block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-1", block0.start + 3, block2.start),
    ).toBe("block-0,block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-2", block0.start + 3, block2.start),
    ).toBe("block-2");
  });

  test("uses the child sibling run when nested selection ends at top-level block start", () => {
    const doc = makeNestedDoc();
    const block02 = contentBounds(doc, "block-02");
    const block1 = contentBounds(doc, "block-1");

    expect(
      dragIdsFromTextSelection(doc, "block-02", block02.start + 3, block1.start),
    ).toBe("block-02,block-03");
    expect(
      dragIdsFromTextSelection(doc, "block-03", block02.start + 3, block1.start),
    ).toBe("block-02,block-03");
    expect(
      dragIdsFromTextSelection(doc, "block-1", block02.start + 3, block1.start),
    ).toBe("block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-0", block02.start + 3, block1.start),
    ).toBe("block-0");
  });

  test("promotes cross-parent candidates to the smallest range that covers the selection", () => {
    const doc = makeNestedDoc();
    const block02 = contentBounds(doc, "block-02");
    const block1 = contentBounds(doc, "block-1");

    expect(
      dragIdsFromTextSelection(doc, "block-02", block02.start + 3, block1.start + 1),
    ).toBe("block-0,block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-03", block02.start + 3, block1.start + 1),
    ).toBe("block-0,block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-1", block02.start + 3, block1.start + 1),
    ).toBe("block-0,block-1");
    expect(
      dragIdsFromTextSelection(doc, "block-01", block02.start + 3, block1.start + 1),
    ).toBe("block-01");
  });

  test("applies the same covering range rule to explicit selected block ids", () => {
    const doc = makeNestedDoc();
    const selectedBlockIds = ["block-02", "block-03", "block-1"];

    expect(dragIdsFromSelectedBlockIds(doc, "block-02", selectedBlockIds)).toBe(
      "block-0,block-1",
    );
    expect(dragIdsFromSelectedBlockIds(doc, "block-1", selectedBlockIds)).toBe(
      "block-0,block-1",
    );
  });

  test("returns no explicit range when there is no selection snapshot", () => {
    const range = getSideMenuDragBlockPositionsFromSnapshot({
      doc: makeFlatDoc(),
      draggedBlockId: "block-1",
    });

    expect(range === undefined).toBeTrue();
  });
});
