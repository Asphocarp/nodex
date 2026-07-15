import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { parseNfm } from "../nfm/parser";
import { serializeNfm } from "../nfm/serializer";
import type { NfmBlock } from "../nfm/types";
import {
  BlockDocumentCodecError,
  createCardDocumentGenesis,
  materializeCardDocument,
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

const requireCardMention = (block: NfmBlock | undefined) => {
  if (block?.type !== "mentionCard") {
    throw new Error("Expected a mentionCard Block");
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
    expect(block.cardId).toBe("legacy-card");
    expect(serializeNfm([block])).toBe(source);
  });

  test("decodes historical canonical Card references as Card mention URLs", () => {
    const block = requireCardMention(
      parseNfm(
        '<card-ref target-block="target-card" display-hint="A &amp; B" project="stale" card="stale-card" />',
      )[0],
    );

    expect(block.targetBlockId).toBe("target-card");
    expect(serializeNfm([block])).toBe(
      '<mention-card url="nodex://cards/target-card" />',
    );
  });

  test("canonicalizes accepted Card mention URL variants and rejects invalid targets", () => {
    const block = requireCardMention(
      parseNfm(
        '<mention-card url="nodex:///cards/card%2Fone?block=ignored" />',
      )[0],
    );
    expect(serializeNfm([block])).toBe(
      '<mention-card url="nodex://cards/card%2Fone" />',
    );
    expect(() =>
      parseNfm('<mention-card url="https://example.com/card" />'),
    ).toThrow("Card mention URL must identify a Nodex Card");
  });

  test("does not serialize a historical owning Card without identity", () => {
    expect(() => serializeNfm(parseNfm("<card />"))).toThrow(
      "Canonical Card NFM requires an exact non-empty uuid",
    );
  });

  test("round-trips canonical Card and Database View refs through the BlockNote adapter", () => {
    const source = [
      '<mention-card url="nodex://cards/card-1" />',
      '<database-view-ref database-view="view-1" display-hint="Roadmap" />',
    ].join("\n");
    const nfmBlocks = parseNfm(source);
    const blockNoteBlocks = nfmToBlockNote(nfmBlocks);
    const roundTrip = blockNoteToNfm(blockNoteBlocks);

    expect(blockNoteBlocks[0]?.type).toBe("cardRef");
    expect(blockNoteBlocks[0]?.props?.targetBlockId).toBe("card-1");
    expect(blockNoteBlocks[0]?.children?.length).toBe(0);
    expect(blockNoteBlocks[1]?.type).toBe("databaseViewRef");
    expect(blockNoteBlocks[1]?.props?.databaseViewId).toBe("view-1");
    expect(blockNoteBlocks[1]?.children?.length).toBe(0);
    expect(serializeNfm(roundTrip)).toBe([
      '<mention-card url="nodex://cards/card-1" />',
      '<database-view-ref database-view="view-1" display-hint="Roadmap" />',
    ].join("\n"));
  });

  test("round-trips Template and Card shell projection syntax without foreign bodies", () => {
    const source = [
      '<template-ref source-block="template-1" display-hint="Incident &amp; review" />',
      '<card uuid="nested-card" />',
    ].join("\n");
    const nfmBlocks = parseNfm(source);
    const blockNoteBlocks = nfmToBlockNote(nfmBlocks);
    const roundTrip = blockNoteToNfm(blockNoteBlocks);

    expect(blockNoteBlocks[0]?.type).toBe("templateRef");
    expect(blockNoteBlocks[0]?.props?.displayHint).toBe("Incident & review");
    expect(blockNoteBlocks[0]?.children?.length).toBe(0);
    expect(blockNoteBlocks[1]?.type).toBe("card");
    expect(blockNoteBlocks[1]?.id).toBe("nested-card");
    expect(blockNoteBlocks[1]?.children?.length).toBe(0);
    expect(serializeNfm(roundTrip)).toBe([
      '<template-ref source-block="template-1" display-hint="Incident &amp; review" />',
      '<card uuid="nested-card" />',
    ].join("\n"));
  });

  test("hoists attempted children out of canonical reference Blocks", () => {
    const blocks = parseNfm(
      [
        '<mention-card url="nodex://cards/card-1" />',
        "\tCard child",
        '<database-view-ref database-view="view-1" />',
        "\tView child",
        '<template-ref source-block="template-1" />',
        "\tTemplate child",
        '<card uuid="nested-card" />',
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
      '<mention-card url="nodex://cards/card-1" />',
      '<database-view-ref database-view="view-1" />',
    ]) {
      const genesis = createCardDocumentGenesis({
        documentId: `childless-${nfm.length}`,
        title: "References",
        nfm,
      });
      appendParagraphChild(genesis.document);
      let message = "";
      try {
        materializeCardDocument(genesis.document);
      } catch (error) {
        if (error instanceof BlockDocumentCodecError) message = error.message;
      }
      expect(message.includes("must not contain child Blocks")).toBe(true);
    }
  });

  test("materialization separates canonical references from legacy projections", () => {
    const materialization = createCardDocumentGenesis({
      documentId: "reference-kinds",
      title: "References",
      nfm: [
        '<mention-card url="nodex://cards/card-1" />',
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
    const genesis = createCardDocumentGenesis({
      documentId: "historical-reference-hint",
      title: "References",
      nfm: '<card-ref target-block="card-1" display-hint="Old title" />',
    });
    expect(genesis.materialization.nfm).toBe(
      '<mention-card url="nodex://cards/card-1" />',
    );
    genesis.document.destroy();
  });
});
