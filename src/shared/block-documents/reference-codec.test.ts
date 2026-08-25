import { describe, expect, test } from "vite-plus/test";
import * as Y from "yjs";
import { parseNfm } from "../nfm/parser";
import { serializeNfm } from "../nfm/serializer";
import {
  BlockDocumentCodecError,
  createPageDocumentGenesis,
  materializePageDocument,
} from "./block-document-codec";
import { blockNoteToNfm, nfmToBlockNote } from "./nfm-blocknote-adapter";

const appendParagraphChild = (document: Y.Doc): void => {
  const root = document.getXmlFragment("body").get(0);
  if (!(root instanceof Y.XmlElement)) throw new Error("Missing body root");
  const reference = root.get(0);
  if (!(reference instanceof Y.XmlElement)) throw new Error("Missing reference");
  const childGroup = new Y.XmlElement("blockGroup");
  const childContainer = new Y.XmlElement("blockContainer");
  childContainer.setAttribute("id", "nested-under-reference");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.setAttribute("backgroundColor", "default");
  paragraph.setAttribute("textAlignment", "left");
  paragraph.setAttribute("textColor", "default");
  childContainer.insert(0, [paragraph]);
  childGroup.insert(0, [childContainer]);
  reference.insert(reference.length, [childGroup]);
};

describe("Block-first reference codec", () => {
  test("canonicalizes Page reference URLs and rejects non-Nodex targets", () => {
    const [block] = parseNfm('<page-ref url="nodex:///pages/card%2Fone?block=ignored" />');
    expect(block?.type).toBe("pageRef");
    expect(serializeNfm(block ? [block] : [])).toBe('<page-ref url="nodex://pages/card%2Fone" />');
    expect(() => parseNfm('<page-ref url="https://example.com/card" />')).toThrow(
      "Page reference URL must identify a Nodex Page",
    );
  });

  test("requires owning Page identity", () => {
    expect(() => parseNfm("<page />")).toThrow(
      "Canonical Page NFM requires an exact non-empty uuid",
    );
  });

  test("round-trips canonical references through the BlockNote adapter", () => {
    const source = [
      '<page-ref url="nodex://pages/card-1" />',
      '<database-view-ref database-view="view-1" display-hint="Roadmap" />',
      '<template-ref source-block="template-1" display-hint="Incident &amp; review" />',
    ].join("\n");
    const blockNoteBlocks = nfmToBlockNote(parseNfm(source));

    expect(blockNoteBlocks.every((block) => (block.children?.length ?? 0) === 0)).toBe(true);
    expect(serializeNfm(blockNoteToNfm(blockNoteBlocks))).toBe(source);
  });

  test("hoists attempted children out of reference and resource Blocks", () => {
    const blocks = parseNfm(
      [
        '<page-ref url="nodex://pages/card-1" />',
        "\tPage child",
        '<database-view-ref database-view="view-1" />',
        "\tView child",
        '<page uuid="page-shell" />',
        "\tPage shell child",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "pageRef",
      "paragraph",
      "databaseViewRef",
      "paragraph",
      "page",
      "paragraph",
    ]);
  });

  test("rejects persisted children beneath canonical references", () => {
    const genesis = createPageDocumentGenesis({
      documentId: "reference-children",
      title: "References",
      nfm: '<page-ref url="nodex://pages/card-1" />',
    });
    appendParagraphChild(genesis.document);

    expect(() => materializePageDocument(genesis.document)).toThrow(BlockDocumentCodecError);
  });
});
