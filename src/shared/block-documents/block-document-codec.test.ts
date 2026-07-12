import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  BlockDocumentCodecError,
  canonicalizeNfmForBlockDocument,
  createCardDocumentGenesis,
  materializeCardDocument,
  migrateCardDocument,
} from "./block-document-codec";

const FULL_NFM_FIXTURE = [
  "# Heading",
  "Paragraph **bold** with <agent-config mode=\"plan\" model=\"gpt-5.5\" reasoning=\"high\" /> and <mention-thread uuid=\"thread-1\" /> and <mention-date start=\"2026-07-11\" format=\"relative\" />.",
  "- List",
  "\tNested <attachment kind=\"file\" mode=\"materialized\" source=\"nodex://assets/demo.txt\" name=\"demo.txt\" mime=\"text/plain\" bytes=\"12\" />",
  "3. Ordered",
  "- [x] Checked",
  "▶ Collapsed toggle",
  "\tToggle child",
  "> Quoted",
  "---",
  '<callout icon="💡">Callout</callout>',
  '<image source="nodex://assets/image.png">Image caption</image>',
  '<thread-section label="Investigate" thread="thread-2" />',
  '<card-ref project="project-a" card="card-target" />',
  '<card-ref target-block="card-canonical" display-hint="Canonical Card" />',
  '<toggle-list-inline-view project="project-a" rules-v2="eyJtb2RlIjoiYWxsIn0" />',
  '<database-view-ref database-view="view-canonical" display-hint="Planning" />',
  '<card-toggle card="legacy-card" meta="[P1]" project="project-a">',
  "\tLegacy title",
  "\tLegacy child",
  "</card-toggle>",
  "```ts",
  "const value = 1;",
  "```",
  "| Name | Score |",
  "| --- | ---: |",
  "| Nodex | 10 |",
].join("\n");

const flattenIds = (
  blocks: readonly { readonly id: string; readonly children: readonly unknown[] }[],
): string[] =>
  blocks.flatMap((block) => [
    block.id,
    ...flattenIds(
      block.children as readonly {
        readonly id: string;
        readonly children: readonly unknown[];
      }[],
    ),
  ]);

describe("CardDocumentCodec", () => {
  test("excludes imported toggle disclosure state from durable content", () => {
    const nfm = [
      "▼ Expanded toggle",
      "\tExpanded child",
      "▼# Expanded heading",
      "\tHeading child",
    ].join("\n");

    const genesis = createCardDocumentGenesis({
      documentId: "document-codec-local-toggle-state",
      title: "Local disclosure",
      nfm,
    });

    expect(canonicalizeNfmForBlockDocument(nfm)).toBe(
      [
        "▶ Expanded toggle",
        "\tExpanded child",
        "▶# Expanded heading",
        "\tHeading child",
      ].join("\n"),
    );
    expect(genesis.materialization.nfm).toBe(
      canonicalizeNfmForBlockDocument(nfm),
    );
  });

  test("headlessly imports and materializes every supported custom shape", () => {
    let nextId = 0;
    const genesis = createCardDocumentGenesis({
      documentId: "document-codec-all-shapes",
      title: "Shared title",
      nfm: FULL_NFM_FIXTURE,
      allocateBlockId: () => `block-${++nextId}`,
    });

    expect(genesis.materialization.title).toBe("Shared title");
    const replay = createCardDocumentGenesis({
      documentId: "document-codec-all-shapes-replay",
      title: "Shared title",
      nfm: genesis.materialization.nfm,
    });
    expect(replay.materialization.nfm).toBe(genesis.materialization.nfm);
    expect(flattenIds(genesis.materialization.blockTree).length).toBe(nextId);
    expect(new Set(flattenIds(genesis.materialization.blockTree)).size).toBe(
      nextId,
    );
    expect(genesis.materialization.references.length).toBe(6);
    expect(
      genesis.materialization.references.map((reference) => reference.kind).join(","),
    ).toBe(
      "thread,legacy_card_projection,block,legacy_database_query,database_view,legacy_card_projection",
    );
    expect(genesis.materialization.assetRefs.length).toBe(2);
    expect(genesis.materialization.assetRefs[0]?.managedFileName).toBe(
      "demo.txt",
    );
    expect(genesis.materialization.assetRefs[1]?.managedFileName).toBe(
      "image.png",
    );
    expect(genesis.materialization.plainText.includes("demo.txt")).toBe(true);
    expect(genesis.materialization.plainText.includes("gpt-5.5")).toBe(true);
  });

  test("preserves application identities through encoded reload", () => {
    let nextId = 0;
    const genesis = createCardDocumentGenesis({
      documentId: "document-codec-source",
      title: "Reload",
      nfm: "Root\n\t- Child\nSibling",
      allocateBlockId: () => `stable-${++nextId}`,
    });
    const originalIds = flattenIds(genesis.materialization.blockTree).join(",");
    const reloaded = new Y.Doc({ guid: "document-codec-source" });
    Y.applyUpdate(reloaded, genesis.update);

    const materialized = materializeCardDocument(reloaded);

    expect(flattenIds(materialized.blockTree).join(",")).toBe(originalIds);
    expect(materialized.nfm).toBe(genesis.materialization.nfm);
  });

  test("materializes without mutating the authoritative Y.Doc", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "document-codec-pure-read",
      title: "Pure read",
      nfm: "Parent\n\tChild",
    });
    const stateBefore = Array.from(
      Y.encodeStateAsUpdate(genesis.document),
    ).join(",");

    materializeCardDocument(genesis.document);

    expect(Array.from(Y.encodeStateAsUpdate(genesis.document)).join(",")).toBe(
      stateBefore,
    );
  });

  test("creates one authority-owned editable paragraph for blank NFM", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "document-codec-empty",
      title: "Empty",
      nfm: "",
      allocateBlockId: () => "block-empty-root",
    });

    expect(genesis.document.getXmlFragment("body").length).toBe(1);
    expect(genesis.materialization.blockTree).toMatchObject([
      {
        id: "block-empty-root",
        type: "paragraph",
        content: [],
        children: [],
      },
    ]);
    expect(genesis.materialization.nfm).toBe("");
    expect(genesis.materialization.plainText).toBe("");
  });

  test("validates no-op schema migration and rejects unknown versions", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "document-codec-migrate",
      title: "Migrate",
      nfm: "Body",
    });
    const result = migrateCardDocument(genesis.document, 1);
    expect(result.changed).toBe(false);
    expect(result.update.byteLength).toBe(0);

    let message = "";
    try {
      migrateCardDocument(genesis.document, 0);
    } catch (error) {
      if (error instanceof BlockDocumentCodecError) {
        message = error.message;
      }
    }
    expect(message).toBe(
      "No Card Document migration is registered from schema version 0",
    );
  });
});
