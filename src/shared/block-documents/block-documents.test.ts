import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  BlockDocumentValidationError,
  CardDocumentRootValidationError,
  UnsupportedXmlNodeError,
  assertValidBlockDocument,
  assertValidCardDocumentRoots,
  BodyOnlyBlockDocumentRootValidationError,
  captureXmlSubtreeAt,
  cloneXmlSubtree,
  createBodyOnlyBlockDocument,
  createCardDocument,
  createSyncedBlockDocument,
  deleteXmlSubtreeAt,
  encodeXmlSubtree,
  insertPortableXmlSubtree,
  getRegisteredBlockDocumentSchemaAdapter,
  getOwnedDocumentSchemaRegistration,
  getYjsDocumentSchemaAdapter,
  inspectRegisteredOwnedBlockDocument,
  LARGE_CODE_BLOCK_TYPE,
  LARGE_CODE_DOCUMENT_SCHEMA_KEY,
  LARGE_CODE_DOCUMENT_SCHEMA_VERSION,
  LARGE_DOCUMENT_BLOCK_TYPE,
  LARGE_DOCUMENT_SCHEMA_KEY,
  LARGE_DOCUMENT_SCHEMA_VERSION,
  listBlockDocumentSchemaAdapters,
  openCardDocument,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
  REUSABLE_TEMPLATE_SOURCE_TYPE,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
  SYNCED_BLOCK_SOURCE_TYPE,
  SyncedBlockDocumentRootValidationError,
  scanBlockDocument,
} from ".";

const createBlock = (
  id: string,
  textContent: string,
  children: readonly Y.XmlElement[] = [],
  blockType = "paragraph",
): Y.XmlElement => {
  const block = new Y.XmlElement("blockContainer");
  block.setAttribute("id", id);

  const paragraph = new Y.XmlElement(blockType);
  const text = new Y.XmlText();
  text.applyDelta([
    { insert: textContent, attributes: { bold: {} } },
    { insert: " plain" },
  ]);
  paragraph.insert(0, [text]);
  block.insert(0, [paragraph]);

  if (children.length === 0) {
    return block;
  }

  const childGroup = new Y.XmlElement("blockGroup");
  childGroup.insert(0, [...children]);
  block.insert(1, [childGroup]);
  return block;
};

const getOnlyElement = (parent: Y.XmlFragment | Y.XmlElement): Y.XmlElement => {
  const child = parent.toArray()[0];
  if (!(child instanceof Y.XmlElement)) {
    throw new TypeError("Expected one Y.XmlElement child");
  }
  return child;
};

const getFirstText = (element: Y.XmlElement): Y.XmlText => {
  for (const node of element.createTreeWalker(() => true)) {
    if (node instanceof Y.XmlText) {
      return node;
    }
  }
  throw new TypeError("Expected a Y.XmlText descendant");
};

describe("Card block document envelope", () => {
  test("owns a stable title and body shared-type pair", () => {
    const envelope = createCardDocument({
      documentId: "document-card-1",
      initialTitle: "Shared title",
    });

    expect(envelope.documentId).toBe("document-card-1");
    expect(envelope.title.toString()).toBe("Shared title");
    expect(envelope.body.length).toBe(1);
    expect(openCardDocument(envelope.document).title).toBe(envelope.title);
    expect(openCardDocument(envelope.document).body).toBe(envelope.body);
  });

  test("rejects a document whose canonical roots have incompatible Yjs types", () => {
    const document = new Y.Doc({ guid: "invalid-card-document" });
    document.getXmlFragment("title");

    let error: unknown;
    try {
      openCardDocument(document);
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof TypeError).toBe(true);
  });

  test("resolves typed roots after loading an encoded update into a fresh Y.Doc", () => {
    const source = createCardDocument({
      documentId: "document-persisted-source",
      initialTitle: "Persisted title",
    });
    const group = getOnlyElement(source.body);
    group.insert(0, [createBlock("persisted-block", "Persisted body")]);

    const reloaded = new Y.Doc({ guid: "document-persisted-reloaded" });
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(source.document));
    const envelope = openCardDocument(reloaded);

    expect(envelope.title.toString()).toBe("Persisted title");
    expect(assertValidBlockDocument(envelope.body)[0]?.id).toBe(
      "persisted-block",
    );
  });

  test("rejects an encoded non-text title root after typed Yjs root resolution", () => {
    const malformed = new Y.Doc({ guid: "malformed-title-source" });
    malformed
      .getXmlFragment("title")
      .insert(0, [new Y.XmlElement("paragraph")]);
    const reloaded = new Y.Doc({ guid: "malformed-title-reloaded" });
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(malformed));

    let error: unknown;
    try {
      assertValidCardDocumentRoots(reloaded);
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof CardDocumentRootValidationError).toBe(true);
  });

  test("rejects unsupported named roots carried by an encoded update", () => {
    const source = createCardDocument({
      documentId: "document-hidden-root-source",
    });
    source.document
      .getMap("hidden")
      .set("payload", "not part of the Card envelope");
    const reloaded = new Y.Doc({ guid: "document-hidden-root-reloaded" });
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(source.document));

    let error: unknown;
    try {
      assertValidCardDocumentRoots(reloaded);
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof CardDocumentRootValidationError).toBe(true);
  });
});

describe("registered document-bearing Block envelopes", () => {
  test("keeps every owner/schema registration exact and unambiguous", () => {
    const adapters = listBlockDocumentSchemaAdapters();
    expect(adapters.length).toBe(6);
    expect(
      adapters
        .map(
          (adapter) =>
            `${adapter.ownerType}/${adapter.schemaKey}@${adapter.schemaVersion}:${adapter.contentModel}/${adapter.syncEngine}`,
        )
        .sort()
        .join(","),
    ).toBe(
      [
        "canvas/nodex.canvas@1:scene_graph/canvas_scene",
        "card/nodex.card@1:block_tree/yjs",
        "largeCode/nodex.large-code@1:block_tree/yjs",
        "largeDocument/nodex.large-document@1:block_tree/yjs",
        "reusable_template_source/nodex.reusable-template@1:block_tree/yjs",
        "synced_block_source/nodex.synced-block@1:block_tree/yjs",
      ].join(","),
    );
  });

  test("separates Canvas registration metadata from Yjs inspection", () => {
    const input = {
      ownerType: "canvas",
      schemaKey: "nodex.canvas",
      schemaVersion: 1,
    } as const;
    expect(getOwnedDocumentSchemaRegistration(input)).toEqual({
      kind: "scene_graph",
      contentModel: "scene_graph",
      syncEngine: "canvas_scene",
      ...input,
    });
    expect(() => getYjsDocumentSchemaAdapter(input)).toThrow(
      "uses canvas_scene, not the Yjs sync engine",
    );
  });

  test("dispatches a Synced Block as body-only block_tree content", () => {
    const envelope = createSyncedBlockDocument({
      documentId: "document-synced-source",
    });
    const adapter = getRegisteredBlockDocumentSchemaAdapter({
      ownerType: SYNCED_BLOCK_SOURCE_TYPE,
      schemaKey: SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
      schemaVersion: SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
    });
    const inspection = inspectRegisteredOwnedBlockDocument(envelope.document, {
      ownerType: SYNCED_BLOCK_SOURCE_TYPE,
      schemaKey: SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
      schemaVersion: SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
    });

    expect(adapter.contentModel).toBe("block_tree");
    expect(inspection.envelope.kind).toBe("synced_block");
    expect(JSON.stringify([...envelope.document.share.keys()])).toBe(
      '["body"]',
    );
  });

  test("rejects a Card title root in a Synced Block Document", () => {
    const source = createSyncedBlockDocument({
      documentId: "document-synced-with-title",
    });
    source.document.getText("title").insert(0, "not allowed");

    let error: unknown;
    try {
      inspectRegisteredOwnedBlockDocument(source.document, {
        ownerType: SYNCED_BLOCK_SOURCE_TYPE,
        schemaKey: SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
        schemaVersion: SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof SyncedBlockDocumentRootValidationError).toBe(true);
  });

  test("registers Template and Large Document as distinct body-only schemas", () => {
    const cases = [
      {
        kind: "reusable_template",
        ownerType: REUSABLE_TEMPLATE_SOURCE_TYPE,
        schemaKey: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
      },
      {
        kind: "large_document",
        ownerType: LARGE_DOCUMENT_BLOCK_TYPE,
        schemaKey: LARGE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: LARGE_DOCUMENT_SCHEMA_VERSION,
      },
    ] as const;

    for (const [index, registered] of cases.entries()) {
      const envelope = createBodyOnlyBlockDocument({
        documentId: `document:body-only:${index}`,
        label: registered.kind,
      });
      const inspection = inspectRegisteredOwnedBlockDocument(
        envelope.document,
        registered,
      );
      expect(inspection.envelope.kind).toBe(registered.kind);
      expect(JSON.stringify([...envelope.document.share.keys()])).toBe(
        '["body"]',
      );
      envelope.document.destroy();
    }
  });

  test("Large Code accepts one childless codeBlock and rejects schema drift", () => {
    const valid = createBodyOnlyBlockDocument({
      documentId: "document:code",
      label: "Large Code",
    });
    getOnlyElement(valid.body).insert(0, [
      createBlock("code-content", "const value = 1", [], "codeBlock"),
    ]);
    const inspection = inspectRegisteredOwnedBlockDocument(valid.document, {
      ownerType: LARGE_CODE_BLOCK_TYPE,
      schemaKey: LARGE_CODE_DOCUMENT_SCHEMA_KEY,
      schemaVersion: LARGE_CODE_DOCUMENT_SCHEMA_VERSION,
    });
    expect(inspection.envelope.kind).toBe("large_code");

    const invalid = createBodyOnlyBlockDocument({
      documentId: "document:code-invalid",
      label: "Large Code",
    });
    getOnlyElement(invalid.body).insert(0, [
      createBlock("not-code", "paragraph"),
    ]);
    let error: unknown;
    try {
      inspectRegisteredOwnedBlockDocument(invalid.document, {
        ownerType: LARGE_CODE_BLOCK_TYPE,
        schemaKey: LARGE_CODE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: LARGE_CODE_DOCUMENT_SCHEMA_VERSION,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof TypeError).toBe(true);
    valid.document.destroy();
    invalid.document.destroy();
  });

  test("all new body-only schemas reject a synthetic title root", () => {
    const envelope = createBodyOnlyBlockDocument({
      documentId: "document:template-with-title",
      label: "Reusable Template",
    });
    envelope.document.getText("title").insert(0, "not a Card");
    let error: unknown;
    try {
      inspectRegisteredOwnedBlockDocument(envelope.document, {
        ownerType: REUSABLE_TEMPLATE_SOURCE_TYPE,
        schemaKey: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof BodyOnlyBlockDocumentRootValidationError).toBe(true);
    envelope.document.destroy();
  });
});

describe("Block document structural validation", () => {
  test("indexes nested application block IDs and their owning parents", () => {
    const envelope = createCardDocument({ documentId: "document-scan" });
    const nested = createBlock("block-child", "Child");
    const root = getOnlyElement(envelope.body);
    root.insert(0, [createBlock("block-root", "Root", [nested])]);

    const blocks = assertValidBlockDocument(envelope.body);

    expect(blocks.length).toBe(2);
    expect(blocks[0]?.id).toBe("block-root");
    expect(blocks[0]?.parentBlockId).toBe(null);
    expect(blocks[0]?.text).toBe("Root plain");
    expect(blocks[1]?.id).toBe("block-child");
    expect(blocks[1]?.parentBlockId).toBe("block-root");
    expect(blocks[1]?.text).toBe("Child plain");
  });

  test("reports missing and duplicate application identities", () => {
    const envelope = createCardDocument({ documentId: "document-invalid" });
    const group = getOnlyElement(envelope.body);
    const missing = createBlock("temporary", "Missing");
    missing.removeAttribute("id");
    group.insert(0, [
      createBlock("duplicate", "First"),
      createBlock("duplicate", "Second"),
      missing,
    ]);

    const scan = scanBlockDocument(envelope.body);
    expect(scan.blocks.length).toBe(1);
    expect(scan.issues.length).toBe(2);
    expect(scan.issues[0]?.code).toBe("duplicate_block_id");
    expect(scan.issues[1]?.code).toBe("missing_block_id");

    let error: unknown;
    try {
      assertValidBlockDocument(envelope.body);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof BlockDocumentValidationError).toBe(true);
  });

  test("rejects body content outside the BlockNote blockGroup/container hierarchy", () => {
    const envelope = createCardDocument({ documentId: "document-rogue-body" });
    const rogueParagraph = new Y.XmlElement("paragraph");
    const rogueText = new Y.XmlText();
    rogueText.insert(0, "outside a Block container");
    rogueParagraph.insert(0, [rogueText]);
    envelope.body.insert(0, [rogueParagraph]);

    const scan = scanBlockDocument(envelope.body);
    expect(scan.issues[0]?.code).toBe("unexpected_xml_node");

    let error: unknown;
    try {
      assertValidBlockDocument(envelope.body);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof BlockDocumentValidationError).toBe(true);
  });

  test("rejects multiple root block groups", () => {
    const envelope = createCardDocument({
      documentId: "document-multiple-roots",
    });
    envelope.body.insert(1, [new Y.XmlElement("blockGroup")]);

    const scan = scanBlockDocument(envelope.body);
    expect(scan.issues[0]?.code).toBe("unexpected_xml_node");
  });

  test("rejects Y.XmlText embeds that the relocation codec cannot encode", () => {
    const envelope = createCardDocument({ documentId: "document-text-embed" });
    const group = getOnlyElement(envelope.body);
    const block = createBlock("embed-block", "Before");
    group.insert(0, [block]);
    getFirstText(block).insertEmbed(0, { unsupported: true });

    const scan = scanBlockDocument(envelope.body);
    expect(
      scan.issues.some((issue) => issue.code === "unsupported_xml_text_embed"),
    ).toBe(true);
  });

  test("rejects nested shared types in XML attributes before persistence", () => {
    const envelope = createCardDocument({
      documentId: "document-shared-attribute",
    });
    const group = getOnlyElement(envelope.body);
    const block = createBlock("shared-attribute-block", "Content");
    group.insert(0, [block]);
    block.setAttribute("invalid", new Y.Map() as unknown as string);

    const scan = scanBlockDocument(envelope.body);
    expect(
      scan.issues.some((issue) => issue.code === "unsupported_xml_value"),
    ).toBe(true);
  });
});

describe("portable Y.Xml subtree codec", () => {
  test("preserves optional undefined attributes used by BlockNote schemas", () => {
    const sourceDocument = new Y.Doc();
    const source = new Y.XmlElement("attachment");
    sourceDocument.getXmlFragment("body").insert(0, [source]);
    source.setAttribute("origin", undefined as unknown as string);

    const cloned = cloneXmlSubtree(source);
    const targetDocument = new Y.Doc();
    targetDocument.getXmlFragment("body").insert(0, [cloned]);

    expect(cloned instanceof Y.XmlElement).toBe(true);
    if (!(cloned instanceof Y.XmlElement)) return;
    expect(
      Object.prototype.hasOwnProperty.call(cloned.getAttributes(), "origin"),
    ).toBe(true);
    expect(cloned.getAttribute("origin") === undefined).toBe(true);
  });

  test("clones nested IDs and formatting, then replays source and target updates idempotently", () => {
    const source = createCardDocument({ documentId: "document-source" });
    const sourceGroup = getOnlyElement(source.body);
    sourceGroup.insert(0, [
      createBlock("block-root", "Formatted", [
        createBlock("block-child", "Nested"),
      ]),
    ]);

    const target = createCardDocument({ documentId: "document-target" });
    const targetGroup = getOnlyElement(target.body);

    const sourceReplica = openCardDocument(
      new Y.Doc({ guid: "document-source-replica" }),
    );
    const targetReplica = openCardDocument(
      new Y.Doc({ guid: "document-target-replica" }),
    );
    Y.applyUpdate(
      sourceReplica.document,
      Y.encodeStateAsUpdate(source.document),
    );
    Y.applyUpdate(
      targetReplica.document,
      Y.encodeStateAsUpdate(target.document),
    );

    const sourceVector = Y.encodeStateVector(source.document);
    const targetVector = Y.encodeStateVector(target.document);
    const portable = captureXmlSubtreeAt(sourceGroup, 0);

    target.document.transact(() => {
      insertPortableXmlSubtree(targetGroup, 0, portable);
    }, "relocation-target");
    source.document.transact(() => {
      deleteXmlSubtreeAt(sourceGroup, 0);
    }, "relocation-source");

    expect(assertValidBlockDocument(source.body).length).toBe(0);
    const targetBlocks = assertValidBlockDocument(target.body);
    expect(targetBlocks.length).toBe(2);
    expect(targetBlocks[0]?.id).toBe("block-root");
    expect(targetBlocks[1]?.id).toBe("block-child");

    const movedBlock = getOnlyElement(targetGroup);
    expect(JSON.stringify(getFirstText(movedBlock).toDelta())).toBe(
      JSON.stringify([
        { insert: "Formatted", attributes: { bold: {} } },
        { insert: " plain" },
      ]),
    );

    const sourceUpdate = Y.encodeStateAsUpdate(source.document, sourceVector);
    const targetUpdate = Y.encodeStateAsUpdate(target.document, targetVector);
    Y.applyUpdate(sourceReplica.document, sourceUpdate);
    Y.applyUpdate(targetReplica.document, targetUpdate);
    const sourceStateAfterFirstApply = Array.from(
      Y.encodeStateVector(sourceReplica.document),
    ).join(",");
    const targetStateAfterFirstApply = Array.from(
      Y.encodeStateVector(targetReplica.document),
    ).join(",");

    Y.applyUpdate(sourceReplica.document, sourceUpdate);
    Y.applyUpdate(targetReplica.document, targetUpdate);

    expect(
      Array.from(Y.encodeStateVector(sourceReplica.document)).join(","),
    ).toBe(sourceStateAfterFirstApply);
    expect(
      Array.from(Y.encodeStateVector(targetReplica.document)).join(","),
    ).toBe(targetStateAfterFirstApply);
    expect(assertValidBlockDocument(sourceReplica.body).length).toBe(0);
    expect(assertValidBlockDocument(targetReplica.body).length).toBe(2);
    expect(targetReplica.body.toString()).toBe(target.body.toString());
  });

  test("rejects Y.Xml node types that cannot be moved safely", () => {
    let error: unknown;
    try {
      encodeXmlSubtree(new Y.XmlHook("unsupported"));
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof UnsupportedXmlNodeError).toBe(true);
  });
});
