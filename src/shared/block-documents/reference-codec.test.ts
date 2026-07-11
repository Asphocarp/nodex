import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { parseNfm } from "../nfm/parser";
import { serializeNfm } from "../nfm/serializer";
import {
  isCanonicalNfmCardRef,
  isLegacyNfmCardRef,
  type NfmBlock,
} from "../nfm/types";
import {
  BlockDocumentCodecError,
  createCardDocumentGenesis,
  materializeCardDocument,
} from "./block-document-codec";
import { MAX_REFERENCE_DISPLAY_HINT_LENGTH } from "./contracts";
import {
  BlockDocumentDerivedRecordsError,
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

    expect(isLegacyNfmCardRef(block)).toBe(true);
    expect(isCanonicalNfmCardRef(block)).toBe(false);
    expect(block.sourceProjectId).toBe("legacy-project");
    expect(block.cardId).toBe("legacy-card");
    expect(serializeNfm([block])).toBe(source);
  });

  test("canonical Card identity wins over stale legacy locator hints", () => {
    const block = requireCardRef(
      parseNfm(
        '<card-ref target-block="target-card" display-hint="A &amp; B" project="stale" card="stale-card" />',
      )[0],
    );

    expect(isCanonicalNfmCardRef(block)).toBe(true);
    expect(block.targetBlockId).toBe("target-card");
    expect(block.displayHint).toBe("A & B");
    expect(serializeNfm([block])).toBe(
      '<card-ref target-block="target-card" display-hint="A &amp; B" />',
    );
  });

  test("round-trips canonical Card and Database View refs through the BlockNote adapter", () => {
    const source = [
      '<card-ref target-block="card-1" display-hint="Card one" />',
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
    expect(serializeNfm(roundTrip)).toBe(source);
  });

  test("round-trips Template and typed-shell projection syntax without foreign bodies", () => {
    const source = [
      '<template-ref source-block="template-1" display-hint="Incident &amp; review" />',
      '<large-document display-name="Architecture" />',
      '<large-code display-name="Sync adapter" language="typescript" />',
    ].join("\n");
    const nfmBlocks = parseNfm(source);
    const blockNoteBlocks = nfmToBlockNote(nfmBlocks);
    const roundTrip = blockNoteToNfm(blockNoteBlocks);

    expect(blockNoteBlocks[0]?.type).toBe("templateRef");
    expect(blockNoteBlocks[0]?.props?.displayHint).toBe("Incident & review");
    expect(blockNoteBlocks[0]?.children?.length).toBe(0);
    expect(blockNoteBlocks[1]?.type).toBe("largeDocument");
    expect(blockNoteBlocks[1]?.children?.length).toBe(0);
    expect(blockNoteBlocks[2]?.type).toBe("largeCode");
    expect(blockNoteBlocks[2]?.props?.language).toBe("typescript");
    expect(blockNoteBlocks[2]?.children?.length).toBe(0);
    expect(serializeNfm(roundTrip)).toBe(source);
  });

  test("hoists attempted children out of canonical reference Blocks", () => {
    const blocks = parseNfm(
      [
        '<card-ref target-block="card-1" />',
        "\tCard child",
        '<database-view-ref database-view="view-1" />',
        "\tView child",
        '<template-ref source-block="template-1" />',
        "\tTemplate child",
        '<large-document display-name="Document" />',
        "\tDocument shell child",
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
      '<card-ref target-block="card-1" />',
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
        '<card-ref target-block="card-1" display-hint="Card one" />',
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

  test("rejects display hints large enough to become a hidden content snapshot", () => {
    let causeMessage = "";
    try {
      createCardDocumentGenesis({
        documentId: "oversized-reference-hint",
        title: "References",
        nfm: `<card-ref target-block="card-1" display-hint="${"x".repeat(MAX_REFERENCE_DISPLAY_HINT_LENGTH + 1)}" />`,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.cause instanceof BlockDocumentDerivedRecordsError
      ) {
        causeMessage = error.cause.message;
      }
    }

    expect(causeMessage).toBe(
      `Reference display hints must not exceed ${MAX_REFERENCE_DISPLAY_HINT_LENGTH} characters`,
    );
  });
});
