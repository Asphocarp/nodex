import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCardLifecycleMutationRequest,
  type CardLifecycleMutationRequest,
} from "../../shared/card-lifecycle";
import { ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION } from "../../shared/block-documents";
import type { BlockTreeNode } from "../../shared/block-documents/block-document-codec";
import { createUuidV7 } from "../../shared/card-id";
import { createExplicitDocumentBearingBlock } from "./additional-document-bearing-blocks";
import { readAuthoritativeCardById } from "./card-read-store";
import {
  applyCardLifecycleMutation,
  readCardLifecyclePreflightSnapshot,
  verifyCardDocumentContinuity,
  type ApplyCardLifecycleMutationOptions,
  type CardLifecycleMutationFaultPoint,
} from "./card-block-lifecycle";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import { rebuildCardReadModelProjection } from "./card-read-store";
import { refreshScheduledCardIndexProjection } from "./scheduled-card-store";
import { readBlockStoreEpoch } from "./block-store-metadata";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly storeEpoch: string;
}

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("better-sqlite3") && message.includes("not yet supported")
  );
};

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

const withFixture = async (
  run: (fixture: Fixture) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previousDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-lifecycle-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Card lifecycle" });
    const database = getDb();
    const storeEpoch = readBlockStoreEpoch(database);
    if (!storeEpoch) throw new Error("Fixture has no store epoch");
    await run({ database, projectId: project.id, storeEpoch });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousDir;
    }
  }
};

const request = (
  fixture: Fixture,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
): CardLifecycleMutationRequest =>
  parseCardLifecycleMutationRequest({
    version: 1,
    operationId,
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "card-lifecycle-test",
    actor: { kind: "test" },
    operation,
  });

const createOperation = (
  cardId: string,
  title = "Authority Card",
): Readonly<Record<string, unknown>> => ({
  kind: "create_card",
  cardId,
  title,
  nfm: "Body paragraph",
  status: "draft",
});

const committed = (
  fixture: Fixture,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
  options: ApplyCardLifecycleMutationOptions = {},
) => {
  const result = applyCardLifecycleMutation(
    fixture.database,
    request(fixture, operationId, operation),
    options,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const readBlock = (
  fixture: Fixture,
  cardId: string,
): {
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly metadata_revision: number;
  readonly location_revision: number;
} =>
  fixture.database
    .prepare(
      `
      SELECT lifecycle, metadata_revision, location_revision
      FROM blocks WHERE id = ? AND project_id = ?
    `,
    )
    .get(cardId, fixture.projectId) as {
    readonly lifecycle: "active" | "archived" | "deleted";
    readonly metadata_revision: number;
    readonly location_revision: number;
  };

const paragraph = (id: string, text: string): BlockTreeNode => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const readBlockLifecycles = (
  fixture: Fixture,
  blockIds: readonly string[],
): Readonly<Record<string, { readonly lifecycle: string; readonly revision: number }>> => {
  const read = fixture.database.prepare(
    `
    SELECT lifecycle, metadata_revision
    FROM blocks WHERE id = ? AND project_id = ?
  `,
  );
  return Object.fromEntries(
    blockIds.map((blockId) => {
      const row = read.get(blockId, fixture.projectId) as {
        readonly lifecycle: string;
        readonly metadata_revision: number;
      };
      return [
        blockId,
        { lifecycle: row.lifecycle, revision: row.metadata_revision },
      ];
    }),
  );
};

const detachMembership = (fixture: Fixture, cardId: string): void => {
  const now = "2026-07-11T12:00:00.000Z";
  fixture.database
    .transaction(() => {
      fixture.database
        .prepare(
          "DELETE FROM database_view_positions WHERE block_id = ? AND project_id = ?",
        )
        .run(cardId, fixture.projectId);
      fixture.database
        .prepare(
          `
        UPDATE database_memberships
        SET removed_at = ?, revision = revision + 1
        WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      `,
        )
        .run(now, cardId, fixture.projectId);
      fixture.database
        .prepare(
          `
        UPDATE blocks
        SET location_kind = 'space', containing_database_id = NULL,
            location_revision = location_revision + 1,
            metadata_revision = metadata_revision + 1, updated_at = ?
        WHERE id = ? AND project_id = ?
      `,
        )
        .run(now, cardId, fixture.projectId);
      fixture.database
        .prepare(
          `
          INSERT INTO top_level_block_placements (
            block_id, project_id, rank_key, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(cardId, fixture.projectId, `standalone:${cardId}`, now, now);
      refreshScheduledCardIndexProjection(
        fixture.database,
        fixture.projectId,
        [cardId],
        now,
      );
      rebuildCardReadModelProjection(fixture.database, fixture.projectId, [
        cardId,
      ]);
    })
    .immediate();
};

describe("authoritative Card lifecycle kernel", () => {
  sqliteTest(
    "creates a title-only Card with one registered editable paragraph",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const created = committed(fixture, "create-title-only", {
          ...createOperation(cardId, "Title only"),
          nfm: "",
        });
        expect(created.membershipId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const materialization = fixture.database
          .prepare(
            `
            SELECT nfm, block_tree_json
            FROM document_materializations
            WHERE document_id = ?
          `,
          )
          .get(created.documentId) as {
          readonly nfm: string;
          readonly block_tree_json: string;
        };
        const blockTree = JSON.parse(materialization.block_tree_json) as readonly {
          readonly id: string;
          readonly type: string;
        }[];

        expect(materialization.nfm).toBe("");
        expect(blockTree).toMatchObject([{ type: "paragraph" }]);
        expect(
          fixture.database
            .prepare(
              `
              SELECT type, lifecycle, containing_document_id
              FROM blocks WHERE id = ?
            `,
            )
            .get(blockTree[0]?.id),
        ).toMatchObject({
          type: "paragraph",
          lifecycle: "active",
          containing_document_id: created.documentId,
        });
      });
    },
  );

  sqliteTest(
    "rejects legacy foreign-body projections before primary genesis",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const result = applyCardLifecycleMutation(
          fixture.database,
          request(fixture, "reject-foreign-body", {
            ...createOperation(cardId),
            nfm: [
              '<card-toggle card="legacy-target" meta="[P1]">',
              "\tProjected title",
              "\tProjected body",
              "</card-toggle>",
            ].join("\n"),
          }),
        );
        expect(result.ok).toBe(false);
        expect(
          result.ok
            ? ""
            : result.error.message.includes("legacy foreign-body projections"),
        ).toBe(true);
        expect(
          fixture.database.prepare("SELECT 1 FROM blocks WHERE id = ?").get(cardId) ===
            undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "creates, archives, deletes, and restores one Database Card without a cards row",
    async () => {
      await withFixture((fixture) => {
        const firstId = createUuidV7();
        const first = committed(
          fixture,
          "create-first",
          createOperation(firstId, "First"),
        );

        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
            )
            .get() === undefined,
        ).toBe(true);
        const card = readAuthoritativeCardById(
          fixture.database,
          fixture.projectId,
          firstId,
        );
        expect(card?.title).toBe("First");
        expect(card?.description).toBe("Body paragraph");
        expect(card?.status).toBe("draft");
        expect(first.documentHeadSeq).toBe(1);

        const archived = committed(fixture, "archive-first", {
          kind: "archive_card",
          cardId: firstId,
          expectedMetadataRevision: 1,
        });
        expect(archived.lifecycle).toBe("archived");

        const deleted = committed(fixture, "delete-first", {
          kind: "delete_card",
          cardId: firstId,
          expectedMetadataRevision: archived.metadataRevision,
          expectedLocationRevision: first.locationRevision,
        });
        expect(deleted.lifecycle).toBe("deleted");
        expect(
          readAuthoritativeCardById(
            fixture.database,
            fixture.projectId,
            firstId,
          ) === null,
        ).toBe(true);
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM top_level_block_placements WHERE block_id = ?",
            )
            .get(firstId) === undefined,
        ).toBe(true);
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM database_memberships WHERE card_block_id = ? AND removed_at IS NULL",
            )
            .get(firstId) === undefined,
        ).toBe(true);

        const continuityBefore = verifyCardDocumentContinuity(
          fixture.database,
          fixture.projectId,
          firstId,
        );
        const restored = committed(fixture, "restore-first", {
          kind: "restore_card",
          cardId: firstId,
          deleteOperationId: "delete-first",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedLocationRevision: deleted.locationRevision,
          membership: {
            membershipId: deleted.membershipId,
            databaseBlockId: deleted.databaseBlockId,
            viewId: deleted.viewId,
            status: "draft",
          },
        });
        expect(restored.lifecycle).toBe("archived");
        expect(restored.documentId).toBe(first.documentId);
        expect(restored.documentHeadSeq).toBe(first.documentHeadSeq);
        expect(
          verifyCardDocumentContinuity(
            fixture.database,
            fixture.projectId,
            firstId,
          )?.title,
        ).toBe(continuityBefore?.title);
        expect(
          readAuthoritativeCardById(
            fixture.database,
            fixture.projectId,
            firstId,
          )?.archived,
        ).toBe(true);

        const duplicate = applyCardLifecycleMutation(
          fixture.database,
          request(fixture, "restore-first", {
            kind: "restore_card",
            cardId: firstId,
            deleteOperationId: "delete-first",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedLocationRevision: deleted.locationRevision,
            membership: {
              membershipId: deleted.membershipId,
              databaseBlockId: deleted.databaseBlockId,
              viewId: deleted.viewId,
              status: "draft",
            },
          }),
        );
        expect(duplicate.ok).toBe(true);
        if (duplicate.ok) expect(duplicate.value.duplicate).toBe(true);
      });
    },
  );

  sqliteTest(
    "tombstones and restores the exact current indexed closure across nested Documents",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const cardBodyId = createUuidV7();
        const nestedOneId = createUuidV7();
        const nestedOneBodyId = createUuidV7();
        const nestedTwoId = createUuidV7();
        const nestedTwoBodyId = createUuidV7();
        committed(
          fixture,
          "create-closure",
          createOperation(cardId, "Nested closure"),
          { allocateBodyBlockId: () => cardBodyId },
        );
        createExplicitDocumentBearingBlock(fixture.database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_explicit_document_bearing_block",
          operationId: "closure:create-first",
          projectId: fixture.projectId,
          storeEpoch: fixture.storeEpoch,
          clientSessionId: "card-lifecycle-test",
          actor: { kind: "test" },
          blockKind: "large_document",
          blockId: nestedOneId,
          documentId: "document:lifecycle:nested-one",
          displayName: "Nested one",
          blockTree: [paragraph(nestedOneBodyId, "First body")],
          location: {
            kind: "document",
            hostDocumentId: `document:${cardId}`,
            expectedHostGeneration: 1,
            expectedHostHeadSeq: 1,
          },
        });
        createExplicitDocumentBearingBlock(fixture.database, {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_explicit_document_bearing_block",
          operationId: "closure:create-second",
          projectId: fixture.projectId,
          storeEpoch: fixture.storeEpoch,
          clientSessionId: "card-lifecycle-test",
          actor: { kind: "test" },
          blockKind: "large_document",
          blockId: nestedTwoId,
          documentId: "document:lifecycle:nested-two",
          displayName: "Nested two",
          blockTree: [paragraph(nestedTwoBodyId, "Second body")],
          location: {
            kind: "document",
            hostDocumentId: "document:lifecycle:nested-one",
            expectedHostGeneration: 1,
            expectedHostHeadSeq: 1,
          },
        });

        const staleBlockId = "lifecycle:stale-unindexed";
        fixture.database
          .prepare(
            `
            INSERT INTO blocks (
              id, project_id, type, lifecycle, location_kind,
              containing_document_id, location_revision, metadata_revision,
              created_at, updated_at
            ) VALUES (?, ?, 'paragraph', 'deleted', 'document', ?, 1, 2, ?, ?)
          `,
          )
          .run(
            staleBlockId,
            fixture.projectId,
            `document:${cardId}`,
            "2026-07-12T00:00:00.000Z",
            "2026-07-12T00:00:00.000Z",
          );

        const closureBlockIds = [
          cardId,
          cardBodyId,
          nestedOneId,
          nestedOneBodyId,
          nestedTwoId,
          nestedTwoBodyId,
        ].sort((left, right) => left.localeCompare(right));
        const closureDocumentIds = [
          `document:${cardId}`,
          "document:lifecycle:nested-one",
          "document:lifecycle:nested-two",
        ].sort((left, right) => left.localeCompare(right));
        const deleted = committed(fixture, "delete-closure", {
          kind: "delete_card",
          cardId,
          expectedMetadataRevision: 1,
          expectedLocationRevision: 1,
        });
        expect(
          Object.values(readBlockLifecycles(fixture, closureBlockIds)).every(
            (candidate) =>
              candidate.lifecycle === "deleted" && candidate.revision === 2,
          ),
        ).toBe(true);
        expect(readBlockLifecycles(fixture, [staleBlockId])[staleBlockId]?.lifecycle).toBe(
          "deleted",
        );
        expect(readBlockLifecycles(fixture, [staleBlockId])[staleBlockId]?.revision).toBe(
          2,
        );

        const deleteLedger = fixture.database
          .prepare(
            `
            SELECT mutation.target_block_ids_json, change.payload_json
            FROM block_mutations mutation
            INNER JOIN change_log change ON change.seq = mutation.change_log_seq
            WHERE mutation.mutation_id = 'delete-closure'
          `,
          )
          .get() as {
          readonly target_block_ids_json: string;
          readonly payload_json: string;
        };
        const deletePayload = JSON.parse(deleteLedger.payload_json) as {
          readonly tombstonedBlockIds: readonly string[];
          readonly indexedDocumentIds: readonly string[];
        };
        const expectedTargets = [
          ...closureBlockIds,
          ...(deleted.databaseBlockId ? [deleted.databaseBlockId] : []),
        ].sort((left, right) => left.localeCompare(right));
        expect(deleteLedger.target_block_ids_json).toBe(
          JSON.stringify(expectedTargets),
        );
        expect(JSON.stringify(deletePayload.tombstonedBlockIds)).toBe(
          JSON.stringify(closureBlockIds),
        );
        expect(JSON.stringify(deletePayload.indexedDocumentIds)).toBe(
          JSON.stringify(closureDocumentIds),
        );

        const restored = committed(fixture, "restore-closure", {
          kind: "restore_card",
          cardId,
          deleteOperationId: "delete-closure",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedLocationRevision: deleted.locationRevision,
          membership: {
            membershipId: deleted.membershipId,
            databaseBlockId: deleted.databaseBlockId,
            viewId: deleted.viewId,
            status: "draft",
          },
        });
        expect(restored.lifecycle).toBe("active");
        expect(
          Object.values(readBlockLifecycles(fixture, closureBlockIds)).every(
            (candidate) =>
              candidate.lifecycle === "active" && candidate.revision === 3,
          ),
        ).toBe(true);
        expect(readBlockLifecycles(fixture, [staleBlockId])[staleBlockId]?.lifecycle).toBe(
          "deleted",
        );
        expect(readBlockLifecycles(fixture, [staleBlockId])[staleBlockId]?.revision).toBe(
          2,
        );

        const restorePayload = JSON.parse(
          (
            fixture.database
              .prepare(
                `
                SELECT change.payload_json
                FROM block_mutations mutation
                INNER JOIN change_log change ON change.seq = mutation.change_log_seq
                WHERE mutation.mutation_id = 'restore-closure'
              `,
              )
              .get() as { readonly payload_json: string }
          ).payload_json,
        ) as { readonly restoredBlockIds: readonly string[] };
        expect(JSON.stringify(restorePayload.restoredBlockIds)).toBe(
          JSON.stringify(closureBlockIds),
        );
      });
    },
  );

  sqliteTest(
    "rejects restore when the current indexed closure diverges from delete evidence",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const bodyId = createUuidV7();
        committed(
          fixture,
          "create-closure-drift",
          createOperation(cardId),
          { allocateBodyBlockId: () => bodyId },
        );
        const deleted = committed(fixture, "delete-closure-drift", {
          kind: "delete_card",
          cardId,
          expectedMetadataRevision: 1,
          expectedLocationRevision: 1,
        });
        const now = "2026-07-12T01:00:00.000Z";
        fixture.database
          .prepare(
            `
            INSERT INTO blocks (
              id, project_id, type, lifecycle, location_kind,
              containing_document_id, location_revision, metadata_revision,
              created_at, updated_at
            ) VALUES ('closure-drift:injected', ?, 'paragraph', 'active',
              'document', ?, 1, 1, ?, ?)
          `,
          )
          .run(fixture.projectId, deleted.documentId, now, now);
        fixture.database
          .prepare(
            `
            INSERT INTO document_block_index (
              document_id, block_id, parent_block_id, ordinal,
              block_type, text, projected_seq
            ) VALUES (?, 'closure-drift:injected', NULL, 999,
              'paragraph', 'injected', ?)
          `,
          )
          .run(deleted.documentId, deleted.documentHeadSeq);

        const restore = applyCardLifecycleMutation(
          fixture.database,
          request(fixture, "restore-closure-drift", {
            kind: "restore_card",
            cardId,
            deleteOperationId: "delete-closure-drift",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedLocationRevision: deleted.locationRevision,
            membership: {
              membershipId: deleted.membershipId,
              databaseBlockId: deleted.databaseBlockId,
              viewId: deleted.viewId,
              status: "draft",
            },
          }),
        );
        expect(restore.ok).toBe(false);
        if (!restore.ok) expect(restore.error.code).toBe("delete_evidence_invalid");
        expect(readBlock(fixture, cardId).lifecycle).toBe("deleted");
        expect(
          readBlockLifecycles(fixture, [bodyId])[bodyId]?.lifecycle,
        ).toBe("deleted");
      });
    },
  );

  sqliteTest(
    "rolls closure lifecycle transitions back and replays lost commit responses exactly",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const bodyId = createUuidV7();
        committed(fixture, "create-closure-fault", createOperation(cardId), {
          allocateBodyBlockId: () => bodyId,
        });
        const deleteRequest = request(fixture, "delete-closure-fault", {
          kind: "delete_card",
          cardId,
          expectedMetadataRevision: 1,
          expectedLocationRevision: 1,
        });
        let deleteRolledBack = false;
        try {
          applyCardLifecycleMutation(fixture.database, deleteRequest, {
            faultInjector: (point) => {
              if (point === "after_authority") throw new Error("rollback delete");
            },
          });
        } catch {
          deleteRolledBack = true;
        }
        expect(deleteRolledBack).toBe(true);
        expect(readBlock(fixture, cardId).metadata_revision).toBe(1);
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.lifecycle).toBe(
          "active",
        );
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.revision).toBe(1);

        let deleteResponseLost = false;
        try {
          applyCardLifecycleMutation(fixture.database, deleteRequest, {
            faultInjector: (point) => {
              if (point === "after_commit") throw new Error("lost delete response");
            },
          });
        } catch {
          deleteResponseLost = true;
        }
        expect(deleteResponseLost).toBe(true);
        const deleteReplay = applyCardLifecycleMutation(
          fixture.database,
          deleteRequest,
        );
        expect(deleteReplay.ok).toBe(true);
        if (!deleteReplay.ok) return;
        expect(deleteReplay.value.duplicate).toBe(true);
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.revision).toBe(2);

        const restoreRequest = request(fixture, "restore-closure-fault", {
          kind: "restore_card",
          cardId,
          deleteOperationId: "delete-closure-fault",
          expectedMetadataRevision: deleteReplay.value.metadataRevision,
          expectedLocationRevision: deleteReplay.value.locationRevision,
          membership: {
            membershipId: deleteReplay.value.membershipId,
            databaseBlockId: deleteReplay.value.databaseBlockId,
            viewId: deleteReplay.value.viewId,
            status: "draft",
          },
        });
        let restoreRolledBack = false;
        try {
          applyCardLifecycleMutation(fixture.database, restoreRequest, {
            faultInjector: (point) => {
              if (point === "after_authority") throw new Error("rollback restore");
            },
          });
        } catch {
          restoreRolledBack = true;
        }
        expect(restoreRolledBack).toBe(true);
        expect(readBlock(fixture, cardId).lifecycle).toBe("deleted");
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.lifecycle).toBe(
          "deleted",
        );
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.revision).toBe(2);

        let restoreResponseLost = false;
        try {
          applyCardLifecycleMutation(fixture.database, restoreRequest, {
            faultInjector: (point) => {
              if (point === "after_commit") throw new Error("lost restore response");
            },
          });
        } catch {
          restoreResponseLost = true;
        }
        expect(restoreResponseLost).toBe(true);
        const restoreReplay = applyCardLifecycleMutation(
          fixture.database,
          restoreRequest,
        );
        expect(restoreReplay.ok).toBe(true);
        if (!restoreReplay.ok) return;
        expect(restoreReplay.value.duplicate).toBe(true);
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.lifecycle).toBe(
          "active",
        );
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.revision).toBe(3);
      });
    },
  );

  sqliteTest(
    "restores only the membership and lifecycle bound by exact delete evidence",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        committed(fixture, "create-evidence", createOperation(cardId));
        const deleted = committed(fixture, "delete-evidence", {
          kind: "delete_card",
          cardId,
          expectedMetadataRevision: 1,
          expectedLocationRevision: 1,
        });

        const injected = applyCardLifecycleMutation(
          fixture.database,
          request(fixture, "restore-injected", {
            kind: "restore_card",
            cardId,
            deleteOperationId: "delete-evidence",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedLocationRevision: deleted.locationRevision,
            membership: {
              membershipId: "membership:older",
              databaseBlockId: deleted.databaseBlockId,
              viewId: deleted.viewId,
              status: "draft",
            },
          }),
        );
        expect(injected.ok).toBe(false);
        if (!injected.ok)
          expect(injected.error.code).toBe("delete_evidence_invalid");
        expect(readBlock(fixture, cardId).lifecycle).toBe("deleted");

        const exactRetry = applyCardLifecycleMutation(
          fixture.database,
          request(fixture, "restore-injected", {
            kind: "restore_card",
            cardId,
            deleteOperationId: "delete-evidence",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedLocationRevision: deleted.locationRevision,
            membership: {
              membershipId: "membership:older",
              databaseBlockId: deleted.databaseBlockId,
              viewId: deleted.viewId,
              status: "draft",
            },
          }),
        );
        expect(exactRetry.ok).toBe(false);
        expect(
          fixture.database
            .prepare(
              "SELECT outcome FROM block_mutations WHERE mutation_id = 'restore-injected'",
            )
            .get() !== undefined,
        ).toBe(true);
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM change_log WHERE operation_id = 'restore-injected'",
            )
            .get() === undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "deletes and restores a standalone zero-membership Card as standalone",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const created = committed(
          fixture,
          "create-standalone",
          createOperation(cardId),
        );
        detachMembership(fixture, cardId);
        const detached = readBlock(fixture, cardId);
        const deleted = committed(fixture, "delete-standalone", {
          kind: "delete_card",
          cardId,
          expectedMetadataRevision: detached.metadata_revision,
          expectedLocationRevision: detached.location_revision,
        });
        expect(deleted.membershipId).toBe(null);
        const restored = committed(fixture, "restore-standalone", {
          kind: "restore_card",
          cardId,
          deleteOperationId: "delete-standalone",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedLocationRevision: deleted.locationRevision,
          membership: null,
        });
        expect(restored.lifecycle).toBe("active");
        expect(restored.membershipId).toBe(null);
        expect(restored.documentId).toBe(created.documentId);
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM database_memberships WHERE card_block_id = ? AND removed_at IS NULL",
            )
            .get(cardId) === undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "validates create values against current Database options",
    async () => {
      await withFixture((fixture) => {
        fixture.database
          .prepare(
            `
            UPDATE database_properties
            SET config_json = '{"options":[]}'
            WHERE project_id = ? AND key = 'priority' AND lifecycle = 'active'
          `,
          )
          .run(fixture.projectId);
        const cardId = createUuidV7();
        const result = applyCardLifecycleMutation(
          fixture.database,
          request(fixture, "create-option-rejected", {
            ...createOperation(cardId),
            priority: "p1-high",
          }),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("database_property_value_invalid");
        }
        expect(
          fixture.database
            .prepare("SELECT 1 FROM blocks WHERE id = ?")
            .get(cardId) === undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "reads lifecycle authority and restore evidence at one snapshot coordinate",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const created = committed(
          fixture,
          "create-preflight",
          createOperation(cardId),
        );
        const active = readCardLifecyclePreflightSnapshot(
          fixture.database,
          fixture.projectId,
          cardId,
        );
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        const activeCard = active.value.value?.card;
        expect(active.value.storeEpoch).toBe(fixture.storeEpoch);
        expect(active.value.changeLogSeq).toBe(created.changeLogSeq);
        expect(active.value.value?.reservedBlockType).toBe(null);
        expect(activeCard?.document.documentId).toBe(created.documentId);
        expect(activeCard?.membership?.membershipId).toBe(created.membershipId);
        expect(activeCard?.membership?.viewId).toBe(created.viewId);
        expect(activeCard?.membership?.status).toBe("draft");
        expect(activeCard?.membership?.position.groupKey).toBe("draft");
        expect(
          active.value.value?.primaryDatabase.query.rows.some(
            (row) => row.card.blockId === cardId,
          ) ?? false,
        ).toBe(true);

        const deleted = committed(fixture, "delete-preflight", {
          kind: "delete_card",
          cardId,
          expectedMetadataRevision: created.metadataRevision,
          expectedLocationRevision: created.locationRevision,
        });
        const tombstone = readCardLifecyclePreflightSnapshot(
          fixture.database,
          fixture.projectId,
          cardId,
        );
        expect(tombstone.ok).toBe(true);
        if (!tombstone.ok) return;
        expect(tombstone.value.changeLogSeq).toBe(deleted.changeLogSeq);
        expect(tombstone.value.value?.card?.lifecycle).toBe("deleted");
        expect(tombstone.value.value?.card?.location.kind).toBe("database");
        expect(tombstone.value.value?.card?.restoreEvidence?.deleteOperationId).toBe(
          "delete-preflight",
        );
        expect(tombstone.value.value?.card?.restoreEvidence?.membership?.membershipId).toBe(
          created.membershipId,
        );
      });
    },
  );

  sqliteTest(
    "reports application identity reserved by another Project globally",
    async () => {
      await withFixture((fixture) => {
        const otherProject = createProject({ name: "Other identity owner" });
        const cardId = createUuidV7();
        committed(
          {
            database: fixture.database,
            projectId: otherProject.id,
            storeEpoch: fixture.storeEpoch,
          },
          "create-other-project",
          createOperation(cardId),
        );

        const result = readCardLifecyclePreflightSnapshot(
          fixture.database,
          fixture.projectId,
          cardId,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.value?.card).toBe(null);
        expect(result.value.value?.reservedBlockType).toBe("card");
      });
    },
  );

  sqliteTest(
    "rolls every pre-commit fault back and replays a lost post-commit response",
    async () => {
      await withFixture((fixture) => {
        const points: readonly CardLifecycleMutationFaultPoint[] = [
          "after_identity",
          "after_document_genesis",
          "after_properties",
          "after_authority",
          "after_projections",
          "after_change_log",
          "after_ledger",
          "before_commit",
        ];
        for (const [index, point] of points.entries()) {
          const cardId = createUuidV7();
          let failed = false;
          try {
            applyCardLifecycleMutation(
              fixture.database,
              request(
                fixture,
                `create-fault-${index}`,
                createOperation(cardId),
              ),
              {
                faultInjector: (candidate) => {
                  if (candidate === point) throw new Error(`fault:${point}`);
                },
              },
            );
          } catch {
            failed = true;
          }
          expect(failed).toBe(true);
          expect(
            fixture.database
              .prepare("SELECT 1 FROM blocks WHERE id = ?")
              .get(cardId) === undefined,
          ).toBe(true);
          expect(
            fixture.database
              .prepare("SELECT 1 FROM block_mutations WHERE mutation_id = ?")
              .get(`create-fault-${index}`) === undefined,
          ).toBe(true);
        }

        const cardId = createUuidV7();
        let responseLost = false;
        try {
          applyCardLifecycleMutation(
            fixture.database,
            request(fixture, "create-after-commit", createOperation(cardId)),
            {
              faultInjector: (point) => {
                if (point === "after_commit") throw new Error("response lost");
              },
            },
          );
        } catch {
          responseLost = true;
        }
        expect(responseLost).toBe(true);
        const retried = applyCardLifecycleMutation(
          fixture.database,
          request(fixture, "create-after-commit", createOperation(cardId)),
        );
        expect(retried.ok).toBe(true);
        if (retried.ok) expect(retried.value.duplicate).toBe(true);
      });
    },
  );
});
