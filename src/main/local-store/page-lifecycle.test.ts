import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parsePageLifecycleMutationRequest,
  type PageLifecycleMutationRequest,
} from "../../shared/page-lifecycle";
import { createUuidV7 } from "../../shared/uuid-v7";
import { readDatabasePageById } from "./page-read-store";
import {
  applyPageLifecycleMutation,
  readPageLifecyclePreflightSnapshot,
  verifyPageDocumentContinuity,
  type ApplyPageLifecycleMutationOptions,
  type PageLifecycleMutationFaultPoint,
} from "./page-lifecycle";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import { rebuildPageReadModelProjection } from "./page-read-store";
import { refreshScheduledPageIndexProjection } from "./scheduled-page-store";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import { putProjectResourceGrantInDatabase } from "./project-resource-grants";

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
    path.join(os.tmpdir(), "nodex-page-lifecycle-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Page lifecycle" });
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
): PageLifecycleMutationRequest =>
  parsePageLifecycleMutationRequest({
    version: 1,
    operationId,
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "page-lifecycle-test",
    actor: { kind: "test" },
    operation,
  });

const createOperation = (
  pageId: string,
  title = "Authority Card",
): Readonly<Record<string, unknown>> => ({
  kind: "create_page",
  pageId,
  title,
  nfm: "Body paragraph",
  status: "draft",
});

const committed = (
  fixture: Fixture,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
  options: ApplyPageLifecycleMutationOptions = {},
) => {
  const result = applyPageLifecycleMutation(
    fixture.database,
    request(fixture, operationId, operation),
    options,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const readBlock = (
  fixture: Fixture,
  pageId: string,
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
    .get(pageId, fixture.projectId) as {
    readonly lifecycle: "active" | "archived" | "deleted";
    readonly metadata_revision: number;
    readonly location_revision: number;
  };

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

const detachMembership = (fixture: Fixture, pageId: string): void => {
  const now = "2026-07-11T12:00:00.000Z";
  fixture.database
    .transaction(() => {
      fixture.database
        .prepare(
          "DELETE FROM database_view_positions WHERE block_id = ? AND project_id = ?",
        )
        .run(pageId, fixture.projectId);
      fixture.database
        .prepare(
          `
        UPDATE database_memberships
        SET removed_at = ?, revision = revision + 1
        WHERE page_block_id = ? AND project_id = ? AND removed_at IS NULL
      `,
        )
        .run(now, pageId, fixture.projectId);
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
        .run(now, pageId, fixture.projectId);
      fixture.database
        .prepare(
          `
          INSERT INTO top_level_block_placements (
            block_id, project_id, rank_key, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(pageId, fixture.projectId, `standalone:${pageId}`, now, now);
      refreshScheduledPageIndexProjection(
        fixture.database,
        fixture.projectId,
        [pageId],
        now,
      );
      rebuildPageReadModelProjection(fixture.database, fixture.projectId, [
        pageId,
      ]);
    })
    .immediate();
};

describe("authoritative Page lifecycle kernel", () => {
  sqliteTest(
    "replays a pre-v63 create receipt without restoring retired Agent properties",
    async () => {
      await withFixture((fixture) => {
        const operationId = "create-legacy-agent-replay";
        const pageId = createUuidV7();
        const operation = createOperation(pageId, "Legacy receipt");
        committed(fixture, operationId, operation);

        const parsed = request(fixture, operationId, operation);
        const historicalLogicalRequest = {
          version: 1,
          projectId: fixture.projectId,
          operation: {
            ...parsed.operation,
            agentBlocked: true,
            agentStatus: "waiting-for-human",
          },
        };
        const historicalRequestJson = stableStringifyBlockPropertyJson(
          historicalLogicalRequest,
        );
        const historicalRequestHash = createHash("sha256")
          .update(historicalRequestJson)
          .digest("hex");
        const receipt = fixture.database
          .prepare(
            `SELECT change_log_seq
             FROM block_mutations
             WHERE mutation_id = ?`,
          )
          .get(operationId) as { readonly change_log_seq: number };
        const change = fixture.database
          .prepare("SELECT payload_json FROM change_log WHERE seq = ?")
          .get(receipt.change_log_seq) as { readonly payload_json: string };
        const changePayload = JSON.parse(change.payload_json) as Record<
          string,
          unknown
        >;
        changePayload.requestHash = historicalRequestHash;
        // Seed the exact immutable evidence shape produced by pre-v63 code.
        fixture.database.exec(`
          DROP TRIGGER block_mutations_are_immutable;
          DROP TRIGGER change_log_is_immutable;
        `);
        fixture.database
          .prepare(
            `UPDATE block_mutations
             SET request_hash = ?, request_json = ?
             WHERE mutation_id = ?`,
          )
          .run(historicalRequestHash, historicalRequestJson, operationId);
        fixture.database
          .prepare("UPDATE change_log SET payload_json = ? WHERE seq = ?")
          .run(
            stableStringifyBlockPropertyJson(changePayload),
            receipt.change_log_seq,
          );
        const evidenceBeforeReplay = {
          mutation: fixture.database
            .prepare(
              `SELECT request_hash, request_json
               FROM block_mutations
               WHERE mutation_id = ?`,
            )
            .get(operationId),
          change: fixture.database
            .prepare("SELECT payload_json FROM change_log WHERE seq = ?")
            .get(receipt.change_log_seq),
        };

        const replay = applyPageLifecycleMutation(
          fixture.database,
          {
            version: 1,
            operationId,
            projectId: fixture.projectId,
            storeEpoch: fixture.storeEpoch,
            actor: { kind: "legacy-retry" },
            operation: {
              ...operation,
              agentBlocked: true,
              agentStatus: "waiting-for-human",
            },
          } as unknown as PageLifecycleMutationRequest,
        );

        expect(replay.ok).toBe(true);
        if (!replay.ok) throw new Error(replay.error.message);
        expect(replay.value.duplicate).toBe(true);
        expect(
          fixture.database
            .prepare(
              `SELECT property_key
               FROM block_properties
               WHERE block_id = ?
                 AND property_key IN ('agent.blocked', 'agent.status')`,
            )
            .all(pageId),
        ).toEqual([]);
        expect({
          mutation: fixture.database
            .prepare(
              `SELECT request_hash, request_json
               FROM block_mutations
               WHERE mutation_id = ?`,
            )
            .get(operationId),
          change: fixture.database
            .prepare("SELECT payload_json FROM change_log WHERE seq = ?")
            .get(receipt.change_log_seq),
        }).toEqual(evidenceBeforeReplay);
      });
    },
  );

  sqliteTest(
    "creates a title-only Card with one registered editable paragraph",
    async () => {
      await withFixture((fixture) => {
        const pageId = createUuidV7();
        const created = committed(fixture, "create-title-only", {
          ...createOperation(pageId, "Title only"),
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
        const pageId = createUuidV7();
        const result = applyPageLifecycleMutation(
          fixture.database,
          request(fixture, "reject-foreign-body", {
            ...createOperation(pageId),
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
          fixture.database.prepare("SELECT 1 FROM blocks WHERE id = ?").get(pageId) ===
            undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "creates, archives, deletes, and restores one Source Page without a cards row",
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
        const card = readDatabasePageById(
          fixture.database,
          fixture.projectId,
          firstId,
        );
        expect(card?.title).toBe("First");
        expect(card?.description).toBe("Body paragraph");
        expect(card?.status).toBe("draft");
        expect(first.documentHeadSeq).toBe(1);

        const archived = committed(fixture, "archive-first", {
          kind: "archive_page",
          pageId: firstId,
          expectedMetadataRevision: 1,
        });
        expect(archived.lifecycle).toBe("archived");

        const deleted = committed(fixture, "delete-first", {
          kind: "delete_page",
          pageId: firstId,
          expectedMetadataRevision: archived.metadataRevision,
          expectedParentRevision: first.parentRevision,
        });
        expect(deleted.lifecycle).toBe("deleted");
        expect(
          readDatabasePageById(
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
              "SELECT 1 FROM database_memberships WHERE page_block_id = ? AND removed_at IS NULL",
            )
            .get(firstId) === undefined,
        ).toBe(true);

        const continuityBefore = verifyPageDocumentContinuity(
          fixture.database,
          fixture.projectId,
          firstId,
        );
        const restored = committed(fixture, "restore-first", {
          kind: "restore_page",
          pageId: firstId,
          deleteOperationId: "delete-first",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedParentRevision: deleted.parentRevision,
          membership: {
            membershipId: deleted.membershipId,
            databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
            status: "draft",
            position: deleted.viewId ? { viewId: deleted.viewId } : null,
          },
        });
        expect(restored.lifecycle).toBe("archived");
        expect(restored.documentId).toBe(first.documentId);
        expect(restored.documentHeadSeq).toBe(first.documentHeadSeq);
        expect(
          verifyPageDocumentContinuity(
            fixture.database,
            fixture.projectId,
            firstId,
          )?.title,
        ).toBe(continuityBefore?.title);
        expect(
          readDatabasePageById(
            fixture.database,
            fixture.projectId,
            firstId,
          )?.archived,
        ).toBe(true);

        const duplicate = applyPageLifecycleMutation(
          fixture.database,
          request(fixture, "restore-first", {
            kind: "restore_page",
            pageId: firstId,
            deleteOperationId: "delete-first",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedParentRevision: deleted.parentRevision,
            membership: {
              membershipId: deleted.membershipId,
              databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
              status: "draft",
              position: deleted.viewId ? { viewId: deleted.viewId } : null,
            },
          }),
        );
        expect(duplicate.ok).toBe(true);
        if (duplicate.ok) expect(duplicate.value.duplicate).toBe(true);
      });
    },
  );

  sqliteTest(
    "rejects restore when the current indexed closure diverges from delete evidence",
    async () => {
      await withFixture((fixture) => {
        const pageId = createUuidV7();
        const bodyId = createUuidV7();
        committed(
          fixture,
          "create-closure-drift",
          createOperation(pageId),
          { allocateBodyBlockId: () => bodyId },
        );
        const deleted = committed(fixture, "delete-closure-drift", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: 1,
          expectedParentRevision: 1,
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

        const restore = applyPageLifecycleMutation(
          fixture.database,
          request(fixture, "restore-closure-drift", {
            kind: "restore_page",
            pageId,
            deleteOperationId: "delete-closure-drift",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedParentRevision: deleted.parentRevision,
            membership: {
              membershipId: deleted.membershipId,
              databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
              status: "draft",
              position: deleted.viewId ? { viewId: deleted.viewId } : null,
            },
          }),
        );
        expect(restore.ok).toBe(false);
        if (!restore.ok) expect(restore.error.code).toBe("delete_evidence_invalid");
        expect(readBlock(fixture, pageId).lifecycle).toBe("deleted");
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
        const pageId = createUuidV7();
        const bodyId = createUuidV7();
        committed(fixture, "create-closure-fault", createOperation(pageId), {
          allocateBodyBlockId: () => bodyId,
        });
        const deleteRequest = request(fixture, "delete-closure-fault", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: 1,
          expectedParentRevision: 1,
        });
        let deleteRolledBack = false;
        try {
          applyPageLifecycleMutation(fixture.database, deleteRequest, {
            faultInjector: (point) => {
              if (point === "after_authority") throw new Error("rollback delete");
            },
          });
        } catch {
          deleteRolledBack = true;
        }
        expect(deleteRolledBack).toBe(true);
        expect(readBlock(fixture, pageId).metadata_revision).toBe(1);
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.lifecycle).toBe(
          "active",
        );
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.revision).toBe(1);

        let deleteResponseLost = false;
        try {
          applyPageLifecycleMutation(fixture.database, deleteRequest, {
            faultInjector: (point) => {
              if (point === "after_commit") throw new Error("lost delete response");
            },
          });
        } catch {
          deleteResponseLost = true;
        }
        expect(deleteResponseLost).toBe(true);
        const deleteReplay = applyPageLifecycleMutation(
          fixture.database,
          deleteRequest,
        );
        expect(deleteReplay.ok).toBe(true);
        if (!deleteReplay.ok) return;
        expect(deleteReplay.value.duplicate).toBe(true);
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.revision).toBe(2);

        const restoreRequest = request(fixture, "restore-closure-fault", {
          kind: "restore_page",
          pageId,
          deleteOperationId: "delete-closure-fault",
          expectedMetadataRevision: deleteReplay.value.metadataRevision,
          expectedParentRevision: deleteReplay.value.parentRevision,
          membership: {
            membershipId: deleteReplay.value.membershipId,
            databaseId: deleteReplay.value.databaseId,
            dataSourceId: deleteReplay.value.dataSourceId,
            status: "draft",
            position: deleteReplay.value.viewId
              ? { viewId: deleteReplay.value.viewId }
              : null,
          },
        });
        let restoreRolledBack = false;
        try {
          applyPageLifecycleMutation(fixture.database, restoreRequest, {
            faultInjector: (point) => {
              if (point === "after_authority") throw new Error("rollback restore");
            },
          });
        } catch {
          restoreRolledBack = true;
        }
        expect(restoreRolledBack).toBe(true);
        expect(readBlock(fixture, pageId).lifecycle).toBe("deleted");
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.lifecycle).toBe(
          "deleted",
        );
        expect(readBlockLifecycles(fixture, [bodyId])[bodyId]?.revision).toBe(2);

        let restoreResponseLost = false;
        try {
          applyPageLifecycleMutation(fixture.database, restoreRequest, {
            faultInjector: (point) => {
              if (point === "after_commit") throw new Error("lost restore response");
            },
          });
        } catch {
          restoreResponseLost = true;
        }
        expect(restoreResponseLost).toBe(true);
        const restoreReplay = applyPageLifecycleMutation(
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
        const pageId = createUuidV7();
        committed(fixture, "create-evidence", createOperation(pageId));
        const deleted = committed(fixture, "delete-evidence", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: 1,
          expectedParentRevision: 1,
        });

        const injected = applyPageLifecycleMutation(
          fixture.database,
          request(fixture, "restore-injected", {
            kind: "restore_page",
            pageId,
            deleteOperationId: "delete-evidence",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedParentRevision: deleted.parentRevision,
            membership: {
              membershipId: "membership:older",
              databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
              status: "draft",
              position: deleted.viewId ? { viewId: deleted.viewId } : null,
            },
          }),
        );
        expect(injected.ok).toBe(false);
        if (!injected.ok)
          expect(injected.error.code).toBe("delete_evidence_invalid");
        expect(readBlock(fixture, pageId).lifecycle).toBe("deleted");

        const exactRetry = applyPageLifecycleMutation(
          fixture.database,
          request(fixture, "restore-injected", {
            kind: "restore_page",
            pageId,
            deleteOperationId: "delete-evidence",
            expectedMetadataRevision: deleted.metadataRevision,
            expectedParentRevision: deleted.parentRevision,
            membership: {
              membershipId: "membership:older",
              databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
              status: "draft",
              position: deleted.viewId ? { viewId: deleted.viewId } : null,
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
        const pageId = createUuidV7();
        const created = committed(
          fixture,
          "create-standalone",
          createOperation(pageId),
        );
        detachMembership(fixture, pageId);
        putProjectResourceGrantInDatabase(fixture.database, {
          projectId: fixture.projectId,
          root: { kind: "page", pageId },
          access: "read_write",
        });
        const detached = readBlock(fixture, pageId);
        const deleted = committed(fixture, "delete-standalone", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: detached.metadata_revision,
          expectedParentRevision: detached.location_revision,
        });
        expect(deleted.membershipId).toBe(null);
        const restored = committed(fixture, "restore-standalone", {
          kind: "restore_page",
          pageId,
          deleteOperationId: "delete-standalone",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedParentRevision: deleted.parentRevision,
          membership: null,
        });
        expect(restored.lifecycle).toBe("active");
        expect(restored.membershipId).toBe(null);
        expect(restored.documentId).toBe(created.documentId);
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM database_memberships WHERE page_block_id = ? AND removed_at IS NULL",
            )
            .get(pageId) === undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "rematerializes skipped Card NFM projections when a deleted Card is restored",
    async () => {
      await withFixture((fixture) => {
        const targetId = createUuidV7();
        committed(
          fixture,
          "create-restore-mention-target",
          createOperation(targetId, "Mention target"),
        );
        const pageId = createUuidV7();
        const created = committed(fixture, "create-restore-mention-host", {
          ...createOperation(pageId, "Mention host"),
          nfm: `<page-ref url="nodex://pages/${targetId}" />`,
        });
        fixture.database.prepare(
          "UPDATE document_materializations SET nfm = ? WHERE document_id = ?",
        ).run(
          `<card-ref target-block="${targetId}" />`,
          created.documentId,
        );

        const deleted = committed(fixture, "delete-restore-mention-host", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: created.metadataRevision,
          expectedParentRevision: created.parentRevision,
        });
        committed(fixture, "restore-mention-host", {
          kind: "restore_page",
          pageId,
          deleteOperationId: "delete-restore-mention-host",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedParentRevision: deleted.parentRevision,
          membership: {
            membershipId: deleted.membershipId,
            databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
            status: "draft",
            position: deleted.viewId ? { viewId: deleted.viewId } : null,
          },
        });

        const canonicalNfm =
          `<page-ref url="nodex://pages/${targetId}" />`;
        expect(
          fixture.database.prepare(
            "SELECT nfm FROM document_materializations WHERE document_id = ?",
          ).pluck().get(created.documentId),
        ).toBe(canonicalNfm);
        expect(
          fixture.database.prepare(
            "SELECT description_length FROM page_read_model WHERE page_block_id = ?",
          ).pluck().get(pageId),
        ).toBe(canonicalNfm.length);
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
        const pageId = createUuidV7();
        const result = applyPageLifecycleMutation(
          fixture.database,
          request(fixture, "create-option-rejected", {
            ...createOperation(pageId),
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
            .get(pageId) === undefined,
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "deletes and restores a Database member without inventing a View position",
    async () => {
      await withFixture((fixture) => {
        const pageId = createUuidV7();
        const created = committed(
          fixture,
          "create-unpositioned-lifecycle",
          createOperation(pageId),
        );
        fixture.database
          .prepare(
            "DELETE FROM database_view_positions WHERE block_id = ? AND project_id = ?",
          )
          .run(pageId, fixture.projectId);

        const active = readPageLifecyclePreflightSnapshot(
          fixture.database,
          fixture.projectId,
          pageId,
        );
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        expect(active.value.value?.page?.membership?.position).toBe(null);

        const deleted = committed(fixture, "delete-unpositioned-lifecycle", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: created.metadataRevision,
          expectedParentRevision: created.parentRevision,
        });
        expect(deleted.viewId).toBe(null);

        const restored = committed(fixture, "restore-unpositioned-lifecycle", {
          kind: "restore_page",
          pageId,
          deleteOperationId: "delete-unpositioned-lifecycle",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedParentRevision: deleted.parentRevision,
          membership: {
            membershipId: deleted.membershipId,
            databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
            status: "draft",
            position: null,
          },
        });
        expect(restored.membershipId).toBe(created.membershipId);
        expect(restored.viewId).toBe(null);
        expect(
          fixture.database
            .prepare(
              "SELECT COUNT(*) FROM database_view_positions WHERE block_id = ?",
            )
            .pluck()
            .get(pageId),
        ).toBe(0);
        expect(
          readDatabasePageById(fixture.database, fixture.projectId, pageId)
            ?.order,
        ).toBe(Number.MAX_SAFE_INTEGER);
      });
    },
  );

  sqliteTest(
    "reads lifecycle authority and restore evidence at one snapshot coordinate",
    async () => {
      await withFixture((fixture) => {
        const pageId = createUuidV7();
        const created = committed(
          fixture,
          "create-preflight",
          createOperation(pageId),
        );
        const active = readPageLifecyclePreflightSnapshot(
          fixture.database,
          fixture.projectId,
          pageId,
        );
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        const activeCard = active.value.value.page;
        expect(active.value.storeEpoch).toBe(fixture.storeEpoch);
        expect(active.value.changeLogSeq).toBe(created.changeLogSeq);
        expect(active.value.value.reservedBlockType).toBe(null);
        expect(activeCard?.document.documentId).toBe(created.documentId);
        expect(activeCard?.membership?.membershipId).toBe(created.membershipId);
        expect(activeCard?.membership?.viewId).toBe(created.viewId);
        expect(activeCard?.membership?.status).toBe("draft");
        expect(activeCard?.membership?.position?.groupKey).toBe("draft");
        expect(
          active.value.value.defaultView.rows.some(
            (row) => row.page.pageId === pageId,
          ),
        ).toBe(true);

        const deleted = committed(fixture, "delete-preflight", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: created.metadataRevision,
          expectedParentRevision: created.parentRevision,
        });
        const tombstone = readPageLifecyclePreflightSnapshot(
          fixture.database,
          fixture.projectId,
          pageId,
        );
        expect(tombstone.ok).toBe(true);
        if (!tombstone.ok) return;
        expect(tombstone.value.changeLogSeq).toBe(deleted.changeLogSeq);
        expect(tombstone.value.value.page?.lifecycle).toBe("deleted");
        expect(tombstone.value.value.page?.parent.kind).toBe("data_source");
        expect(tombstone.value.value.page?.restoreEvidence?.deleteOperationId).toBe(
          "delete-preflight",
        );
        expect(tombstone.value.value.page?.restoreEvidence?.membership?.membershipId).toBe(
          created.membershipId,
        );
      });
    },
  );

  sqliteTest(
    "denies Page lifecycle preflight across Projects without a resource grant",
    async () => {
      await withFixture((fixture) => {
        const otherProject = createProject({ name: "Other identity owner" });
        const pageId = createUuidV7();
        committed(
          {
            database: fixture.database,
            projectId: otherProject.id,
            storeEpoch: fixture.storeEpoch,
          },
          "create-other-project",
          createOperation(pageId),
        );

        const result = readPageLifecyclePreflightSnapshot(
          fixture.database,
          fixture.projectId,
          pageId,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("authorization_denied");
      });
    },
  );

  sqliteTest(
    "authorizes Page lifecycle through a recursive cross-Project Page grant",
    async () => {
      await withFixture((fixture) => {
        const grantee = createProject({ name: "Granted Page worker" });
        const pageId = createUuidV7();
        const created = committed(
          fixture,
          "create-granted-page",
          createOperation(pageId),
        );
        putProjectResourceGrantInDatabase(fixture.database, {
          projectId: grantee.id,
          root: { kind: "page", pageId },
          access: "read_write",
        });
        const grantedFixture: Fixture = {
          database: fixture.database,
          projectId: grantee.id,
          storeEpoch: fixture.storeEpoch,
        };

        const preflight = readPageLifecyclePreflightSnapshot(
          fixture.database,
          grantee.id,
          pageId,
        );
        expect(preflight.ok).toBe(true);
        if (!preflight.ok) return;
        expect(preflight.value.value.page?.pageId).toBe(pageId);

        const archived = committed(grantedFixture, "archive-granted-page", {
          kind: "archive_page",
          pageId,
          expectedMetadataRevision: created.metadataRevision,
        });
        expect(archived.projectId).toBe(grantee.id);
        expect(archived.lifecycle).toBe("archived");
        expect(readBlock(fixture, pageId).lifecycle).toBe("archived");

        const deleted = committed(grantedFixture, "delete-granted-page", {
          kind: "delete_page",
          pageId,
          expectedMetadataRevision: archived.metadataRevision,
          expectedParentRevision: archived.parentRevision,
        });
        const restored = committed(grantedFixture, "restore-granted-page", {
          kind: "restore_page",
          pageId,
          deleteOperationId: "delete-granted-page",
          expectedMetadataRevision: deleted.metadataRevision,
          expectedParentRevision: deleted.parentRevision,
          membership: {
            membershipId: deleted.membershipId,
            databaseId: deleted.databaseId,
            dataSourceId: deleted.dataSourceId,
            status: "draft",
            position: deleted.viewId ? { viewId: deleted.viewId } : null,
          },
        });
        expect(restored.lifecycle).toBe("archived");
        expect(readBlock(fixture, pageId).lifecycle).toBe("archived");
      });
    },
  );

  sqliteTest(
    "rolls every pre-commit fault back and replays a lost post-commit response",
    async () => {
      await withFixture((fixture) => {
        const points: readonly PageLifecycleMutationFaultPoint[] = [
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
          const pageId = createUuidV7();
          let failed = false;
          try {
            applyPageLifecycleMutation(
              fixture.database,
              request(
                fixture,
                `create-fault-${index}`,
                createOperation(pageId),
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
              .get(pageId) === undefined,
          ).toBe(true);
          expect(
            fixture.database
              .prepare("SELECT 1 FROM block_mutations WHERE mutation_id = ?")
              .get(`create-fault-${index}`) === undefined,
          ).toBe(true);
        }

        const pageId = createUuidV7();
        let responseLost = false;
        try {
          applyPageLifecycleMutation(
            fixture.database,
            request(fixture, "create-after-commit", createOperation(pageId)),
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
        const retried = applyPageLifecycleMutation(
          fixture.database,
          request(fixture, "create-after-commit", createOperation(pageId)),
        );
        expect(retried.ok).toBe(true);
        if (retried.ok) expect(retried.value.duplicate).toBe(true);
      });
    },
  );
});
