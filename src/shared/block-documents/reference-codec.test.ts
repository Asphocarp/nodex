import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { parseNfm } from "../nfm/parser";
import { serializeNfm } from "../nfm/serializer";
import type { NfmBlock } from "../nfm/types";
import {
  BlockDocumentCodecError,
  createPageDocumentGenesis,
  materializePageDocument,
} from "./block-document-codec";
import {
  isLegacyForeignBodyReference,
  type BlockDocumentReference,
} from "./derived-records";
import { blockNoteToNfm, nfmToBlockNote } from "./nfm-blocknote-adapter";

const requireCardRef = (block: NfmBlock | undefined) => {
  if (block?.type !== "cardRef") {
    throw new Error("Expected a cardRef Block");
  }
  return block;
};

const requirePageRef = (block: NfmBlock | undefined) => {
  if (block?.type !== "pageRef") {
    throw new Error("Expected a pageRef Block");
  }
  return block;
};

const appendParagraphChild = (document: Y.Doc): void => {
  const root = document.getXmlFragment("body").get(0);
  if (!(root instanceof Y.XmlElement)) throw new Error("Missing body root");
  const reference = root.get(0);
  if (!(reference instanceof Y.XmlElement))
    throw new Error("Missing reference");
  const childGroup = new Y.XmlElement("blockGroup");
  const childContainer = new Y.XmlElement("blockContainer");
  childContainer.setAttribute("id", "nested-under-reference");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.setAttribute("backgroundColor", "default");
  paragraph.setAttribute("textAlignment", "left");
  paragraph.setAttribute("textColor", "default");
  const text = new Y.XmlText();
  text.insert(0, "Hidden child");
  paragraph.insert(0, [text]);
  childContainer.insert(0, [paragraph]);
  childGroup.insert(0, [childContainer]);
  reference.insert(reference.length, [childGroup]);
};

describe("Block-first reference codec", () => {
  test("keeps legacy Card NFM readable without classifying it as canonical", () => {
    const source = '<card-ref project="legacy-project" card="legacy-card" />';
    const block = requireCardRef(parseNfm(source)[0]);

    expect(block.sourceProjectId).toBe("legacy-project");
    expect(block.pageId).toBe("legacy-card");
    expect(serializeNfm([block])).toBe(source);
  });

  test("decodes historical canonical Card references as Page reference URLs", () => {
    const block = requirePageRef(
      parseNfm(
        '<card-ref target-block="target-card" display-hint="A &amp; B" project="stale" card="stale-card" />',
      )[0],
    );

    expect(block.targetBlockId).toBe("target-card");
    expect(serializeNfm([block])).toBe(
      '<page-ref url="nodex://pages/target-card" />',
    );
  });

  test("canonicalizes accepted Page reference URL variants and rejects invalid targets", () => {
    const block = requirePageRef(
      parseNfm(
        '<page-ref url="nodex:///pages/card%2Fone?block=ignored" />',
      )[0],
    );
    expect(serializeNfm([block])).toBe(
      '<page-ref url="nodex://pages/card%2Fone" />',
    );
    expect(() =>
      parseNfm('<page-ref url="https://example.com/card" />'),
    ).toThrow("Page reference URL must identify a Nodex Page");
  });

  test("does not serialize an owning Page without identity", () => {
    expect(() => serializeNfm(parseNfm("<page />"))).toThrow(
      "Canonical Page NFM requires an exact non-empty uuid",
    );
  });

  test("round-trips canonical Page and Database View refs through the BlockNote adapter", () => {
    const source = [
      '<page-ref url="nodex://pages/card-1" />',
      '<database-view-ref database-view="view-1" display-hint="Roadmap" />',
    ].join("\n");
    const nfmBlocks = parseNfm(source);
    const blockNoteBlocks = nfmToBlockNote(nfmBlocks);
    const roundTrip = blockNoteToNfm(blockNoteBlocks);

    expect(blockNoteBlocks[0]?.type).toBe("pageRef");
    expect(blockNoteBlocks[0]?.props?.targetBlockId).toBe("card-1");
    expect(blockNoteBlocks[0]?.children?.length).toBe(0);
    expect(blockNoteBlocks[1]?.type).toBe("databaseViewRef");
    expect(blockNoteBlocks[1]?.props?.databaseViewId).toBe("view-1");
    expect(blockNoteBlocks[1]?.children?.length).toBe(0);
    expect(serializeNfm(roundTrip)).toBe([
      '<page-ref url="nodex://pages/card-1" />',
      '<database-view-ref database-view="view-1" display-hint="Roadmap" />',
    ].join("\n"));
  });

  test("round-trips Template and Card shell projection syntax without foreign bodies", () => {
    const source = [
      '<template-ref source-block="template-1" display-hint="Incident &amp; review" />',
      '<page uuid="nested-card" />',
      '<database uuid="nested-database" />',
    ].join("\n");
    const nfmBlocks = parseNfm(source);
    const blockNoteBlocks = nfmToBlockNote(nfmBlocks);
    const roundTrip = blockNoteToNfm(blockNoteBlocks);

    expect(blockNoteBlocks[0]?.type).toBe("templateRef");
    expect(blockNoteBlocks[0]?.props?.displayHint).toBe("Incident & review");
    expect(blockNoteBlocks[0]?.children?.length).toBe(0);
    expect(blockNoteBlocks[1]?.type).toBe("page");
    expect(blockNoteBlocks[1]?.id).toBe("nested-card");
    expect(blockNoteBlocks[1]?.children?.length).toBe(0);
    expect(blockNoteBlocks[2]?.type).toBe("database");
    expect(blockNoteBlocks[2]?.id).toBe("nested-database");
    expect(blockNoteBlocks[2]?.children?.length).toBe(0);
    expect(serializeNfm(roundTrip)).toBe([
      '<template-ref source-block="template-1" display-hint="Incident &amp; review" />',
      '<page uuid="nested-card" />',
      '<database uuid="nested-database" />',
    ].join("\n"));
  });

  test("hoists attempted children out of canonical reference Blocks", () => {
    const blocks = parseNfm(
      [
        '<page-ref url="nodex://pages/card-1" />',
        "\tCard child",
        '<database-view-ref database-view="view-1" />',
        "\tView child",
        '<template-ref source-block="template-1" />',
        "\tTemplate child",
        '<page uuid="nested-card" />',
        "\tCard shell child",
      ].join("\n"),
    );

    expect(blocks.length).toBe(8);
    expect(blocks[0]?.children.length).toBe(0);
    expect(blocks[2]?.children.length).toBe(0);
    expect(blocks[4]?.children.length).toBe(0);
    expect(blocks[6]?.children.length).toBe(0);
  });

  test("rejects persisted children beneath canonical Card and Database references", () => {
    for (const nfm of [
      '<page-ref url="nodex://pages/card-1" />',
      '<database-view-ref database-view="view-1" />',
    ]) {
      const genesis = createPageDocumentGenesis({
        documentId: `childless-${nfm.length}`,
        title: "References",
        nfm,
      });
      appendParagraphChild(genesis.document);
      let message = "";
      try {
        materializePageDocument(genesis.document);
      } catch (error) {
        if (error instanceof BlockDocumentCodecError) message = error.message;
      }
      expect(message.includes("must not contain child Blocks")).toBe(true);
    }
  });

  test("materialization separates canonical references from legacy projections", () => {
    const materialization = createPageDocumentGenesis({
      documentId: "reference-kinds",
      title: "References",
      nfm: [
        '<page-ref url="nodex://pages/card-1" />',
        '<database-view-ref database-view="view-1" display-hint="Roadmap" />',
        '<card-ref project="legacy-project" card="legacy-card" />',
        '<toggle-list-inline-view project="legacy-project" />',
      ].join("\n"),
    }).materialization;

    expect(
      materialization.references.map((reference) => reference.kind).join(","),
    ).toBe("block,database_view,legacy_card_projection,legacy_database_query");
    expect(
      materialization.references
        .filter(isLegacyForeignBodyReference)
        .map((reference) => reference.kind)
        .join(","),
    ).toBe("legacy_card_projection,legacy_database_query");
    expect(
      materialization.references
        .filter((reference) => !isLegacyForeignBodyReference(reference))
        .map((reference) => reference.kind)
        .join(","),
    ).toBe("block,database_view");
  });

  test("the legacy foreign-body predicate does not reject canonical targets", () => {
    const canonicalReferences: BlockDocumentReference[] = [
      {
        kind: "block",
        sourceBlockId: "source-card",
        targetBlockId: "target-card",
      },
      {
        kind: "database_view",
        sourceBlockId: "source-view",
        databaseViewId: "view-1",
      },
    ];

    expect(canonicalReferences.some(isLegacyForeignBodyReference)).toBe(false);
  });

  test("discards historical Card display snapshots before materialization", () => {
    const genesis = createPageDocumentGenesis({
      documentId: "historical-reference-hint",
      title: "References",
      nfm: '<card-ref target-block="card-1" display-hint="Old title" />',
    });
    expect(genesis.materialization.nfm).toBe(
      '<page-ref url="nodex://pages/card-1" />',
    );
    genesis.document.destroy();
  });
});
