import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  BLOCK_GROUP_NODE_NAME,
  createPageDocument,
  replaceYTextWithPortableRichText,
} from "../../shared/block-documents";
import {
  captureBlockDocumentChangeState,
  deriveBlockDocumentTouchedIds,
} from "./block-document-change-set";

interface TestBlock {
  readonly id: string;
  readonly type?: string;
  readonly text?: string;
  readonly bold?: boolean;
  readonly children?: readonly TestBlock[];
}

const makeBlockContainer = (block: TestBlock): Y.XmlElement => {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", block.id);
  const content = new Y.XmlElement(block.type ?? "paragraph");
  const text = new Y.XmlText();
  text.applyDelta([
    {
      insert: block.text ?? "",
      ...(block.bold ? { attributes: { bold: true } } : {}),
    },
  ]);
  content.insert(0, [text]);
  container.insert(0, [content]);

  if ((block.children?.length ?? 0) > 0) {
    const childGroup = new Y.XmlElement(BLOCK_GROUP_NODE_NAME);
    childGroup.insert(0, block.children?.map(makeBlockContainer) ?? []);
    container.insert(1, [childGroup]);
  }
  return container;
};

const makeDocument = (
  documentId: string,
  title: string,
  blocks: readonly TestBlock[],
): Y.Doc => {
  const envelope = createPageDocument({ documentId, initialTitle: title });
  const root = envelope.body.toArray()[0];
  if (!(root instanceof Y.XmlElement)) {
    throw new TypeError("Expected Card body root");
  }
  root.insert(0, blocks.map(makeBlockContainer));
  return envelope.document;
};

const derive = (
  before: Y.Doc,
  after: Y.Doc,
): readonly string[] => {
  try {
    return deriveBlockDocumentTouchedIds({
      ownerBlockId: "owner-card",
      before: captureBlockDocumentChangeState(before),
      after: captureBlockDocumentChangeState(after),
    });
  } finally {
    before.destroy();
    after.destroy();
  }
};

describe("deriveBlockDocumentTouchedIds", () => {
  test("does not report unchanged application content from different Yjs structs", () => {
    const touched = derive(
      makeDocument("before", "Title", [{ id: "a", text: "Alpha" }]),
      makeDocument("after", "Title", [{ id: "a", text: "Alpha" }]),
    );
    expect(JSON.stringify(touched)).toBe("[]");
  });

  test("derives title, text, type, and formatting changes without client hints", () => {
    const titleTouched = derive(
      makeDocument("before", "Title", [{ id: "a", text: "Alpha" }]),
      makeDocument("after", "Changed", [{ id: "a", text: "Alpha" }]),
    );
    expect(JSON.stringify(titleTouched)).toBe('["owner-card"]');

    const richTitleBefore = makeDocument("rich-before", "Title", [
      { id: "a", text: "Alpha" },
    ]);
    const richTitleAfter = makeDocument("rich-after", "Title", [
      { id: "a", text: "Alpha" },
    ]);
    replaceYTextWithPortableRichText(richTitleAfter.getText("title"), [
      { type: "text", text: "Title", styles: { italic: true } },
    ]);
    expect(derive(richTitleBefore, richTitleAfter)).toEqual(["owner-card"]);

    const textTouched = derive(
      makeDocument("before", "Title", [{ id: "a", text: "Alpha" }]),
      makeDocument("after", "Title", [{ id: "a", text: "Beta" }]),
    );
    expect(JSON.stringify(textTouched)).toBe('["a"]');

    const typeTouched = derive(
      makeDocument("before", "Title", [{ id: "a", text: "Alpha" }]),
      makeDocument("after", "Title", [
        { id: "a", type: "heading", text: "Alpha" },
      ]),
    );
    expect(JSON.stringify(typeTouched)).toBe('["a"]');

    const formatTouched = derive(
      makeDocument("before", "Title", [{ id: "a", text: "Alpha" }]),
      makeDocument("after", "Title", [
        { id: "a", text: "Alpha", bold: true },
      ]),
    );
    expect(JSON.stringify(formatTouched)).toBe('["a"]');
  });

  test("derives creation, deletion, parent, and order changes by stable ID", () => {
    const createDeleteTouched = derive(
      makeDocument("before", "Title", [
        { id: "a", text: "Alpha" },
        { id: "deleted", text: "Gone" },
      ]),
      makeDocument("after", "Title", [
        { id: "a", text: "Alpha" },
        { id: "created", text: "New" },
      ]),
    );
    expect(JSON.stringify(createDeleteTouched)).toBe('["created","deleted"]');

    const orderTouched = derive(
      makeDocument("before", "Title", [
        { id: "a", text: "Alpha" },
        { id: "b", text: "Beta" },
      ]),
      makeDocument("after", "Title", [
        { id: "b", text: "Beta" },
        { id: "a", text: "Alpha" },
      ]),
    );
    expect(JSON.stringify(orderTouched)).toBe('["a","b"]');

    const parentTouched = derive(
      makeDocument("before", "Title", [
        {
          id: "a",
          text: "Alpha",
          children: [{ id: "child", text: "Nested" }],
        },
        { id: "b", text: "Beta" },
      ]),
      makeDocument("after", "Title", [
        { id: "a", text: "Alpha" },
        {
          id: "b",
          text: "Beta",
          children: [{ id: "child", text: "Nested" }],
        },
      ]),
    );
    expect(JSON.stringify(parentTouched)).toBe('["a","b","child"]');
  });
});
