import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createCardDocumentGenesis } from "../src/shared/block-documents/block-document-codec";
import {
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  createCanvasDocument,
  inspectCanvasDocument,
} from "../src/shared/block-documents";
import {
  collectBlockRetentionGc,
  planBlockRetentionGc,
  type BlockRetentionGcBlockerKind,
} from "../src/main/local-store/block-retention-gc";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import { persistCanvasSceneMaterialization } from "../src/main/local-store/canvas-scene-materializations";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const seedBlock = (input: {
  readonly id: string;
  readonly projectId: string;
  readonly type?: string;
  readonly lifecycle?: "active" | "archived" | "deleted";
  readonly documentId?: string;
  readonly updatedAt?: string;
}): void => {
  const now = input.updatedAt ?? new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
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

const seedOwnedCardDocument = (input: {
  readonly ownerBlockId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly lifecycle?: "active" | "archived" | "deleted";
}): void => {
  seedBlock({
    id: input.ownerBlockId,
    projectId: input.projectId,
    type: "card",
    lifecycle: input.lifecycle,
  });
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', '',
        'ready', 'ydoc_primary', NULL, ?, ?)`,
    )
    .run(input.documentId, input.projectId, now, now);
  getDb()
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.ownerBlockId, input.documentId, input.projectId, now);
};

const seedProjection = (input: {
  readonly documentId: string;
  readonly blockId?: string;
  readonly targetBlockId?: string;
}): void => {
  const blockTree = input.blockId
    ? [
        {
          id: input.blockId,
          type: "paragraph",
          props: {},
          content: [],
          children: [],
        },
      ]
    : [];
  const references =
    input.blockId && input.targetBlockId
      ? [
          {
            kind: "block",
            sourceBlockId: input.blockId,
            targetBlockId: input.targetBlockId,
          },
        ]
      : [];
  getDb()
    .prepare(
      `INSERT INTO document_materializations (
        document_id, generation, projected_seq, schema_version,
        title, nfm, plain_text, preview, block_tree_json,
        references_json, asset_refs_json, updated_at
      ) VALUES (?, 1, 0, 1, '', '', '', '', ?, ?, '[]', ?)`,
    )
    .run(
      input.documentId,
      JSON.stringify(blockTree),
      JSON.stringify(references),
      new Date().toISOString(),
    );
};

const blockers = (
  projectId: string,
  blockId: string,
): ReadonlySet<BlockRetentionGcBlockerKind> => {
  const candidate = planBlockRetentionGc(getDb(), {
    projectId,
    rootBlockIds: [blockId],
    policy: { retainNewestDeletedBlocks: 0 },
  }).candidates[0];
  invariant(candidate, `Missing GC candidate ${blockId}`);
  return new Set(candidate.blockers.map((blocker) => blocker.kind));
};

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-block-retention-gc-probe-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Block retention GC probe" });

    seedBlock({ id: "probe:clean", projectId: project.id });
    const clean = collectBlockRetentionGc(getDb(), {
      projectId: project.id,
      rootBlockIds: ["probe:clean"],
      policy: { retainNewestDeletedBlocks: 0 },
    });
    invariant(clean.status === "collected", "Clean tombstone was not collected");

    seedOwnedCardDocument({
      ownerBlockId: "probe:owner",
      projectId: project.id,
      documentId: "document:probe-owner",
    });
    seedBlock({
      id: "probe:child",
      projectId: project.id,
      documentId: "document:probe-owner",
    });
    const closure = collectBlockRetentionGc(getDb(), {
      projectId: project.id,
      rootBlockIds: ["probe:owner"],
      policy: { retainNewestDeletedBlocks: 0 },
    });
    invariant(
      closure.status === "collected" &&
        closure.deletedBlockIds.length === 2 &&
        closure.deletedDocumentIds.length === 1,
      "Owned Document closure was not collected in one transaction",
    );

    seedOwnedCardDocument({
      ownerBlockId: "probe:fault-owner",
      projectId: project.id,
      documentId: "document:probe-fault-owner",
    });
    seedBlock({
      id: "probe:fault-child",
      projectId: project.id,
      documentId: "document:probe-fault-owner",
    });
    const fault = collectBlockRetentionGc(
      getDb(),
      {
        projectId: project.id,
        rootBlockIds: ["probe:fault-owner"],
        policy: { retainNewestDeletedBlocks: 0 },
      },
      {
        faultInjector: (point) => {
          if (point === "after_block_delete") throw new Error("probe fault");
        },
      },
    );
    invariant(fault.status === "failed", "Injected GC fault did not fail");
    invariant(
      Boolean(
        getDb()
          .prepare("SELECT 1 FROM block_documents WHERE block_id = 'probe:fault-owner'")
          .get(),
      ) &&
        Boolean(
          getDb()
            .prepare("SELECT 1 FROM documents WHERE id = 'document:probe-fault-owner'")
            .get(),
        ) &&
        (
          getDb()
            .prepare(
              "SELECT COUNT(*) AS count FROM blocks WHERE id IN ('probe:fault-owner', 'probe:fault-child')",
            )
            .get() as { readonly count: number }
        ).count === 2,
      "Injected fault did not restore the complete old topology",
    );
    seedProjection({ documentId: "document:probe-fault-owner" });

    seedBlock({
      id: "probe:newest-old",
      projectId: project.id,
      updatedAt: "2099-01-01T00:00:00.000Z",
    });
    seedBlock({
      id: "probe:newest-new",
      projectId: project.id,
      updatedAt: "2099-01-02T00:00:00.000Z",
    });
    const countPlan = planBlockRetentionGc(getDb(), {
      projectId: project.id,
      rootBlockIds: ["probe:newest-old", "probe:newest-new"],
      policy: { retainNewestDeletedBlocks: 1 },
    });
    invariant(
      !countPlan.candidates[0]?.blockers.some(
        (blocker) => blocker.kind === "policy_newest_tombstone",
      ) &&
        countPlan.candidates[1]?.blockers.some(
          (blocker) => blocker.kind === "policy_newest_tombstone",
        ),
      "Newest-N policy did not retain only the newest tombstone",
    );

    const crossProject = createProject({ name: "GC cross-Project host" });
    seedBlock({ id: "probe:cross-target", projectId: project.id, type: "card" });
    seedOwnedCardDocument({
      ownerBlockId: "probe:cross-host",
      projectId: crossProject.id,
      documentId: "document:probe-cross-host",
      lifecycle: "active",
    });
    seedBlock({
      id: "probe:cross-source",
      projectId: crossProject.id,
      documentId: "document:probe-cross-host",
      lifecycle: "active",
    });
    seedProjection({
      documentId: "document:probe-cross-host",
      blockId: "probe:cross-source",
      targetBlockId: "probe:cross-target",
    });
    const crossLiveRoots = blockers(project.id, "probe:cross-target");
    invariant(
      crossLiveRoots.has("block_tree_reference"),
      "Cross-Project exact-head reference was not retained",
    );
    const now = new Date().toISOString();
    const hostSession = getDb()
      .prepare(
        "SELECT id FROM project_sessions WHERE project_id = ? AND archived = 0 LIMIT 1",
      )
      .get(crossProject.id) as { readonly id: string };
    getDb()
      .prepare(
        `INSERT INTO project_session_tabs (
          id, session_id, project_id, panel_id, kind, title,
          config_json, state_key, state_json, "order", created_at, updated_at
        ) VALUES (?, ?, ?, 'right', 'card_stage', 'Cross target', ?, 0, '{}', 99, ?, ?)`,
      )
      .run(
        "tab:probe-cross-target",
        hostSession.id,
        crossProject.id,
        JSON.stringify({
          projectId: project.id,
          cardId: "probe:cross-target",
        }),
        now,
        now,
      );
    const crossGlobalRoots = blockers(project.id, "probe:cross-target");
    invariant(
      crossGlobalRoots.has("block_tree_reference") &&
        crossGlobalRoots.has("session_target"),
      "Cross-Project content or session root was not retained",
    );

    seedBlock({
      id: "probe:canvas-target",
      projectId: crossProject.id,
      type: "card",
    });
    seedBlock({
      id: "probe:canvas-host",
      projectId: crossProject.id,
      type: CANVAS_BLOCK_TYPE,
      lifecycle: "active",
    });
    getDb()
      .prepare(
        `INSERT INTO documents (
          id, project_id, generation, head_seq, schema_key, schema_version,
          state_vector, state_hash, readiness, authority,
          genesis_source_revision, created_at, updated_at
        ) VALUES (?, ?, 1, 0, ?, ?, X'', '', 'ready', 'ydoc_primary', NULL, ?, ?)`,
      )
      .run(
        "document:probe-canvas-host",
        crossProject.id,
        CANVAS_DOCUMENT_SCHEMA_KEY,
        CANVAS_DOCUMENT_SCHEMA_VERSION,
        now,
        now,
      );
    getDb()
      .prepare(
        `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "probe:canvas-host",
        "document:probe-canvas-host",
        crossProject.id,
        now,
      );
    const canvas = createCanvasDocument({
      documentId: "document:probe-canvas-host",
      initialScene: {
        elements: [
          {
            id: "probe:canvas-element",
            type: "rectangle",
            version: 1,
            versionNonce: 1,
            isDeleted: false,
            index: "a0",
            customData: {
              type: "nodex-card-reference",
              targetBlockId: "probe:canvas-target",
            },
          },
        ],
        appState: {},
        files: {},
      },
    });
    try {
      const materialization = inspectCanvasDocument(canvas.document).materialization;
      persistCanvasSceneMaterialization(getDb(), {
        documentId: "document:probe-canvas-host",
        ownerBlockId: "probe:canvas-host",
        projectId: crossProject.id,
        generation: 1,
        projectedSeq: 0,
        materialization,
      });
      getDb()
        .prepare(
          `INSERT INTO canvas_card_references (
            document_id, source_element_id, target_block_id,
            owner_block_id, project_id, document_generation,
            projected_seq, title_hint, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, 0, NULL, ?)`,
        )
        .run(
          "document:probe-canvas-host",
          "probe:canvas-element",
          "probe:canvas-target",
          "probe:canvas-host",
          crossProject.id,
          now,
        );
    } finally {
      canvas.document.destroy();
    }
    invariant(
      blockers(crossProject.id, "probe:canvas-target").has(
        "canvas_card_reference",
      ),
      "Canvas Card reference was not retained",
    );

    seedBlock({ id: "probe:historical-target", projectId: project.id, type: "card" });
    seedOwnedCardDocument({
      ownerBlockId: "probe:history-host",
      projectId: crossProject.id,
      documentId: "document:probe-history-host",
      lifecycle: "active",
    });
    seedProjection({ documentId: "document:probe-history-host" });
    const detached = createCardDocumentGenesis({
      documentId: "document:probe-history-host",
      title: "History",
      nfm: '<card-ref target-block="probe:historical-target" />',
      allocateBlockId: () => "probe:historical-source",
    });
    try {
      const update = Y.encodeStateAsUpdate(detached.document);
      const stateVector = Y.encodeStateVector(detached.document);
      getDb()
        .prepare(
          `INSERT INTO document_versions (
            version_id, document_id, project_id, generation, base_head_seq,
            schema_key, schema_version, cause, label, actor_json,
            full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
          ) VALUES (?, ?, ?, 1, 0, 'nodex.card', 1, 'probe', NULL, '{}',
            ?, ?, ?, ?, ?)`,
        )
        .run(
          "version:probe-cross-history",
          "document:probe-history-host",
          crossProject.id,
          Buffer.from(update),
          Buffer.from(stateVector),
          createHash("sha256").update(update).digest("hex"),
          update.byteLength,
          new Date().toISOString(),
        );
    } finally {
      detached.document.destroy();
    }
    invariant(
      blockers(project.id, "probe:historical-target").has(
        "block_tree_reference",
      ),
      "Cross-Project retained historical reference was not found",
    );

    getDb().exec(`
      CREATE TABLE probe_future_gc_roots (
        block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE RESTRICT
      ) WITHOUT ROWID
    `);
    seedBlock({ id: "probe:future-root", projectId: project.id });
    seedBlock({ id: "probe:future-unlinked", projectId: project.id });
    getDb()
      .prepare("INSERT INTO probe_future_gc_roots (block_id) VALUES (?)")
      .run("probe:future-root");
    invariant(
      blockers(project.id, "probe:future-root").has(
        "unclassified_foreign_key_root",
      ) &&
        !blockers(project.id, "probe:future-unlinked").has(
          "unclassified_foreign_key_root",
        ),
      "Future inbound FK analysis was not candidate-specific",
    );

    seedBlock({
      id: "probe:missing-ownership",
      projectId: project.id,
      type: "card",
    });
    invariant(
      blockers(project.id, "probe:missing-ownership").has("ownership_corrupt"),
      "Document-bearing Block without ownership was not retained",
    );

    process.stdout.write(
      `${JSON.stringify({
        cleanCollected: true,
        ownedClosureCollected: true,
        faultRolledBack: true,
        countPolicyRetainedNewest: true,
        crossProjectLiveReferenceRetained: true,
        crossProjectMigrationAndSessionRetained: true,
        canvasReferenceRetained: true,
        crossProjectHistoricalReferenceRetained: true,
        unknownForeignKeyFailClosed: true,
        missingOwnershipFailClosed: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main();
