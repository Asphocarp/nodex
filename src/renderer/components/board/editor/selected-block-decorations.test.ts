import { MultipleNodeSelection } from "@blocknote/core/extensions";
import { Schema, type Node } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, test } from "vite-plus/test";

import { collectSelectedBlockDecorationRanges } from "./selected-block-decorations";

const schema = new Schema({
  nodes: {
    doc: { content: "blockGroup" },
    blockGroup: { content: "blockContainer*" },
    blockContainer: {
      attrs: { id: {} },
      content: "blockContent blockGroup?",
    },
    paragraph: {
      content: "text*",
      group: "blockContent",
    },
    atom: {
      atom: true,
      group: "blockContent",
    },
    text: { group: "inline" },
  },
  marks: {},
});

function paragraph(id: string, text: string) {
  return schema.node("blockContainer", { id }, [
    schema.node("paragraph", null, text ? schema.text(text) : undefined),
  ]);
}

function atom(id: string) {
  return schema.node("blockContainer", { id }, [schema.node("atom")]);
}

function fixtureDoc() {
  return schema.node("doc", null, [
    schema.node("blockGroup", null, [
      paragraph("before", "123456789"),
      atom("atomic"),
      paragraph("after", "after"),
    ]),
  ]);
}

function blockPosition(doc: Node, id: string) {
  let match: { node: Node; pos: number } | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name !== "blockContainer" || node.attrs.id !== id) return true;
    match = { node, pos };
    return false;
  });
  if (!match) throw new Error(`Missing fixture Block ${id}`);
  return match;
}

function inlinePosition(doc: Node, blockId: string, offset: number) {
  const block = blockPosition(doc, blockId);
  return block.pos + 2 + offset;
}

describe("selected Block decorations", () => {
  test("decorates an atomic content NodeSelection through its stable Block container", () => {
    const doc = fixtureDoc();
    const atomic = blockPosition(doc, "atomic");
    const selection = NodeSelection.create(doc, atomic.pos + 1);

    expect(collectSelectedBlockDecorationRanges(doc, selection)).toEqual([
      {
        from: atomic.pos,
        to: atomic.pos + atomic.node.nodeSize,
        kind: "structural",
      },
    ]);
  });

  test("decorates every Block in a structural multiple selection", () => {
    const doc = fixtureDoc();
    const before = blockPosition(doc, "before");
    const atomic = blockPosition(doc, "atomic");
    const selection = MultipleNodeSelection.create(
      doc,
      before.pos,
      atomic.pos + atomic.node.nodeSize,
    );

    expect(collectSelectedBlockDecorationRanges(doc, selection)).toEqual([
      {
        from: before.pos,
        to: before.pos + before.node.nodeSize,
        kind: "structural",
      },
      {
        from: atomic.pos,
        to: atomic.pos + atomic.node.nodeSize,
        kind: "structural",
      },
    ]);
  });

  test("does not decorate an unrelated atomic Block after a text selection", () => {
    const doc = fixtureDoc();
    const selection = TextSelection.create(
      doc,
      inlinePosition(doc, "before", 6),
      inlinePosition(doc, "before", 7),
    );

    expect(collectSelectedBlockDecorationRanges(doc, selection)).toEqual([]);
  });

  test("does not decorate an atomic Block when a text range ends before it", () => {
    const doc = fixtureDoc();
    const selection = TextSelection.create(
      doc,
      inlinePosition(doc, "before", 6),
      inlinePosition(doc, "before", 9),
    );

    expect(collectSelectedBlockDecorationRanges(doc, selection)).toEqual([]);
  });

  test("decorates an atomic Block only when a text range fully contains it", () => {
    const doc = fixtureDoc();
    const atomic = blockPosition(doc, "atomic");
    const selection = TextSelection.create(
      doc,
      inlinePosition(doc, "before", 6),
      inlinePosition(doc, "after", 2),
    );

    expect(collectSelectedBlockDecorationRanges(doc, selection)).toEqual([
      {
        from: atomic.pos,
        to: atomic.pos + atomic.node.nodeSize,
        kind: "atomic-range",
      },
    ]);
  });
});
