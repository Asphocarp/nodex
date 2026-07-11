import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  createDetachedCardDocumentFromBlockTree,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import { inspectOwnedBlockDocument } from "../../shared/block-documents/document-schema-adapters";
import {
  SYNCED_BLOCK_REFERENCE_TYPE,
  SYNCED_BLOCK_SOURCE_TYPE,
} from "../../shared/block-documents/synced-block-document";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../../shared/block-documents/document-history";
import {
  applyBlockDocumentUpdate,
  initializeBlockDocumentGenesis,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { createDocumentVersionCheckpoint } from "./document-versions";
import { restoreDocumentVersion } from "./block-document-operations";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import {
  copySyncedBlockSource,
  createSyncedBlockSource,
  demoteSyncedBlockSource,
  promoteBlockToSyncedSource,
  SyncedBlockGroupError,
} from "./synced-block-groups";

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

const writeFence = (
  leaseId: string,
  ...documents: readonly {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  }[]
) => ({ leaseId, documents });

const seedPrimaryCardDocument = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly cardId: string;
    readonly documentId: string;
    readonly blockTree: readonly BlockTreeNode[];
  },
): {
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
} => {
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
    .run(input.cardId, input.projectId, "100000000000:host", now, now);
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', '',
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
    blockTree: input.blockTree,
  });
  try {
    const store = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const ack = initializeBlockDocumentGenesis(database, {
      documentId: input.documentId,
      storeEpoch: store.store_epoch,
      generation: 1,
      updateId: `genesis:${input.documentId}`,
      clientSessionId: "test:genesis",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
    return {
      storeEpoch: ack.storeEpoch,
      generation: ack.generation,
      headSeq: ack.headSeq,
    };
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

const findFirstText = (document: Y.Doc): Y.XmlText => {
  for (const node of document
    .getXmlFragment("body")
    .createTreeWalker(() => true)) {
    if (node instanceof Y.XmlText) return node;
  }
  throw new Error("Expected one text node");
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
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-synced-block-"),
  );
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
      const store = database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string };
      operation(database, project.id, store.store_epoch);
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

const ACTOR = { test: "synced-block" } as const;

describe("Synced Block document-bearing ownership", () => {
  sqliteTest(
    "uses one body-only Y.Doc and converges independent clients across restart/history",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        const created = createSyncedBlockSource(database, {
          operationId: "synced:create:convergence",
          projectId,
          storeEpoch,
          sourceBlockId: "synced-source-convergence",
          documentId: "document:synced-source-convergence",
          clientSessionId: "surface:create",
          actor: ACTOR,
          blockTree: [paragraph("synced-paragraph", "base")],
        });
        expect(created.duplicate).toBeFalse();
        const retry = createSyncedBlockSource(database, {
          operationId: "synced:create:convergence",
          projectId,
          storeEpoch,
          sourceBlockId: "synced-source-convergence",
          documentId: "document:synced-source-convergence",
          clientSessionId: "surface:retry",
          actor: { test: "retry" },
          blockTree: [paragraph("synced-paragraph", "base")],
        });
        expect(retry.duplicate).toBeTrue();

        const loaded = loadPrimaryBlockDocument(database, created.documentId);
        const base = Y.encodeStateAsUpdate(loaded.document);
        loaded.document.destroy();
        const left = new Y.Doc({ guid: created.documentId });
        const right = new Y.Doc({ guid: created.documentId });
        Y.applyUpdate(left, base);
        Y.applyUpdate(right, base);
        expect(JSON.stringify([...left.share.keys()].sort())).toBe('["body"]');
        const leftVector = Y.encodeStateVector(left);
        const rightVector = Y.encodeStateVector(right);
        findFirstText(left).insert(0, "L");
        findFirstText(right).insert(findFirstText(right).length, "R");
        applyBlockDocumentUpdate(database, {
          documentId: created.documentId,
          storeEpoch: created.storeEpoch,
          generation: 1,
          updateId: "synced:update:left",
          clientSessionId: "surface:left",
          baseHeadSeq: 1,
          touchedBlockIds: ["synced-paragraph"],
          update: Y.encodeStateAsUpdate(left, leftVector),
        });
        applyBlockDocumentUpdate(database, {
          documentId: created.documentId,
          storeEpoch: created.storeEpoch,
          generation: 1,
          updateId: "synced:update:right",
          clientSessionId: "surface:right",
          baseHeadSeq: 1,
          touchedBlockIds: ["synced-paragraph"],
          update: Y.encodeStateAsUpdate(right, rightVector),
        });
        left.destroy();
        right.destroy();
        const current = readMaterialization(database, created.documentId);
        expect(current.kind).toBe("synced_block");
        expect(current.plainText).toBe("LbaseR");

        const checkpoint = createDocumentVersionCheckpoint(database, {
          version: DOCUMENT_VERSION_CONTRACT_VERSION,
          projectId,
          storeEpoch: created.storeEpoch,
          documentId: created.documentId,
          expectedGeneration: 1,
          expectedHeadSeq: 3,
          cause: "manual",
          actor: {},
        }).checkpoint;
        expect(checkpoint.materializationKind).toBe("synced_block");
        expect(checkpoint.title).toBe(null);

        const replica = loadPrimaryBlockDocument(database, created.documentId);
        const vector = Y.encodeStateVector(replica.document);
        findFirstText(replica.document).insert(0, "later-");
        applyBlockDocumentUpdate(database, {
          documentId: created.documentId,
          storeEpoch: created.storeEpoch,
          generation: 1,
          updateId: "synced:update:later",
          clientSessionId: "surface:later",
          baseHeadSeq: 3,
          touchedBlockIds: ["synced-paragraph"],
          update: Y.encodeStateAsUpdate(replica.document, vector),
        });
        replica.document.destroy();
        const restored = restoreDocumentVersion(
          database,
          {
            version: DOCUMENT_VERSION_CONTRACT_VERSION,
            mutationId: "synced:restore",
            projectId,
            storeEpoch: created.storeEpoch,
            documentId: created.documentId,
            versionId: checkpoint.versionId,
            generation: 1,
            expectedHeadSeq: 4,
            clientSessionId: "surface:restore",
            actor: {},
          },
          {
            writeFence: {
              leaseId: "synced:restore",
              documentId: created.documentId,
              generation: 1,
              headSeq: 4,
            },
          },
        );
        expect(restored.ok).toBeTrue();
        expect(
          readMaterialization(database, created.documentId).plainText,
        ).toBe("LbaseR");
      });
    },
  );

  sqliteTest(
    "promotion/demotion preserve moved IDs while copy renews IDs and keeps targets",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        seedPrimaryCardDocument(database, {
          projectId,
          cardId: "host-card",
          documentId: "document:host-card",
          blockTree: [
            paragraph("promoted-root", "root", [
              paragraph("promoted-child", "child"),
            ]),
          ],
        });
        const promoted = promoteBlockToSyncedSource(database, {
          operationId: "synced:promote",
          projectId,
          storeEpoch,
          hostDocumentId: "document:host-card",
          expectedGeneration: 1,
          expectedHeadSeq: 1,
          rootBlockId: "promoted-root",
          referenceBlockId: "synced-reference",
          sourceBlockId: "synced-source",
          sourceDocumentId: "document:synced-source",
          clientSessionId: "surface:promote",
          actor: ACTOR,
          writeFence: writeFence("lease:promote", {
            documentId: "document:host-card",
            generation: 1,
            headSeq: 1,
          }),
        });
        expect(promoted.duplicate).toBeFalse();
        const source = readMaterialization(database, "document:synced-source");
        expect(JSON.stringify(source.blockTree.map((block) => block.id))).toBe(
          '["promoted-root"]',
        );
        expect(source.blockTree[0]?.children[0]?.id).toBe("promoted-child");
        const host = readMaterialization(database, "document:host-card");
        expect(host.blockTree[0]?.id).toBe("synced-reference");
        expect(host.blockTree[0]?.type).toBe(SYNCED_BLOCK_REFERENCE_TYPE);
        const locations = database
          .prepare(
            `SELECT id, containing_document_id FROM blocks WHERE id IN (?, ?, ?) ORDER BY id`,
          )
          .all(
            "promoted-root",
            "promoted-child",
            "synced-reference",
          ) as readonly {
          readonly id: string;
          readonly containing_document_id: string;
        }[];
        expect(JSON.stringify(locations)).toBe(
          '[{"id":"promoted-child","containing_document_id":"document:synced-source"},{"id":"promoted-root","containing_document_id":"document:synced-source"},{"id":"synced-reference","containing_document_id":"document:host-card"}]',
        );
        const retry = promoteBlockToSyncedSource(database, {
          operationId: "synced:promote",
          projectId,
          storeEpoch,
          hostDocumentId: "document:host-card",
          expectedGeneration: 1,
          expectedHeadSeq: 1,
          rootBlockId: "promoted-root",
          referenceBlockId: "synced-reference",
          sourceBlockId: "synced-source",
          sourceDocumentId: "document:synced-source",
          clientSessionId: "surface:retry",
          actor: { test: "retry" },
          writeFence: writeFence("lease:promote-retry", {
            documentId: "document:host-card",
            generation: 1,
            headSeq: 1,
          }),
        });
        expect(retry.duplicate).toBeTrue();

        const copied = copySyncedBlockSource(database, {
          operationId: "synced:copy",
          projectId,
          storeEpoch,
          sourceBlockId: "synced-source",
          sourceDocumentId: "document:synced-source",
          expectedSourceGeneration: 1,
          expectedSourceHeadSeq: 1,
          newSourceBlockId: "synced-source-copy",
          newDocumentId: "document:synced-source-copy",
          clientSessionId: "surface:copy",
          actor: ACTOR,
        });
        const copy = readMaterialization(database, copied.documentId);
        expect(copy.blockTree[0]?.id === "promoted-root").toBeFalse();
        expect(
          copy.blockTree[0]?.children[0]?.id === "promoted-child",
        ).toBeFalse();

        const demoted = demoteSyncedBlockSource(database, {
          operationId: "synced:demote",
          projectId,
          storeEpoch,
          hostDocumentId: "document:host-card",
          expectedGeneration: 1,
          expectedHeadSeq: promoted.hostMutation.headSeq,
          expectedSourceGeneration: 1,
          expectedSourceHeadSeq: 1,
          referenceBlockId: "synced-reference",
          sourceBlockId: "synced-source",
          sourceDocumentId: "document:synced-source",
          clientSessionId: "surface:demote",
          actor: ACTOR,
          writeFence: writeFence(
            "lease:demote",
            {
              documentId: "document:host-card",
              generation: 1,
              headSeq: promoted.hostMutation.headSeq,
            },
            {
              documentId: "document:synced-source",
              generation: 1,
              headSeq: 1,
            },
          ),
        });
        expect(demoted.duplicate).toBeFalse();
        const inlined = readMaterialization(database, "document:host-card");
        expect(inlined.blockTree[0]?.id).toBe("promoted-root");
        expect(inlined.blockTree[0]?.children[0]?.id).toBe("promoted-child");
        const lifecycle = database
          .prepare("SELECT lifecycle FROM blocks WHERE id = ?")
          .get("synced-source") as { readonly lifecycle: string };
        expect(lifecycle.lifecycle).toBe("deleted");
        const reference = database
          .prepare("SELECT lifecycle FROM blocks WHERE id = ?")
          .get("synced-reference") as { readonly lifecycle: string };
        expect(reference.lifecycle).toBe("deleted");
      });
    },
  );

  sqliteTest(
    "faults roll back ownership and stale/shared reference evidence fails closed",
    async () => {
      await withDatabase((database, projectId, storeEpoch) => {
        seedPrimaryCardDocument(database, {
          projectId,
          cardId: "fault-host",
          documentId: "document:fault-host",
          blockTree: [paragraph("fault-root", "fault")],
        });
        let failed = false;
        try {
          promoteBlockToSyncedSource(database, {
            operationId: "synced:promote:fault",
            projectId,
            storeEpoch,
            hostDocumentId: "document:fault-host",
            expectedGeneration: 1,
            expectedHeadSeq: 1,
            rootBlockId: "fault-root",
            referenceBlockId: "fault-reference",
            sourceBlockId: "fault-source",
            sourceDocumentId: "document:fault-source",
            clientSessionId: "surface:fault",
            actor: ACTOR,
            writeFence: writeFence("lease:fault", {
              documentId: "document:fault-host",
              generation: 1,
              headSeq: 1,
            }),
            faultInjector: (point) => {
              if (point === "before_commit") throw new Error("fault");
            },
          });
        } catch {
          failed = true;
        }
        expect(failed).toBeTrue();
        const residual = database
          .prepare("SELECT COUNT(*) AS count FROM blocks WHERE id IN (?, ?)")
          .get("fault-source", "fault-reference") as { readonly count: number };
        expect(residual.count).toBe(0);
        expect(
          readMaterialization(database, "document:fault-host").blockTree[0]?.id,
        ).toBe("fault-root");

        const created = createSyncedBlockSource(database, {
          operationId: "synced:create:stale",
          projectId,
          storeEpoch,
          sourceBlockId: "stale-source",
          documentId: "document:stale-source",
          clientSessionId: "surface:create",
          actor: ACTOR,
          blockTree: [paragraph("stale-body", "body")],
        });
        database
          .prepare(
            "UPDATE document_materializations SET projected_seq = projected_seq - 1 WHERE document_id = ?",
          )
          .run(created.documentId);
        let staleError: unknown;
        try {
          demoteSyncedBlockSource(database, {
            operationId: "synced:demote:stale",
            projectId,
            storeEpoch,
            hostDocumentId: "document:fault-host",
            expectedGeneration: 1,
            expectedHeadSeq: 1,
            expectedSourceGeneration: 1,
            expectedSourceHeadSeq: 1,
            referenceBlockId: "missing-reference",
            sourceBlockId: "stale-source",
            sourceDocumentId: "document:stale-source",
            clientSessionId: "surface:demote",
            actor: ACTOR,
            writeFence: writeFence(
              "lease:stale",
              {
                documentId: "document:fault-host",
                generation: 1,
                headSeq: 1,
              },
              {
                documentId: "document:stale-source",
                generation: 1,
                headSeq: 1,
              },
            ),
          });
        } catch (error) {
          staleError = error;
        }
        expect(staleError instanceof SyncedBlockGroupError).toBeTrue();
        expect((staleError as SyncedBlockGroupError).code).toBe(
          "document_state_corrupt",
        );
      });
    },
  );

  sqliteTest("owner/schema pairs fail closed", async () => {
    await withDatabase((database, projectId, storeEpoch) => {
      const created = createSyncedBlockSource(database, {
        operationId: "synced:create:schema",
        projectId,
        storeEpoch,
        sourceBlockId: "schema-source",
        documentId: "document:schema-source",
        clientSessionId: "surface:create",
        actor: ACTOR,
        blockTree: [],
      });
      database
        .prepare("UPDATE documents SET schema_key = 'nodex.card' WHERE id = ?")
        .run(created.documentId);
      let error: unknown;
      try {
        loadPrimaryBlockDocument(database, created.documentId);
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error).toBeTrue();
      expect(String(error)).toBe(
        `BlockDocumentStoreError: Document ${created.documentId} uses unsupported owner/schema ${SYNCED_BLOCK_SOURCE_TYPE}/nodex.card@1`,
      );
    });
  });
});
