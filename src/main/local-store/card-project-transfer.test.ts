import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION } from "../../shared/block-documents";
import type { BlockTreeNode } from "../../shared/block-documents/block-document-codec";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import { createUuidV7 } from "../../shared/card-id";
import { createExplicitDocumentBearingBlock } from "./additional-document-bearing-blocks";
import { cutoverCardDocumentToPrimary, getOwnedBlockDocumentDescriptor } from "./block-document-cutover";
import { applyCardLifecycleMutation } from "./card-block-lifecycle";
import {
  applyCardProjectTransfer,
  CardProjectTransferCompilationError,
  compileCardProjectTransferRequest,
  type CardProjectTransferFaultPoint,
} from "./card-project-transfer";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { runLegacyCardShadowProcessorProbe } from "./legacy-card-shadow-processor";
import { createProject } from "./projects";

interface Fixture {
  readonly database: Database.Database;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly storeEpoch: string;
  readonly targetDatabaseBlockId: string;
  readonly targetViewId: string;
}

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("better-sqlite3") && message.includes("not yet supported")) {
      return false;
    }
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

const withFixture = async (
  run: (fixture: Fixture) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-project-transfer-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const source = createProject({ name: "Transfer source" });
    const target = createProject({ name: "Transfer target" });
    const database = getDb();
    const metadata = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const targetDatabase = database
      .prepare(
        `SELECT block_id
         FROM database_capabilities
         WHERE project_id = ? AND is_primary = 1`,
      )
      .get(target.id) as { readonly block_id: string };
    const targetView = database
      .prepare(
        `SELECT id
         FROM database_views
         WHERE project_id = ? AND database_block_id = ?
           AND is_primary = 1 AND lifecycle = 'active'`,
      )
      .get(target.id, targetDatabase.block_id) as { readonly id: string };
    await run({
      database,
      sourceProjectId: source.id,
      targetProjectId: target.id,
      storeEpoch: metadata.store_epoch,
      targetDatabaseBlockId: targetDatabase.block_id,
      targetViewId: targetView.id,
    });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
  }
};

const paragraph = (id: string, text: string): BlockTreeNode => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const createAuthorityCard = (
  fixture: Fixture,
  cardId: string,
  operationId: string,
): { readonly documentId: string; readonly headSeq: number } => {
  const result = applyCardLifecycleMutation(
    fixture.database,
    parseCardLifecycleMutationRequest({
      version: 1,
      operationId,
      projectId: fixture.sourceProjectId,
      storeEpoch: fixture.storeEpoch,
      clientSessionId: "transfer-test",
      actor: { kind: "test" },
      operation: {
        kind: "create_card",
        cardId,
        title: "Transfer root",
        nfm: "Root body",
        status: "draft",
      },
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return {
    documentId: result.value.documentId ?? `document:${cardId}`,
    headSeq: result.value.documentHeadSeq ?? 1,
  };
};

const compile = (
  fixture: Fixture,
  cardId: string,
  operationId: string,
) =>
  compileCardProjectTransferRequest(fixture.database, {
    operationId,
    sourceProjectId: fixture.sourceProjectId,
    targetProjectId: fixture.targetProjectId,
    cardId,
    targetDatabaseBlockId: fixture.targetDatabaseBlockId,
    targetViewId: fixture.targetViewId,
    targetStatus: "in_progress",
    clientSessionId: "transfer-test",
    actor: { kind: "test" },
  });

const readBlockProject = (fixture: Fixture, blockId: string): string =>
  (
    fixture.database
      .prepare("SELECT project_id FROM blocks WHERE id = ?")
      .get(blockId) as { readonly project_id: string }
  ).project_id;

describe("Card Project transfer authority kernel", () => {
  sqliteTest(
    "migrates v68 by retiring legacy cross-Project triggers and installing the typed fence",
    async () => {
      await withFixture(async (fixture) => {
        fixture.database.exec(`
          DROP TRIGGER IF EXISTS cards_project_transfer_requires_write_fence;
          DROP TABLE IF EXISTS card_project_transfer_write_fences;
          CREATE TRIGGER cards_block_foundation_cross_project_requires_pending
            BEFORE UPDATE OF project_id ON cards BEGIN SELECT 1; END;
          CREATE TRIGGER cards_block_foundation_after_cross_project_update
            AFTER UPDATE OF project_id ON cards BEGIN SELECT 1; END;
          PRAGMA user_version = 68;
        `);
        closeDatabase();
        await initializeDatabase();
        const migrated = getDb();
        expect(
          (
            migrated.prepare("PRAGMA user_version").get() as {
              readonly user_version: number;
            }
          ).user_version,
        ).toBe(69);
        expect(
          (
            migrated
              .prepare(
                `SELECT COUNT(*) AS count
                 FROM sqlite_schema
                 WHERE type = 'trigger'
                   AND name IN (
                     'cards_block_foundation_cross_project_requires_pending',
                     'cards_block_foundation_after_cross_project_update'
                   )`,
              )
              .get() as { readonly count: number }
          ).count,
        ).toBe(0);
        expect(
          migrated
            .prepare(
              `SELECT 1 FROM sqlite_schema
               WHERE type = 'trigger'
                 AND name = 'cards_project_transfer_requires_write_fence'`,
            )
            .get() !== undefined,
        ).toBe(true);
        expect(
          (migrated.pragma("foreign_key_check") as readonly unknown[]).length,
        ).toBe(0);
      });
    },
  );

  sqliteTest(
    "moves a recursively owned Document closure atomically and replays a lost response",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const root = createAuthorityCard(fixture, cardId, "create-transfer-root");
        const large = createExplicitDocumentBearingBlock(fixture.database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_explicit_document_bearing_block",
          operationId: "create-transfer-large-document",
          projectId: fixture.sourceProjectId,
          storeEpoch: fixture.storeEpoch,
          clientSessionId: "transfer-test",
          actor: { kind: "test" },
          blockKind: "large_document",
          blockId: "large:transfer-shell",
          documentId: "document:large-transfer-shell",
          displayName: "Independent source",
          blockTree: [paragraph("large:transfer-paragraph", "Nested body")],
          location: {
            kind: "document",
            hostDocumentId: root.documentId,
            expectedHostGeneration: 1,
            expectedHostHeadSeq: root.headSeq,
          },
        });
        expect(large.documentHeads[root.documentId]?.headSeq).toBe(2);

        const request = compile(fixture, cardId, "transfer-recursive");
        expect(request.expectedDocuments.length).toBe(2);
        expect(
          request.expectedBlocks.some(
            (block) => block.blockId === "large:transfer-paragraph",
          ),
        ).toBe(true);
        const updateHashesBefore = fixture.database
          .prepare(
            `SELECT document_id, generation, seq, update_hash
             FROM document_updates
             WHERE document_id IN (?, ?)
             ORDER BY document_id, generation, seq`,
          )
          .all(root.documentId, "document:large-transfer-shell");

        const precommitPoints: readonly CardProjectTransferFaultPoint[] = [
          "after_source_memberships",
          "after_project_coordinates",
          "after_target_memberships",
          "after_compatibility_rows",
          "after_projections",
          "after_change_log",
          "after_ledger",
          "before_commit",
        ];
        for (const point of precommitPoints) {
          let threw = false;
          try {
            applyCardProjectTransfer(fixture.database, request, {
              faultInjector(candidate) {
                if (candidate === point) throw new Error(`fault:${point}`);
              },
            });
          } catch {
            threw = true;
          }
          expect(threw).toBe(true);
          expect(readBlockProject(fixture, cardId)).toBe(
            fixture.sourceProjectId,
          );
          expect(
            fixture.database
              .prepare("SELECT 1 FROM block_mutations WHERE mutation_id = ?")
              .get(request.operationId) === undefined,
          ).toBe(true);
          expect(
            (
              fixture.database.pragma("foreign_key_check") as readonly unknown[]
            ).length,
          ).toBe(0);
        }

        let responseLost = false;
        try {
          applyCardProjectTransfer(fixture.database, request, {
            faultInjector(point) {
              if (point === "after_commit") {
                throw new Error("response lost after commit");
              }
            },
          });
        } catch {
          responseLost = true;
        }
        expect(responseLost).toBe(true);
        const retry = applyCardProjectTransfer(fixture.database, {
          ...request,
          clientSessionId: "retry-session",
          actor: { kind: "retry" },
        });
        expect(retry.ok).toBe(true);
        if (!retry.ok) throw new Error(retry.error.message);
        expect(retry.value.duplicate).toBe(true);
        expect(retry.value.movedDocumentIds.length).toBe(2);
        for (const block of request.expectedBlocks) {
          expect(readBlockProject(fixture, block.blockId)).toBe(
            fixture.targetProjectId,
          );
        }
        for (const document of request.expectedDocuments) {
          const moved = fixture.database
            .prepare(
              "SELECT project_id, generation, head_seq FROM documents WHERE id = ?",
            )
            .get(document.documentId) as {
            readonly project_id: string;
            readonly generation: number;
            readonly head_seq: number;
          };
          expect(moved.project_id).toBe(fixture.targetProjectId);
          expect(moved.generation).toBe(document.generation);
          expect(moved.head_seq).toBe(document.headSeq);
        }
        expect(
          JSON.stringify(
            fixture.database
              .prepare(
                `SELECT document_id, generation, seq, update_hash
                 FROM document_updates
                 WHERE document_id IN (?, ?)
                 ORDER BY document_id, generation, seq`,
              )
              .all(root.documentId, "document:large-transfer-shell"),
          ),
        ).toBe(JSON.stringify(updateHashesBefore));
        expect(
          (
            fixture.database
              .prepare(
                `SELECT COUNT(*) AS count FROM change_log
                 WHERE operation_id = ? AND kind = 'card_project_transfer'`,
              )
              .get(request.operationId) as { readonly count: number }
          ).count,
        ).toBe(1);
        expect(
          (
            fixture.database
              .prepare(
                "SELECT COUNT(*) AS count FROM card_project_transfer_write_fences",
              )
              .get() as { readonly count: number }
          ).count,
        ).toBe(0);
        expect(
          (
            fixture.database.pragma("foreign_key_check") as readonly unknown[]
          ).length,
        ).toBe(0);
      });
    },
  );

  sqliteTest(
    "moves a compatibility row only through the typed fence and never enqueues shadow content",
    async () => {
      await withFixture(async (fixture) => {
        const legacy = await createCard(fixture.sourceProjectId, "draft", {
          title: "Compatibility projection",
          description: "Already collaborative",
        });
        runLegacyCardShadowProcessorProbe(fixture.database);
        const shadow = getOwnedBlockDocumentDescriptor(
          fixture.database,
          fixture.sourceProjectId,
          legacy.id,
        );
        cutoverCardDocumentToPrimary(fixture.database, {
          projectId: fixture.sourceProjectId,
          ownerBlockId: legacy.id,
          expectedGeneration: shadow.generation,
          expectedHeadSeq: shadow.headSeq,
        });
        const jobsBefore = (
          fixture.database
            .prepare(
              "SELECT COUNT(*) AS count FROM legacy_card_shadow_jobs WHERE card_id = ?",
            )
            .get(legacy.id) as { readonly count: number }
        ).count;
        let directUpdateRejected = false;
        try {
          fixture.database
            .prepare("UPDATE cards SET project_id = ? WHERE id = ?")
            .run(fixture.targetProjectId, legacy.id);
        } catch {
          directUpdateRejected = true;
        }
        expect(directUpdateRejected).toBe(true);

        const request = compile(fixture, legacy.id, "transfer-compatibility");
        let compatibilityFaultRolledBack = false;
        try {
          applyCardProjectTransfer(fixture.database, request, {
            faultInjector(point) {
              if (point === "after_compatibility_rows") {
                throw new Error("compatibility projection fault");
              }
            },
          });
        } catch {
          compatibilityFaultRolledBack = true;
        }
        expect(compatibilityFaultRolledBack).toBe(true);
        expect(
          (
            fixture.database
              .prepare("SELECT project_id FROM cards WHERE id = ?")
              .get(legacy.id) as { readonly project_id: string }
          ).project_id,
        ).toBe(fixture.sourceProjectId);
        expect(
          (
            fixture.database
              .prepare(
                "SELECT COUNT(*) AS count FROM card_project_transfer_write_fences",
              )
              .get() as { readonly count: number }
          ).count,
        ).toBe(0);
        const result = applyCardProjectTransfer(fixture.database, request);
        expect(result.ok).toBe(true);
        const row = fixture.database
          .prepare("SELECT project_id, status FROM cards WHERE id = ?")
          .get(legacy.id) as {
          readonly project_id: string;
          readonly status: string;
        };
        expect(row.project_id).toBe(fixture.targetProjectId);
        expect(row.status).toBe("in_progress");
        expect(
          (
            fixture.database
              .prepare(
                "SELECT COUNT(*) AS count FROM legacy_card_shadow_jobs WHERE card_id = ?",
              )
              .get(legacy.id) as { readonly count: number }
          ).count,
        ).toBe(jobsBefore);
      });
    },
  );

  sqliteTest(
    "fails compilation when the target property schema cannot represent source values",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        createAuthorityCard(fixture, cardId, "create-incompatible-root");
        fixture.database
          .prepare(
            `UPDATE database_properties
             SET config_json = '{"options":[{"id":"draft","name":"Draft"}]}'
             WHERE database_block_id = ? AND project_id = ? AND key = 'status'`,
          )
          .run(fixture.targetDatabaseBlockId, fixture.targetProjectId);
        let error: unknown;
        try {
          compile(fixture, cardId, "transfer-incompatible");
        } catch (caught) {
          error = caught;
        }
        expect(error instanceof CardProjectTransferCompilationError).toBe(true);
        expect((error as CardProjectTransferCompilationError).code).toBe(
          "target_property_value_invalid",
        );
        expect(readBlockProject(fixture, cardId)).toBe(
          fixture.sourceProjectId,
        );
      });
    },
  );

  sqliteTest(
    "records a stale authority rejection once and replays it across audit sessions",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        createAuthorityCard(fixture, cardId, "create-stale-root");
        const request = compile(fixture, cardId, "transfer-stale");
        fixture.database
          .prepare(
            `UPDATE blocks
             SET metadata_revision = metadata_revision + 1
             WHERE id = ? AND project_id = ?`,
          )
          .run(cardId, fixture.sourceProjectId);
        const first = applyCardProjectTransfer(fixture.database, request);
        expect(first.ok).toBe(false);
        if (first.ok) throw new Error("Expected stale rejection");
        expect(first.error.code).toBe("block_authority_conflict");
        const retry = applyCardProjectTransfer(fixture.database, {
          ...request,
          clientSessionId: "another-session",
          actor: { kind: "another-transport" },
        });
        expect(retry.ok).toBe(false);
        if (retry.ok) throw new Error("Expected replayed stale rejection");
        expect(retry.error.code).toBe("block_authority_conflict");
        expect(
          (
            fixture.database
              .prepare(
                "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
              )
              .get(request.operationId) as { readonly count: number }
          ).count,
        ).toBe(1);
      });
    },
  );
});
