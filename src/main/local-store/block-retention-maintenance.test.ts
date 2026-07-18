import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import {
  parsePageLifecycleMutationRequestV2,
  type PageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import { createUuidV7 } from "../../shared/uuid-v7";
import { readBlockStoreEpoch } from "./block-store-metadata";
import {
  maintainBlockRetention,
  type BlockRetentionMaintenanceFaultPoint,
} from "./block-retention-maintenance";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createDocumentVersionCheckpoint } from "./document-versions";
import {
  applyPageLifecycleV2Fixture,
  createPageLifecycleV2Fixture,
} from "./page-lifecycle-v2-test-fixture";
import { createProject } from "./projects";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly storeEpoch: string;
}

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

const withFixture = async (
  run: (fixture: Fixture) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previousDirectory = process.env.NODEX_HOME;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-block-retention-maintenance-"),
  );
  process.env.NODEX_HOME = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Block retention maintenance" });
    const database = getDb();
    const storeEpoch = readBlockStoreEpoch(database);
    if (!storeEpoch) throw new Error("Retention fixture has no store epoch");
    await run({ database, projectId: project.id, storeEpoch });
  } finally {
    closeDatabase();
    if (previousDirectory === undefined) delete process.env.NODEX_HOME;
    else process.env.NODEX_HOME = previousDirectory;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const lifecycleRequest = (
  fixture: Fixture,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
): PageLifecycleMutationRequestV2 =>
  parsePageLifecycleMutationRequestV2({
    version: 2,
    operationId,
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "retention-maintenance-test",
    actor: { kind: "test" },
    operation,
  });

const commitLifecycle = (
  fixture: Fixture,
  request: PageLifecycleMutationRequestV2,
) => applyPageLifecycleV2Fixture(fixture.database, request);

const createLifecycle = (
  fixture: Fixture,
  operationId: string,
  operation: Readonly<{
    kind: "create_page";
    pageId: string;
    title: string;
    nfm: string;
    status: "triage";
  }>,
) =>
  createPageLifecycleV2Fixture(fixture.database, {
    operationId,
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "retention-maintenance-test",
    actor: { kind: "test" },
    operation,
  });

const seedDeletedBlock = (
  database: Database.Database,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly updatedAt: string;
  },
): void => {
  database
    .prepare(
      `INSERT INTO blocks (
         id, project_id, type, lifecycle, location_kind,
         containing_document_id, location_revision, metadata_revision,
         created_at, updated_at
       ) VALUES (?, ?, 'paragraph', 'deleted', 'space', NULL, 1, 1, ?, ?)`,
    )
    .run(input.id, input.projectId, input.updatedAt, input.updatedAt);
};

const seedRejectedMutation = (
  fixture: Fixture,
  input: {
    readonly mutationId: string;
    readonly projectId?: string;
    readonly blockIds: readonly string[];
    readonly documentIdsJson?: string;
  },
): void => {
  fixture.database
    .prepare(
      `INSERT INTO block_mutations (
         mutation_id, project_id, store_epoch, mutation_kind, actor_json,
         client_session_id, request_hash, request_json,
         target_block_ids_json, affected_document_ids_json,
         affected_database_block_ids_json, field_intents_json,
         expected_revisions_json, outcome, result_json,
         committed_revisions_json, document_heads_json, change_log_seq,
         recorded_at
       ) VALUES (?, ?, ?, 'retention_test', '{}', NULL, ?, '{}', ?, ?, '[]',
         '[]', '{}', 'rejected', '{}', '{}', '{}', NULL, ?)`,
    )
    .run(
      input.mutationId,
      input.projectId ?? fixture.projectId,
      fixture.storeEpoch,
      createHash("sha256").update(input.mutationId).digest("hex"),
      JSON.stringify(input.blockIds),
      input.documentIdsJson ?? "[]",
      "2026-07-12T00:00:00.000Z",
    );
};

const seedChange = (
  fixture: Fixture,
  input: {
    readonly projectId?: string;
    readonly blockIds: readonly string[];
    readonly operationId: string;
  },
): number =>
  Number(
    fixture.database
      .prepare(
        `INSERT INTO change_log (
           project_id, store_epoch, kind, operation_id,
           block_ids_json, document_ids_json, database_block_ids_json,
           payload_json, committed_at
         ) VALUES (?, ?, 'retention_test', ?, ?, '[]', '[]', '{}', ?)`,
      )
      .run(
        input.projectId ?? fixture.projectId,
        fixture.storeEpoch,
        input.operationId,
        JSON.stringify(input.blockIds),
        "2026-07-12T00:00:00.000Z",
      ).lastInsertRowid,
  );

const rowExists = (
  database: Database.Database,
  sql: string,
  ...bindings: readonly unknown[]
): boolean => database.prepare(sql).get(...bindings) !== undefined;

describe("Block retention count maintenance", () => {
  sqliteTest(
    "prunes attributable expiring evidence atomically and preserves exact retry",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const created = createLifecycle(
          fixture,
          "create:atomic",
          {
            kind: "create_page",
            pageId: cardId,
            title: "Retention atomic",
            nfm: "Retained body",
            status: "triage",
          },
        );
        const checkpoint = createDocumentVersionCheckpoint(
          fixture.database,
          {
            version: 1,
            projectId: fixture.projectId,
            storeEpoch: fixture.storeEpoch,
            documentId: created.documentId,
            expectedGeneration: created.documentGeneration,
            expectedHeadSeq: created.documentHeadSeq,
            cause: "retention_test",
            revisionKind: "automatic",
            actor: { kind: "test" },
          },
          { now: () => "2025-01-01T00:00:00.000Z" },
        );
        const deleteRequest = lifecycleRequest(fixture, "delete:atomic", {
          kind: "delete_page",
          pageId: cardId,
          expectedMetadataRevision: created.metadataRevision,
          expectedParentRevision: created.parentRevision,
        });
        const deleted = commitLifecycle(fixture, deleteRequest);
        const card = { cardId, created, deleted, deleteRequest };
        const recoveryId = "recovery:retention:resolved";
        const update = Buffer.from([1]);
        fixture.database
          .prepare(
            `INSERT INTO document_recovery_artifacts (
               id, project_id, store_epoch, document_id, generation,
               update_id, client_session_id, base_head_seq,
               touched_block_ids_json, derived_touched_block_ids_json,
               update_blob, update_hash, update_byte_length, reason,
               relocation_ids_json, status, created_at, expires_at, resolved_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'retention-test', ?, ?, NULL, ?, ?, ?,
               'unsafe_stale_update', '[]', 'resolved', ?, ?, ?)`,
          )
          .run(
            recoveryId,
            fixture.projectId,
            fixture.storeEpoch,
            card.deleted.documentId,
            card.deleted.documentGeneration,
            "update:retention:resolved",
            card.deleted.documentHeadSeq,
            JSON.stringify([card.cardId]),
            update,
            createHash("sha256").update(update).digest("hex"),
            update.byteLength,
            "2026-07-12T00:00:00.000Z",
            "2026-07-13T00:00:00.000Z",
            "2026-07-12T00:01:00.000Z",
          );

        const faultPoints: readonly BlockRetentionMaintenanceFaultPoint[] = [
          "after_evidence_prune",
          "after_replan",
          "after_identity_retirement",
          "after_ownership_delete",
          "after_block_delete",
          "after_document_delete",
          "before_candidate_commit",
        ];
        for (const faultPoint of faultPoints) {
          const failed = maintainBlockRetention(
            fixture.database,
            {
              projectId: fixture.projectId,
              policy: { retainNewestDeletedBlocks: 0 },
            },
            {
              faultInjector: (point, rootBlockId) => {
                if (rootBlockId === card.cardId && point === faultPoint) {
                  throw new Error(`injected retention failure: ${faultPoint}`);
                }
              },
            },
          );
          expect(
            failed.candidates.some(
              (candidate) =>
                candidate.rootBlockId === card.cardId &&
                candidate.status === "failed",
            ),
          ).toBe(true);
          expect(
            rowExists(
              fixture.database,
              "SELECT 1 FROM blocks WHERE id = ?",
              card.cardId,
            ),
          ).toBe(true);
          expect(
            rowExists(
              fixture.database,
              "SELECT 1 FROM retired_block_identities WHERE block_id = ?",
              card.cardId,
            ),
          ).toBe(false);
          expect(
            rowExists(
              fixture.database,
              "SELECT 1 FROM document_versions WHERE version_id = ?",
              checkpoint.checkpoint.versionId,
            ),
          ).toBe(true);
          expect(
            rowExists(
              fixture.database,
              "SELECT 1 FROM document_recovery_artifacts WHERE id = ?",
              recoveryId,
            ),
          ).toBe(true);
        }

        const maintained = maintainBlockRetention(fixture.database, {
          projectId: fixture.projectId,
          policy: { retainNewestDeletedBlocks: 0 },
        });
        const collected = maintained.candidates.find(
          (candidate) => candidate.rootBlockId === card.cardId,
        );
        expect(collected?.status).toBe("collected");
        if (collected?.status !== "collected") {
          throw new Error("Card tombstone was not collected");
        }
        expect(
          maintained.candidates.every(
            (candidate) =>
              candidate.status === "collected" ||
              candidate.status === "covered",
          ),
        ).toBe(true);
        expect(collected.retiredBlockIds.length).toBe(
          collected.deletedBlockIds.length,
        );
        expect(
          collected.retiredBlockIds.every((blockId) =>
            rowExists(
              fixture.database,
              "SELECT 1 FROM retired_block_identities WHERE block_id = ?",
              blockId,
            ),
          ),
        ).toBe(true);
        const deleteEvidence = fixture.database
          .prepare(
            `SELECT target_block_ids_json
             FROM block_mutations WHERE mutation_id = ?`,
          )
          .get(card.deleteRequest.operationId) as {
          readonly target_block_ids_json: string;
        };
        const deleteTargetBlockIds = JSON.parse(
          deleteEvidence.target_block_ids_json,
        ) as readonly string[];
        expect(
          collected.retiredBlockIds.every((blockId) =>
            deleteTargetBlockIds.includes(blockId),
          ),
        ).toBe(true);
        expect(
          collected.evidence.prunedDocumentVersionIds.includes(
            checkpoint.checkpoint.versionId,
          ),
        ).toBe(true);
        expect(
          collected.evidence.prunedRecoveryArtifactIds.includes(recoveryId),
        ).toBe(true);
        expect(
          collected.evidence.releasedBlockMutationIds.includes(
            card.deleteRequest.operationId,
          ),
        ).toBe(true);
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM block_mutations WHERE mutation_id = ?",
            card.deleteRequest.operationId,
          ),
        ).toBe(true);
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM change_log WHERE seq = ?",
            card.deleted.changeLogSeq,
          ),
        ).toBe(true);

        const retry = applyPageLifecycleV2Fixture(
          fixture.database,
          card.deleteRequest,
        );
        expect(retry.duplicate).toBe(true);
        expect(retry.changeLogSeq).toBe(card.deleted.changeLogSeq);

        let reused = false;
        try {
          seedDeletedBlock(fixture.database, {
            id: card.cardId,
            projectId: fixture.projectId,
            updatedAt: "2026-07-14T00:00:00.000Z",
          });
          reused = true;
        } catch {
          // The retired-identity trigger is the final storage-level guard.
        }
        expect(reused).toBe(false);

        const idempotent = maintainBlockRetention(fixture.database, {
          projectId: fixture.projectId,
          policy: { retainNewestDeletedBlocks: 0 },
        });
        expect(idempotent.selectedRootBlockIds.length).toBe(0);
        expect(idempotent.candidates.length).toBe(0);
      });
    },
  );

  sqliteTest(
    "retains a deleted owner while a named revision remains pinned",
    async () => {
      await withFixture((fixture) => {
        const cardId = createUuidV7();
        const created = createLifecycle(
          fixture,
          "create:pinned-revision",
          {
            kind: "create_page",
            pageId: cardId,
            title: "Pinned revision",
            nfm: "Keep this recovery point",
            status: "triage",
          },
        );
        const checkpoint = createDocumentVersionCheckpoint(fixture.database, {
          version: 1,
          projectId: fixture.projectId,
          storeEpoch: fixture.storeEpoch,
          documentId: created.documentId,
          expectedGeneration: created.documentGeneration,
          expectedHeadSeq: created.documentHeadSeq,
          cause: "named_checkpoint",
          label: "Before archive",
          revisionKind: "manual",
          actor: { kind: "test" },
        });
        commitLifecycle(
          fixture,
          lifecycleRequest(fixture, "delete:pinned-revision", {
            kind: "delete_page",
            pageId: cardId,
            expectedMetadataRevision: created.metadataRevision,
            expectedParentRevision: created.parentRevision,
          }),
        );

        const maintained = maintainBlockRetention(
          fixture.database,
          {
            projectId: fixture.projectId,
            policy: { retainNewestDeletedBlocks: 0 },
          },
          { now: () => "2100-01-01T00:00:00.000Z" },
        );

        expect(
          maintained.candidates.find(
            (candidate) => candidate.rootBlockId === cardId,
          )?.status,
        ).toBe("retained");
        expect(
          rowExists(fixture.database, "SELECT 1 FROM blocks WHERE id = ?", cardId),
        ).toBe(true);
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM document_versions WHERE version_id = ?",
            checkpoint.checkpoint.versionId,
          ),
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "preserves the newest tombstone and all immutable retry/history rows",
    async () => {
      await withFixture((fixture) => {
        seedDeletedBlock(fixture.database, {
          id: "retention:old",
          projectId: fixture.projectId,
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
        seedDeletedBlock(fixture.database, {
          id: "retention:new",
          projectId: fixture.projectId,
          updatedAt: "2026-01-02T00:00:00.000Z",
        });
        seedRejectedMutation(fixture, {
          mutationId: "mutation:retention:old",
          blockIds: ["retention:old"],
        });
        seedRejectedMutation(fixture, {
          mutationId: "mutation:retention:new",
          blockIds: ["retention:new"],
        });
        const oldChange = seedChange(fixture, {
          operationId: "change:retention:old",
          blockIds: ["retention:old"],
        });
        const newChange = seedChange(fixture, {
          operationId: "change:retention:new",
          blockIds: ["retention:new"],
        });

        const result = maintainBlockRetention(fixture.database, {
          projectId: fixture.projectId,
          policy: { retainNewestDeletedBlocks: 1 },
        });
        expect(result.retainedNewestBlockIds[0]).toBe("retention:new");
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM blocks WHERE id = 'retention:old'",
          ),
        ).toBe(false);
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM blocks WHERE id = 'retention:new'",
          ),
        ).toBe(true);
        for (const mutationId of [
          "mutation:retention:old",
          "mutation:retention:new",
        ]) {
          expect(
            rowExists(
              fixture.database,
              "SELECT 1 FROM block_mutations WHERE mutation_id = ?",
              mutationId,
            ),
          ).toBe(true);
        }
        for (const seq of [oldChange, newChange]) {
          expect(
            rowExists(
              fixture.database,
              "SELECT 1 FROM change_log WHERE seq = ?",
              seq,
            ),
          ).toBe(true);
        }
      });
    },
  );

  sqliteTest(
    "releases same-Project mixed immutable evidence but retains cross-Project attribution",
    async () => {
      await withFixture((fixture) => {
        const otherProject = createProject({ name: "Retention evidence host" });
        seedDeletedBlock(fixture.database, {
          id: "retention:mixed",
          projectId: fixture.projectId,
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
        seedDeletedBlock(fixture.database, {
          id: "retention:cross-project",
          projectId: fixture.projectId,
          updatedAt: "2026-01-02T00:00:00.000Z",
        });
        fixture.database
          .prepare(
            `INSERT INTO blocks (
               id, project_id, type, lifecycle, location_kind,
               containing_document_id, location_revision, metadata_revision,
               created_at, updated_at
             ) VALUES ('retention:live', ?, 'paragraph', 'active', 'space', NULL,
               1, 1, ?, ?)`,
          )
          .run(
            fixture.projectId,
            "2026-01-03T00:00:00.000Z",
            "2026-01-03T00:00:00.000Z",
          );
        seedRejectedMutation(fixture, {
          mutationId: "mutation:retention:mixed",
          blockIds: ["retention:mixed", "retention:live"],
        });
        const duplicateChangeSeq = seedChange(fixture, {
          operationId: "change:retention:mixed-legacy-duplicates",
          blockIds: [
            "retention:mixed",
            "retention:live",
            "retention:mixed",
          ],
        });
        seedRejectedMutation(fixture, {
          mutationId: "mutation:retention:cross-project",
          projectId: otherProject.id,
          blockIds: ["retention:cross-project"],
        });

        const result = maintainBlockRetention(fixture.database, {
          projectId: fixture.projectId,
          policy: { retainNewestDeletedBlocks: 0 },
        });
        const mixed = result.candidates.find(
          (entry) => entry.rootBlockId === "retention:mixed",
        );
        expect(mixed?.status).toBe("collected");
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM blocks WHERE id = 'retention:mixed'",
          ),
        ).toBe(false);
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM blocks WHERE id = 'retention:live'",
          ),
        ).toBe(true);
        expect(
          rowExists(
            fixture.database,
            `SELECT 1 FROM block_mutations
             WHERE mutation_id = 'mutation:retention:mixed'`,
          ),
        ).toBe(true);
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM change_log WHERE seq = ?",
            duplicateChangeSeq,
          ),
        ).toBe(true);

        const crossProject = result.candidates.find(
          (entry) => entry.rootBlockId === "retention:cross-project",
        );
        expect(crossProject?.status).toBe("retained");
        expect(
          crossProject?.status === "retained" ? crossProject.reason : "",
        ).toBe("unsafe_retained_evidence");
        expect(
          rowExists(
            fixture.database,
            "SELECT 1 FROM blocks WHERE id = 'retention:cross-project'",
          ),
        ).toBe(true);
      });
    },
  );

  sqliteTest("retains corrupt immutable attribution", async () => {
    await withFixture((fixture) => {
      seedDeletedBlock(fixture.database, {
        id: "retention:corrupt",
        projectId: fixture.projectId,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      seedRejectedMutation(fixture, {
        mutationId: "mutation:retention:corrupt",
        blockIds: ["retention:corrupt"],
        documentIdsJson: "[1]",
      });

      const result = maintainBlockRetention(fixture.database, {
        projectId: fixture.projectId,
        policy: { retainNewestDeletedBlocks: 0 },
      });
      expect(result.candidates[0]?.status).toBe("retained");
      expect(
        result.candidates[0]?.status === "retained"
          ? result.candidates[0].reason
          : "",
      ).toBe("unsafe_retained_evidence");
      expect(
        rowExists(
          fixture.database,
          "SELECT 1 FROM blocks WHERE id = 'retention:corrupt'",
        ),
      ).toBe(true);
    });
  });

  sqliteTest("never prunes a pending recovery artifact", async () => {
    await withFixture((fixture) => {
      const now = "2026-01-01T00:00:00.000Z";
      const blockId = "retention:pending-recovery";
      const documentId = "document:retention:pending-recovery";
      fixture.database
        .prepare(
          `INSERT INTO blocks (
             id, project_id, type, lifecycle, location_kind,
             containing_document_id, location_revision, metadata_revision,
             created_at, updated_at
           ) VALUES (?, ?, 'page', 'deleted', 'space', NULL, 1, 1, ?, ?)`,
        )
        .run(blockId, fixture.projectId, now, now);
      fixture.database
        .prepare(
          `INSERT INTO documents (
             id, project_id, generation, head_seq, schema_key, schema_version,
             state_vector, state_hash, readiness, authority,
             genesis_source_revision, created_at, updated_at
           ) VALUES (?, ?, 1, 0, 'nodex.page', 1, X'', '', 'ready',
             'ydoc_primary', NULL, ?, ?)`,
        )
        .run(documentId, fixture.projectId, now, now);
      fixture.database
        .prepare(
          `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(blockId, documentId, fixture.projectId, now);
      const recoveryId = "recovery:retention:pending";
      const update = Buffer.from([1]);
      fixture.database
        .prepare(
          `INSERT INTO document_recovery_artifacts (
             id, project_id, store_epoch, document_id, generation,
             update_id, client_session_id, base_head_seq,
             touched_block_ids_json, derived_touched_block_ids_json,
             update_blob, update_hash, update_byte_length, reason,
             relocation_ids_json, status, created_at, expires_at, resolved_at
           ) VALUES (?, ?, ?, ?, 1, ?, 'retention-test', 0, ?, NULL, ?, ?, ?,
             'unsafe_stale_update', '[]', 'pending', ?, ?, NULL)`,
        )
        .run(
          recoveryId,
          fixture.projectId,
          fixture.storeEpoch,
          documentId,
          "update:retention:pending",
          JSON.stringify([blockId]),
          update,
          createHash("sha256").update(update).digest("hex"),
          update.byteLength,
          now,
          "2026-01-02T00:00:00.000Z",
        );

      const result = maintainBlockRetention(fixture.database, {
        projectId: fixture.projectId,
        policy: { retainNewestDeletedBlocks: 0 },
      });
      expect(result.candidates[0]?.status).toBe("retained");
      expect(
        result.candidates[0]?.status === "retained"
          ? result.candidates[0].reason
          : "",
      ).toBe("reachability_blocked");
      expect(
        rowExists(
          fixture.database,
          "SELECT 1 FROM document_recovery_artifacts WHERE id = ?",
          recoveryId,
        ),
      ).toBe(true);
      expect(
        rowExists(
          fixture.database,
          "SELECT 1 FROM blocks WHERE id = ?",
          blockId,
        ),
      ).toBe(true);
    });
  });

  sqliteTest("never releases a live Block reference", async () => {
    await withFixture((fixture) => {
      const targetBlockId = "retention:live-reference-target";
      seedDeletedBlock(fixture.database, {
        id: targetBlockId,
        projectId: fixture.projectId,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      createLifecycle(
        fixture,
        "create:retention-reference-host",
        {
          kind: "create_page",
          pageId: createUuidV7(),
          title: "Reference host",
          nfm: `<page-ref url="nodex://pages/${targetBlockId}" />`,
          status: "triage",
        },
      );

      const result = maintainBlockRetention(fixture.database, {
        projectId: fixture.projectId,
        policy: { retainNewestDeletedBlocks: 0 },
      });
      const candidate = result.candidates.find(
        (entry) => entry.rootBlockId === targetBlockId,
      );
      expect(candidate?.status).toBe("retained");
      if (candidate?.status !== "retained") {
        throw new Error("Referenced Block was not retained");
      }
      expect(candidate.reason).toBe("reachability_blocked");
      expect(
        candidate.candidate.blockers.some(
          (blocker) => blocker.kind === "block_tree_reference",
        ),
      ).toBe(true);
      expect(
        rowExists(
          fixture.database,
          "SELECT 1 FROM blocks WHERE id = ?",
          targetBlockId,
        ),
      ).toBe(true);
    });
  });
});
