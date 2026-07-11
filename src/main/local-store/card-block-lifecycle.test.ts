import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCardLifecycleMutationRequest,
  type CardLifecycleMutationRequest,
} from "../../shared/card-lifecycle";
import { createUuidV7 } from "../../shared/card-id";
import { readAuthoritativeCardById } from "./card-read-store";
import {
  applyCardLifecycleMutation,
  readCardLifecyclePreflightSnapshot,
  verifyCardDocumentContinuity,
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
) => {
  const result = applyCardLifecycleMutation(
    fixture.database,
    request(fixture, operationId, operation),
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
        SET metadata_revision = metadata_revision + 1, updated_at = ?
        WHERE id = ? AND project_id = ?
      `,
        )
        .run(now, cardId, fixture.projectId);
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
    "creates, moves, archives, deletes, and restores one Card without a cards row",
    async () => {
      await withFixture((fixture) => {
        const firstId = createUuidV7();
        const secondId = createUuidV7();
        const first = committed(
          fixture,
          "create-first",
          createOperation(firstId, "First"),
        );
        committed(
          fixture,
          "create-second",
          createOperation(secondId, "Second"),
        );

        expect(
          fixture.database
            .prepare("SELECT 1 FROM cards WHERE id = ?")
            .get(firstId) === undefined,
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

        const moved = committed(fixture, "move-first", {
          kind: "move_card_in_space",
          cardId: firstId,
          expectedLocationRevision: 1,
          beforeBlockId: secondId,
        });
        expect(moved.locationRevision).toBe(2);
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
          expectedLocationRevision: moved.locationRevision,
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
        expect(tombstone.value.value?.card?.location.kind).toBe("space");
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
