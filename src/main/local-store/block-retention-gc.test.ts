import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createCardDocumentGenesis } from "../../shared/block-documents/block-document-codec";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "./database";
import { createProject } from "./projects";
import {
  planBlockRetentionGc,
  type BlockRetentionGcBlockerKind,
  type BlockRetentionGcCandidate,
} from "./block-retention-gc";

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

const withDatabase = async (
  operation: (database: Database.Database, projectId: string) => void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-block-gc-"));
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Block retention GC test" });
    operation(getDb(), project.id);
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const seedBlock = (
  database: Database.Database,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly type?: string;
    readonly lifecycle?: "active" | "archived" | "deleted";
    readonly documentId?: string;
    readonly updatedAt?: string;
  },
): void => {
  const now = input.updatedAt ?? new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `,
    )
    .run(
      input.id,
      input.projectId,
      input.type ?? "paragraph",
      input.lifecycle ?? "deleted",
      input.documentId ? "document" : "space",
      input.documentId ?? null,
      now,
      now,
    );
};

const seedOwnedDocument = (
  database: Database.Database,
  input: {
    readonly ownerBlockId: string;
    readonly projectId: string;
    readonly documentId: string;
    readonly lifecycle?: "active" | "archived" | "deleted";
    readonly headSeq?: number;
  },
): void => {
  seedBlock(database, {
    id: input.ownerBlockId,
    projectId: input.projectId,
    type: "card",
    lifecycle: input.lifecycle,
  });
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, ?, 'nodex.card', 1, X'', '',
        'ready', 'ydoc_primary', NULL, ?, ?)
    `,
    )
    .run(input.documentId, input.projectId, input.headSeq ?? 0, now, now);
  database
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.ownerBlockId, input.documentId, input.projectId, now);
};

const seedBlockTreeProjection = (
  database: Database.Database,
  input: {
    readonly documentId: string;
    readonly headSeq?: number;
    readonly blockIds?: readonly string[];
    readonly references?: readonly unknown[];
  },
): void => {
  const blocks = (input.blockIds ?? []).map((id) => ({
    id,
    type: "paragraph",
    props: {},
    content: [],
    children: [],
  }));
  database
    .prepare(
      `
      INSERT INTO document_materializations (
        document_id, generation, projected_seq, schema_version,
        title, nfm, plain_text, preview, block_tree_json,
        references_json, asset_refs_json, updated_at
      ) VALUES (?, 1, ?, 1, '', '', '', '', ?, ?, '[]', ?)
    `,
    )
    .run(
      input.documentId,
      input.headSeq ?? 0,
      JSON.stringify(blocks),
      JSON.stringify(input.references ?? []),
      new Date().toISOString(),
    );
};

const candidateFrom = (
  database: Database.Database,
  projectId: string,
  blockId: string,
  retainNewestDeletedBlocks = 0,
): BlockRetentionGcCandidate => {
  const candidate = planBlockRetentionGc(database, {
    projectId,
    rootBlockIds: [blockId],
    policy: { retainNewestDeletedBlocks },
  }).candidates[0];
  if (!candidate) throw new Error("GC planner omitted the requested candidate");
  return candidate;
};

const hasBlocker = (
  candidate: BlockRetentionGcCandidate,
  kind: BlockRetentionGcBlockerKind,
): boolean => candidate.blockers.some((blocker) => blocker.kind === kind);

describe("Block retention GC kernel", () => {
  sqliteTest("retains the newest-N tombstones and never selects live Blocks", async () => {
    await withDatabase((database, projectId) => {
      seedBlock(database, {
        id: "gc:old",
        projectId,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      seedBlock(database, {
        id: "gc:new",
        projectId,
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
      seedBlock(database, {
        id: "gc:active",
        projectId,
        lifecycle: "active",
        updatedAt: "2026-01-03T00:00:00.000Z",
      });

      const explicit = planBlockRetentionGc(database, {
        projectId,
        rootBlockIds: ["gc:old", "gc:new", "gc:active"],
        policy: { retainNewestDeletedBlocks: 1 },
      });
      expect(hasBlocker(explicit.candidates[0]!, "policy_newest_tombstone")).toBe(false);
      expect(hasBlocker(explicit.candidates[1]!, "policy_newest_tombstone")).toBe(true);
      expect(hasBlocker(explicit.candidates[2]!, "block_not_deleted")).toBe(true);

      const automatic = planBlockRetentionGc(database, {
        projectId,
        policy: { retainNewestDeletedBlocks: 1 },
      });
      expect(automatic.candidates.length).toBe(1);
      expect(automatic.candidates[0]?.rootBlockId).toBe("gc:old");
    });
  });

  sqliteTest("plans an owned Document closure and blocks live descendants", async () => {
    await withDatabase((database, projectId) => {
      seedOwnedDocument(database, {
        ownerBlockId: "gc:owner",
        projectId,
        documentId: "document:gc-owner",
      });
      seedBlock(database, {
        id: "gc:child",
        projectId,
        documentId: "document:gc-owner",
      });
      const owner = candidateFrom(database, projectId, "gc:owner");
      expect(owner.collectible).toBe(true);
      expect(owner.closureBlockIds.includes("gc:owner")).toBe(true);
      expect(owner.closureBlockIds.includes("gc:child")).toBe(true);
      expect(owner.ownedDocumentIds[0]).toBe("document:gc-owner");

      seedOwnedDocument(database, {
        ownerBlockId: "gc:blocked-owner",
        projectId,
        documentId: "document:gc-blocked-owner",
      });
      seedBlock(database, {
        id: "gc:live-child",
        projectId,
        documentId: "document:gc-blocked-owner",
        lifecycle: "archived",
      });
      const blocked = candidateFrom(database, projectId, "gc:blocked-owner");
      expect(hasBlocker(blocked, "live_contained_block")).toBe(true);

      seedBlock(database, {
        id: "gc:missing-ownership",
        projectId,
        type: "card",
      });
      expect(
        hasBlocker(
          candidateFrom(database, projectId, "gc:missing-ownership"),
          "ownership_corrupt",
        ),
      ).toBe(true);
    });
  });

  sqliteTest("finds exact live references and fail-closes unknown inbound FKs", async () => {
    await withDatabase((database, projectId) => {
      seedBlock(database, { id: "gc:referenced", projectId });
      seedOwnedDocument(database, {
        ownerBlockId: "gc:host",
        projectId,
        documentId: "document:gc-host",
        lifecycle: "active",
      });
      seedBlockTreeProjection(database, {
        documentId: "document:gc-host",
        blockIds: ["gc:source"],
        references: [
          {
            kind: "block",
            sourceBlockId: "gc:source",
            targetBlockId: "gc:referenced",
          },
        ],
      });
      const referenced = candidateFrom(database, projectId, "gc:referenced");
      expect(hasBlocker(referenced, "block_tree_reference")).toBe(true);

      database.exec(`
        CREATE TABLE gc_future_retained_links (
          block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE RESTRICT
        ) WITHOUT ROWID
      `);
      seedBlock(database, { id: "gc:future-root", projectId });
      seedBlock(database, { id: "gc:future-unlinked", projectId });
      database.prepare("INSERT INTO gc_future_retained_links (block_id) VALUES (?)").run("gc:future-root");
      const futureRoot = candidateFrom(database, projectId, "gc:future-root");
      const futureUnlinked = candidateFrom(database, projectId, "gc:future-unlinked");
      expect(hasBlocker(futureRoot, "unclassified_foreign_key_root")).toBe(true);
      expect(hasBlocker(futureUnlinked, "unclassified_foreign_key_root")).toBe(false);
    });
  });

  sqliteTest("retains recovery, version, ledger, database, and session roots", async () => {
    await withDatabase((database, projectId) => {
      seedOwnedDocument(database, {
        ownerBlockId: "gc:evidence-owner",
        projectId,
        documentId: "document:gc-evidence",
      });
      const now = new Date().toISOString();
      const hash = "0".repeat(64);
      const storeEpoch = (
        database.prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1").get() as {
          readonly store_epoch: string;
        }
      ).store_epoch;
      database
        .prepare(
          `INSERT INTO document_versions (
            version_id, document_id, project_id, generation, base_head_seq,
            schema_key, schema_version, cause, label, actor_json,
            full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
          ) VALUES (?, ?, ?, 1, 0, 'nodex.card', 1, 'test', NULL, '{}',
            X'01', X'', ?, 1, ?)`,
        )
        .run("version:gc-evidence", "document:gc-evidence", projectId, hash, now);
      database
        .prepare(
          `INSERT INTO document_recovery_artifacts (
            id, project_id, store_epoch, document_id, generation,
            update_id, client_session_id, base_head_seq,
            touched_block_ids_json, derived_touched_block_ids_json,
            update_blob, update_hash, update_byte_length, reason,
            relocation_ids_json, status, created_at, expires_at
          ) VALUES (?, ?, ?, ?, 1, ?, 'test:gc', 0, '[]', NULL,
            X'01', ?, 1, 'unsafe_stale_update', '[]', 'pending', ?, ?)`,
        )
        .run(
          "recovery:gc-evidence",
          projectId,
          storeEpoch,
          "document:gc-evidence",
          "update:gc-evidence",
          hash,
          now,
          "2099-01-01T00:00:00.000Z",
        );
      const documentEvidence = candidateFrom(database, projectId, "gc:evidence-owner");
      expect(hasBlocker(documentEvidence, "retained_document_version")).toBe(true);
      expect(hasBlocker(documentEvidence, "pending_recovery_artifact")).toBe(true);

      seedBlock(database, { id: "gc:ledger", projectId });
      database
        .prepare(
          `INSERT INTO change_log (
            project_id, store_epoch, kind, operation_id, block_ids_json,
            document_ids_json, database_block_ids_json, payload_json, committed_at
          ) VALUES (?, ?, 'test', NULL, ?, '[]', '[]', '{}', ?)`,
        )
        .run(projectId, storeEpoch, JSON.stringify(["gc:ledger"]), now);
      database
        .prepare(
          `INSERT INTO block_mutations (
            mutation_id, project_id, store_epoch, mutation_kind, actor_json,
            client_session_id, request_hash, request_json,
            target_block_ids_json, affected_document_ids_json,
            affected_database_block_ids_json, field_intents_json,
            expected_revisions_json, outcome, result_json,
            committed_revisions_json, document_heads_json, change_log_seq, recorded_at
          ) VALUES (?, ?, ?, 'test', '{}', NULL, ?, '{}', ?, '[]', '[]', '[]',
            '{}', 'rejected', '{}', '{}', '{}', NULL, ?)`,
        )
        .run(
          "mutation:gc-ledger",
          projectId,
          storeEpoch,
          hash,
          JSON.stringify(["gc:ledger"]),
          now,
        );
      const ledger = candidateFrom(database, projectId, "gc:ledger");
      expect(hasBlocker(ledger, "retained_change_log")).toBe(true);
      expect(hasBlocker(ledger, "retained_block_mutation")).toBe(true);

      seedBlock(database, {
        id: "gc:database-card",
        projectId,
        type: "card",
      });
      const primary = database
        .prepare(
          `SELECT capability.block_id, view.id AS view_id
           FROM database_capabilities capability
           INNER JOIN database_views view
             ON view.database_block_id = capability.block_id
           WHERE capability.project_id = ? AND capability.is_primary = 1
             AND view.is_primary = 1 AND view.lifecycle = 'active'`,
        )
        .get(projectId) as { readonly block_id: string; readonly view_id: string };
      database
        .prepare(
          `INSERT INTO database_memberships (
            id, database_block_id, card_block_id, project_id,
            revision, created_at, removed_at
          ) VALUES (?, ?, ?, ?, 1, ?, NULL)`,
        )
        .run("membership:gc-card", primary.block_id, "gc:database-card", projectId, now);
      database
        .prepare(
          `INSERT INTO database_view_positions (
            view_id, block_id, project_id, group_key, rank_key,
            revision, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, 'gc', 1, ?, ?)`,
        )
        .run(primary.view_id, "gc:database-card", projectId, now, now);
      const session = database
        .prepare("SELECT id FROM project_sessions WHERE project_id = ? AND archived = 0 LIMIT 1")
        .get(projectId) as { readonly id: string };
      database
        .prepare(
          `INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title,
            config_json, state_key, state_json, "order", created_at, updated_at
          ) VALUES (?, ?, ?, 'right', 'card_stage', 'GC card', ?, 0, '{}', 99, ?, ?)`,
        )
        .run(
          "tab:gc-card",
          session.id,
          projectId,
          JSON.stringify({ projectId, cardId: "gc:database-card" }),
          now,
          now,
        );
      const databaseCard = candidateFrom(database, projectId, "gc:database-card");
      expect(hasBlocker(databaseCard, "active_database_membership")).toBe(true);
      expect(hasBlocker(databaseCard, "database_view_position")).toBe(true);
      expect(hasBlocker(databaseCard, "session_target")).toBe(true);
    });
  });

  sqliteTest("finds cross-Project live, migration, session, and historical references", async () => {
    await withDatabase((database, targetProjectId) => {
      const hostProject = createProject({ name: "Cross-Project GC host" });
      seedBlock(database, {
        id: "gc:cross-target",
        projectId: targetProjectId,
        type: "card",
      });
      seedOwnedDocument(database, {
        ownerBlockId: "gc:cross-host",
        projectId: hostProject.id,
        documentId: "document:gc-cross-host",
        lifecycle: "active",
      });
      seedBlock(database, {
        id: "gc:cross-source",
        projectId: hostProject.id,
        lifecycle: "active",
        documentId: "document:gc-cross-host",
      });
      seedBlockTreeProjection(database, {
        documentId: "document:gc-cross-host",
        blockIds: ["gc:cross-source"],
        references: [
          {
            kind: "block",
            sourceBlockId: "gc:cross-source",
            targetBlockId: "gc:cross-target",
          },
        ],
      });
      const now = new Date().toISOString();
      const hostSession = database
        .prepare("SELECT id FROM project_sessions WHERE project_id = ? AND archived = 0 LIMIT 1")
        .get(hostProject.id) as { readonly id: string };
      database
        .prepare(
          `INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title,
            config_json, state_key, state_json, "order", created_at, updated_at
          ) VALUES (?, ?, ?, 'right', 'card_stage', 'Cross target', ?, 0, '{}', 99, ?, ?)`,
        )
        .run(
          "tab:gc-cross-target",
          hostSession.id,
          hostProject.id,
          JSON.stringify({
            projectId: targetProjectId,
            cardId: "gc:cross-target",
          }),
          now,
          now,
        );
      const live = candidateFrom(database, targetProjectId, "gc:cross-target");
      expect(hasBlocker(live, "block_tree_reference")).toBe(true);
      expect(hasBlocker(live, "session_target")).toBe(true);

      seedBlock(database, {
        id: "gc:historical-target",
        projectId: targetProjectId,
        type: "card",
      });
      seedOwnedDocument(database, {
        ownerBlockId: "gc:history-host",
        projectId: hostProject.id,
        documentId: "document:gc-history-host",
        lifecycle: "active",
      });
      seedBlockTreeProjection(database, {
        documentId: "document:gc-history-host",
      });
      const detached = createCardDocumentGenesis({
        documentId: "document:gc-history-host",
        title: "Historical host",
        nfm: '<card-ref target-block="gc:historical-target" />',
        allocateBlockId: () => "gc:historical-source",
      });
      try {
        const fullUpdate = Y.encodeStateAsUpdate(detached.document);
        const stateVector = Y.encodeStateVector(detached.document);
        database
          .prepare(
            `INSERT INTO document_versions (
              version_id, document_id, project_id, generation, base_head_seq,
              schema_key, schema_version, cause, label, actor_json,
              full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
            ) VALUES (?, ?, ?, 1, 0, 'nodex.card', 1, 'test', NULL, '{}',
              ?, ?, ?, ?, ?)`,
          )
          .run(
            "version:gc-cross-history",
            "document:gc-history-host",
            hostProject.id,
            Buffer.from(fullUpdate),
            Buffer.from(stateVector),
            createHash("sha256").update(fullUpdate).digest("hex"),
            fullUpdate.byteLength,
            now,
          );
      } finally {
        detached.document.destroy();
      }
      const historical = candidateFrom(
        database,
        targetProjectId,
        "gc:historical-target",
      );
      expect(hasBlocker(historical, "block_tree_reference")).toBe(true);
      expect(
        historical.blockers.some((blocker) =>
          blocker.samples.some(
            (sample) => sample.source === "document_versions",
          ),
        ),
      ).toBe(true);
    });
  });
});
