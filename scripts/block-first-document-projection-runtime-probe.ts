import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyLegacyShadowDocumentUpdate,
  compactBlockDocument,
  initializeCardDocumentGenesis,
  loadLegacyShadowBlockDocumentForMigration,
} from "../src/main/local-store/block-document-store";
import {
  listDocumentAssetRefs,
  rebuildDocumentSecondaryProjections,
  rebuildProjectDocumentSecondaryProjections,
  repairDocumentSecondaryProjections,
  searchDocumentBlockUnits,
} from "../src/main/local-store/block-document-projections";
import { relocateBlocksAtomically } from "../src/main/local-store/block-relocations";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import { createCardDocumentGenesis } from "../src/shared/block-documents/block-document-codec";
import { translateLegacyNfmIntoCardDocument } from "../src/shared/block-documents/legacy-nfm-shadow-translator";

function invariant(condition: boolean, message: string): asserts condition {
  if (condition) return;
  throw new Error(message);
}

interface SeededDocument {
  readonly documentId: string;
  readonly cardBlockId: string;
  readonly blockIds: readonly string[];
  readonly headSeq: number;
}

const readStoreEpoch = (): string =>
  (
    getDb()
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string }
  ).store_epoch;

const seedDocument = (input: {
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly title: string;
  readonly nfm: string;
}): SeededDocument => {
  const database = getDb();
  const documentId = `document:${input.cardBlockId}`;
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
    .run(input.cardBlockId, input.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO top_level_block_placements (
        block_id, project_id, rank_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      input.cardBlockId,
      input.projectId,
      `projection:${input.cardBlockId}`,
      now,
      now,
    );
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', '',
        'pending_genesis', 'legacy_shadow', ?, ?)
    `,
    )
    .run(documentId, input.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(input.cardBlockId, documentId, input.projectId, now);

  let nextBlock = 0;
  const genesis = createCardDocumentGenesis({
    documentId,
    title: input.title,
    nfm: input.nfm,
    allocateBlockId: () => `${input.cardBlockId}:block:${nextBlock++}`,
  });
  try {
    const ack = initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch: readStoreEpoch(),
      generation: 1,
      updateId: `genesis:${input.cardBlockId}`,
      clientSessionId: "document-projection-probe",
      update: genesis.update,
    });
    return {
      documentId,
      cardBlockId: input.cardBlockId,
      blockIds: genesis.materialization.blockTree.map((block) => block.id),
      headSeq: ack.headSeq,
    };
  } finally {
    genesis.document.destroy();
  }
};

const prepareLegacyUpdate = (input: {
  readonly documentId: string;
  readonly title: string;
  readonly nfm: string;
}): {
  readonly update: Uint8Array;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly storeEpoch: string;
} => {
  const loaded = loadLegacyShadowBlockDocumentForMigration(
    getDb(),
    input.documentId,
  );
  try {
    let nextBlock = 0;
    const translated = translateLegacyNfmIntoCardDocument({
      document: loaded.document,
      authority: loaded.authority,
      readiness: "ready",
      title: input.title,
      nfm: input.nfm,
      allocateBlockId: () => `${input.documentId}:translated:${nextBlock++}`,
    });
    invariant(translated.changed, "expected a changed legacy translation");
    return {
      update: translated.update,
      generation: loaded.head.generation,
      baseHeadSeq: loaded.head.headSeq,
      storeEpoch: loaded.storeEpoch,
    };
  } finally {
    loaded.document.destroy();
  }
};

const applyPreparedLegacyUpdate = (input: {
  readonly documentId: string;
  readonly updateId: string;
  readonly prepared: ReturnType<typeof prepareLegacyUpdate>;
}): void => {
  applyLegacyShadowDocumentUpdate(getDb(), {
    documentId: input.documentId,
    storeEpoch: input.prepared.storeEpoch,
    generation: input.prepared.generation,
    updateId: input.updateId,
    clientSessionId: "document-projection-probe",
    baseHeadSeq: input.prepared.baseHeadSeq,
    touchedBlockIds: [],
    update: input.prepared.update,
  });
};

const projectionSnapshot = (documentId: string): string => {
  const database = getDb();
  return JSON.stringify({
    search: database
      .prepare(
        `
        SELECT
          unit_key, project_id, block_id, owner_block_id, document_id,
          document_generation, projected_seq, source_revision,
          projection_version, source_kind, field_key, text, text_hash, updated_at
        FROM block_search_units
        WHERE document_id = ?
        ORDER BY source_kind, field_key, block_id
      `,
      )
      .all(documentId),
    assets: database
      .prepare(
        `
        SELECT
          document_id, block_id, owner_block_id, project_id,
          document_generation, projected_seq, projection_version,
          role, ordinal, asset_uri, asset_hash, updated_at
        FROM block_asset_refs
        WHERE document_id = ?
        ORDER BY block_id, role, ordinal
      `,
      )
      .all(documentId),
  });
};

const assertProjectionHead = (
  documentId: string,
  expectedSeq: number,
): void => {
  const rows = getDb()
    .prepare(
      `
      SELECT projected_seq FROM block_search_units WHERE document_id = ?
      UNION
      SELECT projected_seq FROM block_asset_refs WHERE document_id = ?
    `,
    )
    .all(documentId, documentId) as readonly {
    readonly projected_seq: number;
  }[];
  invariant(rows.length === 1, `${documentId} has mixed projection heads`);
  invariant(
    rows[0]?.projected_seq === expectedSeq,
    `${documentId} projection does not match head ${expectedSeq}`,
  );
};

const run = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-document-projection-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Document projections" });
    const document = seedDocument({
      projectId: project.id,
      cardBlockId: "projection-card",
      title: "OldTitleNeedle",
      nfm: [
        'OldBodyNeedle <attachment kind="file" mode="materialized" source="nodex://assets/old.txt" name="old.txt" mime="text/plain" bytes="1" />',
        '<image source="nodex://assets/old.png">OldCaptionNeedle</image>',
      ].join("\n"),
    });
    invariant(document.headSeq === 1, "genesis did not commit at head 1");
    const titleHits = searchDocumentBlockUnits(getDb(), {
      projectId: project.id,
      query: "OldTitleNeedle",
      documentId: document.documentId,
    });
    invariant(
      titleHits.length === 1 &&
        titleHits[0]?.blockId === document.cardBlockId &&
        titleHits[0]?.ownerBlockId === document.cardBlockId &&
        titleHits[0]?.sourceKind === "document_title",
      "genesis title was not searchable",
    );
    const bodyHits = searchDocumentBlockUnits(getDb(), {
      projectId: project.id,
      query: "OldBodyNeedle",
      documentId: document.documentId,
    });
    invariant(
      bodyHits.length === 1 &&
        bodyHits[0]?.blockId !== document.cardBlockId &&
        bodyHits[0]?.ownerBlockId === document.cardBlockId &&
        bodyHits[0]?.sourceKind === "document_block",
      "genesis body was not searchable",
    );
    invariant(
      listDocumentAssetRefs(getDb(), {
        projectId: project.id,
        documentId: document.documentId,
      }).length === 2,
      "genesis asset references were not projected",
    );

    const prepared = prepareLegacyUpdate({
      documentId: document.documentId,
      title: "NewTitleNeedle",
      nfm: [
        'NewBodyNeedle <attachment kind="file" mode="materialized" source="nodex://assets/new.txt" name="new.txt" mime="text/plain" bytes="2" />',
        '<image source="nodex://assets/new.png">NewCaptionNeedle</image>',
      ].join("\n"),
    });
    getDb().exec(`
      CREATE TRIGGER reject_document_projection_probe
      BEFORE INSERT ON block_search_units
      WHEN NEW.document_id = 'document:projection-card'
      BEGIN
        SELECT RAISE(ABORT, 'injected document projection failure');
      END;
    `);
    let projectionFailureRolledBack = false;
    try {
      applyPreparedLegacyUpdate({
        documentId: document.documentId,
        updateId: "projection-update",
        prepared,
      });
    } catch {
      const head = getDb()
        .prepare("SELECT head_seq FROM documents WHERE id = ?")
        .get(document.documentId) as { readonly head_seq: number };
      projectionFailureRolledBack = head.head_seq === 1;
    }
    getDb().exec("DROP TRIGGER reject_document_projection_probe");
    invariant(
      projectionFailureRolledBack,
      "projection failure did not roll back the authority commit",
    );
    invariant(
      searchDocumentBlockUnits(getDb(), {
        projectId: project.id,
        query: "OldBodyNeedle",
        documentId: document.documentId,
      }).length === 1,
      "failed projection replaced old searchable content",
    );

    applyPreparedLegacyUpdate({
      documentId: document.documentId,
      updateId: "projection-update",
      prepared,
    });
    for (const oldNeedle of ["OldTitleNeedle", "OldBodyNeedle"]) {
      invariant(
        searchDocumentBlockUnits(getDb(), {
          projectId: project.id,
          query: oldNeedle,
          documentId: document.documentId,
        }).length === 0,
        `${oldNeedle} survived projection replacement`,
      );
    }
    for (const newNeedle of ["NewTitleNeedle", "NewBodyNeedle"]) {
      invariant(
        searchDocumentBlockUnits(getDb(), {
          projectId: project.id,
          query: newNeedle,
          documentId: document.documentId,
        }).length === 1,
        `${newNeedle} was not immediately searchable`,
      );
    }
    const currentAssets = listDocumentAssetRefs(getDb(), {
      projectId: project.id,
      documentId: document.documentId,
    });
    invariant(
      currentAssets.length === 2 &&
        currentAssets.every((asset) => asset.assetUri.includes("new.")),
      "asset replacement retained stale URIs",
    );
    assertProjectionHead(document.documentId, 2);
    invariant(
      getDb()
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
        )
        .get() === undefined,
      "Document projection created or required a legacy Card row",
    );

    compactBlockDocument(getDb(), {
      documentId: document.documentId,
      expectedGeneration: 1,
      expectedHeadSeq: 2,
    });
    const beforeRebuild = projectionSnapshot(document.documentId);
    getDb()
      .prepare("DELETE FROM block_asset_refs WHERE document_id = ?")
      .run(document.documentId);
    getDb()
      .prepare("DELETE FROM block_search_units WHERE document_id = ?")
      .run(document.documentId);
    rebuildDocumentSecondaryProjections(getDb(), {
      documentId: document.documentId,
      expectedGeneration: 1,
      expectedProjectedSeq: 2,
    });
    invariant(
      projectionSnapshot(document.documentId) === beforeRebuild,
      "single-Document rebuild diverged after compaction",
    );

    const intrinsicHash = createHash("sha256")
      .update("intrinsic sentinel")
      .digest("hex");
    getDb()
      .prepare(
        `
        INSERT INTO block_search_units (
          unit_key, project_id, block_id, owner_block_id, document_id,
          document_generation, projected_seq, source_revision,
          source_kind, field_key, text, text_hash, updated_at
        ) VALUES (
          'intrinsic:projection-card:sentinel', ?, ?, ?, NULL,
          NULL, NULL, 1, 'intrinsic_property', 'sentinel',
          'intrinsic sentinel', ?, ?
        )
      `,
      )
      .run(
        project.id,
        document.cardBlockId,
        document.cardBlockId,
        intrinsicHash,
        new Date().toISOString(),
      );
    const expectedProjectDocumentCount = (
      getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM documents WHERE project_id = ? AND readiness = 'ready'",
        )
        .get(project.id) as { readonly count: number }
    ).count;
    const projectRebuild = rebuildProjectDocumentSecondaryProjections(
      getDb(),
      project.id,
    );
    invariant(
      projectRebuild.documentCount === expectedProjectDocumentCount,
      "project rebuild missed a Document",
    );
    invariant(
      getDb()
        .prepare(
          "SELECT 1 FROM block_search_units WHERE unit_key = 'intrinsic:projection-card:sentinel'",
        )
        .get() !== undefined,
      "Document rebuild deleted a non-Document search unit",
    );
    getDb()
      .prepare(
        `
        DELETE FROM block_search_units
        WHERE document_id = ? AND source_kind = 'document_title'
      `,
      )
      .run(document.documentId);
    const repair = repairDocumentSecondaryProjections(getDb());
    const idempotentRepair = repairDocumentSecondaryProjections(getDb());
    invariant(
      repair.repairedDocuments === 1 &&
        idempotentRepair.repairedDocuments === 0,
      "startup projection repair was not selective and idempotent",
    );

    closeDatabase();
    invariant(
      fs.existsSync(getDatabasePath()),
      "store vanished before restart",
    );
    invariant(
      searchDocumentBlockUnits(getDb(), {
        projectId: project.id,
        query: "NewBodyNeedle",
        documentId: document.documentId,
      }).length === 1,
      "restart lost the rebuilt FTS projection",
    );

    const relocationSource = seedDocument({
      projectId: project.id,
      cardBlockId: "projection-relocation-source",
      title: "Relocation source",
      nfm: "RelocationOldNeedle",
    });
    const relocationTarget = seedDocument({
      projectId: project.id,
      cardBlockId: "projection-relocation-target",
      title: "Relocation target",
      nfm: "TargetAnchorNeedle",
    });
    getDb()
      .prepare(
        "UPDATE documents SET authority = 'ydoc_primary' WHERE id IN (?, ?)",
      )
      .run(relocationSource.documentId, relocationTarget.documentId);
    const movingBlockId = relocationSource.blockIds[0];
    invariant(
      movingBlockId !== undefined,
      "relocation source has no root Block",
    );
    const location = getDb()
      .prepare("SELECT location_revision FROM blocks WHERE id = ?")
      .get(movingBlockId) as { readonly location_revision: number };
    const relocation = relocateBlocksAtomically(getDb(), {
      relocationId: "document-projection-relocation",
      projectId: project.id,
      storeEpoch: readStoreEpoch(),
      rootBlockIds: [movingBlockId],
      sourceDocumentId: relocationSource.documentId,
      sourceGeneration: 1,
      expectedSourceHeadSeq: 1,
      expectedLocationRevisions: {
        [movingBlockId]: location.location_revision,
      },
      target: {
        kind: "document",
        documentId: relocationTarget.documentId,
        generation: 1,
        expectedHeadSeq: 1,
      },
    });
    const targetCommit = relocation.targetCommit;
    invariant(
      relocation.sourceCommit.headSeq === 2 && targetCommit?.headSeq === 2,
      "relocation did not commit both Document heads",
    );
    invariant(
      searchDocumentBlockUnits(getDb(), {
        projectId: project.id,
        query: "RelocationOldNeedle",
        documentId: relocationSource.documentId,
      }).length === 0,
      "relocation source retained moved search content",
    );
    const targetHits = searchDocumentBlockUnits(getDb(), {
      projectId: project.id,
      query: "RelocationOldNeedle",
      documentId: relocationTarget.documentId,
    });
    invariant(
      targetHits.length === 1 && targetHits[0]?.blockId === movingBlockId,
      "relocation target did not receive moved Block search content",
    );
    assertProjectionHead(relocationSource.documentId, 2);
    assertProjectionHead(relocationTarget.documentId, 2);
    invariant(
      (getDb().pragma("foreign_key_check") as unknown[]).length === 0,
      "document projection probe left foreign-key violations",
    );

    process.stdout.write(
      `${JSON.stringify({
        authorityRollback: true,
        immediateSearch: true,
        oldTermsRemoved: true,
        assetsReplaced: true,
        compactionRebuildEquivalent: true,
        restartEquivalent: true,
        startupRepair: true,
        relocationHeads: [
          relocation.sourceCommit.headSeq,
          targetCommit.headSeq,
        ],
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousNodexDir === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousNodexDir;
    }
  }
};

void run();
