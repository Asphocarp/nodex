import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createUuidV7 } from "../../shared/card-id";
import {
  ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  LARGE_CODE_BLOCK_TYPE,
  LARGE_DOCUMENT_BLOCK_TYPE,
  REUSABLE_TEMPLATE_REFERENCE_TYPE,
} from "../../shared/block-documents";
import {
  createDetachedCardDocumentFromBlockTree,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../../shared/block-documents/document-history";
import { inspectOwnedBlockDocument } from "../../shared/block-documents/document-schema-adapters";
import {
  AdditionalDocumentBearingBlockError,
  createExplicitDocumentBearingBlock,
  createReusableTemplateReference,
  createReusableTemplateSource,
  getDocumentBearingBlockSummary,
  instantiateReusableTemplate,
} from "./additional-document-bearing-blocks";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  initializeBlockDocumentGenesis,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { createDocumentVersionCheckpoint } from "./document-versions";

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("better-sqlite3") &&
      message.includes("not yet supported")
    ) {
      return false;
    }
    throw error;
  }
})();
const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

const paragraph = (
  id: string,
  text: string,
  children: readonly BlockTreeNode[] = [],
): BlockTreeNode => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children,
});

const seedPrimaryCardDocument = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly cardId: string;
    readonly documentId: string;
    readonly blockTree?: readonly BlockTreeNode[];
  },
): { readonly storeEpoch: string; readonly headSeq: number } => {
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
    `,
    )
    .run(input.cardId, input.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO top_level_block_placements (
        block_id, project_id, rank_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(input.cardId, input.projectId, `100000000000:${input.cardId}`, now, now);
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.card', 2, X'', '',
        'pending_genesis', 'legacy_shadow', NULL, ?, ?)
    `,
    )
    .run(input.documentId, input.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(input.cardId, input.documentId, input.projectId, now);
  const detached = createDetachedCardDocumentFromBlockTree({
    documentId: input.documentId,
    title: "Host",
    blockTree: input.blockTree ?? [paragraph(createUuidV7(), "anchor")],
  });
  try {
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const ack = initializeBlockDocumentGenesis(database, {
      documentId: input.documentId,
      storeEpoch,
      generation: 1,
      updateId: `genesis:${input.documentId}`,
      clientSessionId: "test:genesis",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
    return { storeEpoch, headSeq: ack.headSeq };
  } finally {
    detached.document.destroy();
  }
};

const readMaterialization = (
  database: Database.Database,
  documentId: string,
) => {
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    return inspectOwnedBlockDocument(loaded.document, {
      ownerType: loaded.ownerType,
      schemaKey: loaded.head.schemaKey,
      schemaVersion: loaded.head.schemaVersion,
    }).materialization;
  } finally {
    loaded.document.destroy();
  }
};

const withDatabase = async (
  operation: (
    database: Database.Database,
    projectId: string,
    storeEpoch: string,
  ) => void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-extra-docs-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    closeDatabase();
    const database = new Database(getDatabasePath(), { readonly: false });
    database.pragma("foreign_keys = ON");
    try {
      const project = database
        .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
        .get() as { readonly id: string };
      const storeEpoch = (
        database
          .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
          .get() as { readonly store_epoch: string }
      ).store_epoch;
      operation(database, project.id, storeEpoch);
    } finally {
      database.close();
    }
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const ACTOR = { test: "additional-document-bearing" } as const;

describe("additional registered document-bearing Blocks", () => {
  sqliteTest(
    "keeps a Template source independent while references stay childless and instances renew IDs",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const hostCardId = createUuidV7();
        const sourceBlockId = createUuidV7();
        const templateRootId = createUuidV7();
        const templateChildId = createUuidV7();
        const referenceBlockId = createUuidV7();
        seedPrimaryCardDocument(database, {
          projectId,
          cardId: hostCardId,
          documentId: "document:template-host",
        });
        const source = createReusableTemplateSource(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_reusable_template_source",
          operationId: "template:create",
          projectId,
          storeEpoch,
          clientSessionId: "surface:template-create",
          actor: ACTOR,
          sourceBlockId,
          documentId: "document:template-source",
          displayName: "Decision review",
          blockTree: [
            paragraph(templateRootId, "Review", [
              paragraph(templateChildId, "Decision"),
            ]),
          ],
        });
        expect(source.duplicate).toBe(false);
        const summary = getDocumentBearingBlockSummary(
          database,
          projectId,
          sourceBlockId,
        );
        expect(summary.displayName).toBe("Decision review");
        expect(summary.preview).toBe("Review Decision");
        const retry = createReusableTemplateSource(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_reusable_template_source",
          operationId: "template:create",
          projectId,
          storeEpoch,
          clientSessionId: "surface:lost-response",
          actor: { retry: true },
          sourceBlockId,
          documentId: "document:template-source",
          displayName: "Decision review",
          blockTree: [
            paragraph(templateRootId, "Review", [
              paragraph(templateChildId, "Decision"),
            ]),
          ],
        });
        expect(retry.duplicate).toBe(true);

        createReusableTemplateReference(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_reusable_template_reference",
          operationId: "template:reference",
          projectId,
          storeEpoch,
          clientSessionId: "surface:reference",
          actor: ACTOR,
          sourceBlockId,
          sourceDocumentId: "document:template-source",
          expectedSourceGeneration: 1,
          expectedSourceHeadSeq: 1,
          hostDocumentId: "document:template-host",
          expectedHostGeneration: 1,
          expectedHostHeadSeq: 1,
          referenceBlockId,
        });
        const afterReference = readMaterialization(
          database,
          "document:template-host",
        );
        expect(afterReference.blockTree[1]?.type).toBe(
          REUSABLE_TEMPLATE_REFERENCE_TYPE,
        );
        expect(afterReference.blockTree[1]?.children.length).toBe(0);
        expect(afterReference.blockTree[1]?.props.displayHint).toBe(
          "Decision review",
        );

        const instantiated = instantiateReusableTemplate(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "instantiate_reusable_template",
          operationId: "template:instantiate",
          projectId,
          storeEpoch,
          clientSessionId: "surface:instantiate",
          actor: ACTOR,
          sourceBlockId,
          sourceDocumentId: "document:template-source",
          expectedSourceGeneration: 1,
          expectedSourceHeadSeq: 1,
          targetDocumentId: "document:template-host",
          expectedTargetGeneration: 1,
          expectedTargetHeadSeq: 2,
        });
        expect(instantiated.duplicate).toBe(false);
        const host = readMaterialization(database, "document:template-host");
        const instance = host.blockTree[2];
        expect(instance?.type).toBe("paragraph");
        expect(instance?.id === templateRootId).toBe(false);
        expect(instance?.children[0]?.id === templateChildId).toBe(false);
        const sourceAfter = readMaterialization(
          database,
          "document:template-source",
        );
        expect(sourceAfter.blockTree[0]?.id).toBe(templateRootId);

        const checkpoint = createDocumentVersionCheckpoint(database, {
          version: DOCUMENT_VERSION_CONTRACT_VERSION,
          projectId,
          storeEpoch,
          documentId: "document:template-source",
          expectedGeneration: 1,
          expectedHeadSeq: 1,
          cause: "manual",
          actor: {},
        }).checkpoint;
        expect(checkpoint.materializationKind).toBe("reusable_template");
        expect(checkpoint.title).toBe(null);
      });
    },
  );

  sqliteTest(
    "creates visible Large Document/Code shells without embedding their bodies",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const hostCardId = createUuidV7();
        const largeDocumentBlockId = createUuidV7();
        const largeParagraphId = createUuidV7();
        const largeCodeBlockId = createUuidV7();
        seedPrimaryCardDocument(database, {
          projectId,
          cardId: hostCardId,
          documentId: "document:large-host",
        });
        const largeDocument = createExplicitDocumentBearingBlock(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_explicit_document_bearing_block",
          operationId: "large:create-document",
          projectId,
          storeEpoch,
          clientSessionId: "surface:large-document",
          actor: ACTOR,
          blockKind: "large_document",
          blockId: largeDocumentBlockId,
          documentId: "document:large-document",
          displayName: "Architecture",
          blockTree: [paragraph(largeParagraphId, "Independent body")],
          location: {
            kind: "document",
            hostDocumentId: "document:large-host",
            expectedHostGeneration: 1,
            expectedHostHeadSeq: 1,
          },
        });
        expect(largeDocument.duplicate).toBe(false);
        const host = readMaterialization(database, "document:large-host");
        expect(host.blockTree[1]?.id).toBe(largeDocumentBlockId);
        expect(host.blockTree[1]?.type).toBe(LARGE_DOCUMENT_BLOCK_TYPE);
        expect(host.blockTree[1]?.children.length).toBe(0);
        expect(host.plainText.includes("Independent body")).toBe(false);
        const shellRegistry = database
          .prepare(
            `
            SELECT owner.type AS owner_type, entry.block_type AS shell_type,
              owner.containing_document_id, ownership.document_id
            FROM blocks owner
            INNER JOIN document_block_index entry ON entry.block_id = owner.id
            INNER JOIN block_documents ownership ON ownership.block_id = owner.id
            WHERE owner.id = ?
          `,
          )
          .get(largeDocumentBlockId) as {
          readonly owner_type: string;
          readonly shell_type: string;
          readonly containing_document_id: string;
          readonly document_id: string;
        };
        expect(shellRegistry.owner_type).toBe(LARGE_DOCUMENT_BLOCK_TYPE);
        expect(shellRegistry.shell_type).toBe(LARGE_DOCUMENT_BLOCK_TYPE);
        expect(shellRegistry.containing_document_id).toBe(
          "document:large-host",
        );
        expect(shellRegistry.document_id).toBe("document:large-document");
        expect(
          readMaterialization(database, "document:large-document").plainText,
        ).toBe("Independent body");

        createExplicitDocumentBearingBlock(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_explicit_document_bearing_block",
          operationId: "large:create-code",
          projectId,
          storeEpoch,
          clientSessionId: "surface:large-code",
          actor: ACTOR,
          blockKind: "large_code",
          blockId: largeCodeBlockId,
          documentId: "document:large-code",
          displayName: "Sync adapter",
          code: "export const sync = true;",
          language: "typescript",
          location: { kind: "space" },
        });
        const code = readMaterialization(database, "document:large-code");
        expect(code.kind).toBe("large_code");
        expect(code.blockTree.length).toBe(1);
        expect(code.blockTree[0]?.type).toBe("codeBlock");
        const owner = database
          .prepare(
            `SELECT type, location_kind FROM blocks WHERE id = ?`,
          )
          .get(largeCodeBlockId) as { readonly type: string; readonly location_kind: string };
        expect(owner.type).toBe(LARGE_CODE_BLOCK_TYPE);
        expect(owner.location_kind).toBe("space");
      });
    },
  );

  sqliteTest(
    "rejects ordinary manufacture and schema drift for typed owners",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const hostCardId = createUuidV7();
        const forgedBlockId = createUuidV7();
        const strictCodeBlockId = createUuidV7();
        seedPrimaryCardDocument(database, {
          projectId,
          cardId: hostCardId,
          documentId: "document:typed-host",
        });
        const manufactured = applyDocumentOperationBatch(database, {
          version: DOCUMENT_OPERATION_CONTRACT_VERSION,
          mutationId: "manufacture:large",
          projectId,
          storeEpoch,
          actor: {},
          documentId: "document:typed-host",
          generation: 1,
          expectedHeadSeq: 1,
          operations: [
            {
              kind: "insert_block",
              block: {
                id: forgedBlockId,
                type: LARGE_DOCUMENT_BLOCK_TYPE,
                props: { displayName: "Forged" },
                children: [],
              },
            },
          ],
        });
        expect(manufactured.ok).toBe(false);
        expect(
          database
            .prepare("SELECT 1 AS present FROM blocks WHERE id = ?")
            .get(forgedBlockId) === undefined,
        ).toBe(true);

        createExplicitDocumentBearingBlock(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_explicit_document_bearing_block",
          operationId: "large:strict-code",
          projectId,
          storeEpoch,
          clientSessionId: "surface:strict-code",
          actor: ACTOR,
          blockKind: "large_code",
          blockId: strictCodeBlockId,
          documentId: "document:strict-code",
          displayName: "Strict",
          code: "before",
          language: "text",
          location: { kind: "space" },
        });
        const loaded = loadPrimaryBlockDocument(database, "document:strict-code");
        const vector = Y.encodeStateVector(loaded.document);
        const content = [...loaded.document.getXmlFragment("body").createTreeWalker(
          (node) => node instanceof Y.XmlElement && node.nodeName === "codeBlock",
        )][0] as Y.XmlElement;
        const parent = content.parent as Y.XmlElement;
        const replacement = new Y.XmlElement("paragraph");
        const text = new Y.XmlText();
        text.insert(0, "not code");
        replacement.insert(0, [text]);
        const index = parent.toArray().indexOf(content);
        parent.delete(index, 1);
        parent.insert(index, [replacement]);
        let error: unknown;
        try {
          applyBlockDocumentUpdate(database, {
            documentId: "document:strict-code",
            storeEpoch,
            generation: 1,
            updateId: "large:strict-code:drift",
            clientSessionId: "surface:drift",
            baseHeadSeq: 1,
            touchedBlockIds: ["block:ignored"],
            update: Y.encodeStateAsUpdate(loaded.document, vector),
          });
        } catch (caught) {
          error = caught;
        } finally {
          loaded.document.destroy();
        }
        expect(error instanceof BlockDocumentStoreError).toBe(true);
        expect(
          readMaterialization(database, "document:strict-code").blockTree[0]
            ?.type,
        ).toBe("codeBlock");
      });
    },
  );

  sqliteTest("rolls owner, Document, and host shell back at every fault", async () => {
    await withDatabase((database, projectId, storeEpoch) => {
      const hostCardId = createUuidV7();
      const faultBlockId = createUuidV7();
      const faultBodyId = createUuidV7();
      seedPrimaryCardDocument(database, {
        projectId,
        cardId: hostCardId,
        documentId: "document:fault-host",
      });
      let error: unknown;
      try {
        createExplicitDocumentBearingBlock(
          database,
          {
            version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
            kind: "create_explicit_document_bearing_block",
            operationId: "large:fault",
            projectId,
            storeEpoch,
            clientSessionId: "surface:fault",
            actor: ACTOR,
            blockKind: "large_document",
            blockId: faultBlockId,
            documentId: "document:large-fault",
            displayName: "Fault",
            blockTree: [paragraph(faultBodyId, "rollback")],
            location: {
              kind: "document",
              hostDocumentId: "document:fault-host",
              expectedHostGeneration: 1,
              expectedHostHeadSeq: 1,
            },
          },
          {
            faultInjector: (point) => {
              if (point === "after_host_update") throw new Error("fault");
            },
          },
        );
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error).toBe(true);
      expect(
        database
          .prepare("SELECT 1 AS present FROM blocks WHERE id = ?")
          .get(faultBlockId) === undefined,
      ).toBe(true);
      expect(
        database
          .prepare(
            "SELECT 1 AS present FROM documents WHERE id = 'document:large-fault'",
          )
          .get() === undefined,
      ).toBe(true);
      expect(
        readMaterialization(database, "document:fault-host").blockTree.length,
      ).toBe(1);
    });
  });

  sqliteTest("binds operation identity to semantic intent", async () => {
    await withDatabase((database, projectId, storeEpoch) => {
      const sourceBlockId = createUuidV7();
      const bodyBlockId = createUuidV7();
      createReusableTemplateSource(database, {
        version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
        kind: "create_reusable_template_source",
        operationId: "template:identity",
        projectId,
        storeEpoch,
        clientSessionId: "surface:first",
        actor: ACTOR,
        sourceBlockId,
        documentId: "document:template-identity",
        displayName: "Identity",
        blockTree: [paragraph(bodyBlockId, "one")],
      });
      let error: unknown;
      try {
        createReusableTemplateSource(database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_reusable_template_source",
          operationId: "template:identity",
          projectId,
          storeEpoch,
          clientSessionId: "surface:second",
          actor: { retry: true },
          sourceBlockId,
          documentId: "document:template-identity",
          displayName: "Identity",
          blockTree: [paragraph(bodyBlockId, "different")],
        });
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof AdditionalDocumentBearingBlockError).toBe(true);
    });
  });
});
