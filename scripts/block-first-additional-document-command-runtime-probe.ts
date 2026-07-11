import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  parseAdditionalDocumentCommandRequest,
} from "../src/shared/additional-document-commands";
import {
  createDetachedCardDocumentFromBlockTree,
  type BlockTreeNode,
} from "../src/shared/block-documents/block-document-codec";
import { applyAdditionalDocumentCommand } from "../src/main/local-store/additional-document-command-kernel";
import { initializeBlockDocumentGenesis } from "../src/main/local-store/block-document-store";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

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

const readEpoch = (): string =>
  (
    getDb()
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string }
  ).store_epoch;

const seedHost = (
  projectId: string,
  cardId: string,
  documentId: string,
  blockTree: readonly BlockTreeNode[],
): void => {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
    `,
    )
    .run(cardId, projectId, now, now);
  getDb()
    .prepare(
      `INSERT INTO top_level_block_placements
       (block_id, project_id, rank_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(cardId, projectId, `probe:${cardId}`, now, now);
  getDb()
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
    .run(documentId, projectId, now, now);
  getDb()
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(cardId, documentId, projectId, now);
  const detached = createDetachedCardDocumentFromBlockTree({
    documentId,
    title: cardId,
    blockTree,
  });
  try {
    initializeBlockDocumentGenesis(getDb(), {
      documentId,
      storeEpoch: readEpoch(),
      generation: 1,
      updateId: `genesis:${documentId}`,
      clientSessionId: "probe:genesis",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
  } finally {
    detached.document.destroy();
  }
};

const command = (
  projectId: string,
  storeEpoch: string,
  operationId: string,
  operation: unknown,
  coordination: unknown = { kind: "fifo_only" },
) =>
  parseAdditionalDocumentCommandRequest({
    version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
    operationId,
    projectId,
    storeEpoch,
    clientSessionId: "probe:additional-document",
    actor: { kind: "native-probe" },
    coordination,
    operation,
  });

const lease = (
  leaseId: string,
  documents: readonly {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  }[],
) => ({ kind: "hub_lease", leaseId, documents });

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-additional-command-probe-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Additional command probe" });
    const storeEpoch = readEpoch();
    const anchor = getDb()
      .prepare(
        `
        SELECT block.id, block.location_revision
        FROM blocks block
        INNER JOIN top_level_block_placements placement
          ON placement.block_id = block.id
        WHERE block.project_id = ? AND block.lifecycle <> 'deleted'
        ORDER BY placement.rank_key, block.id
        LIMIT 1
      `,
      )
      .get(project.id) as {
      readonly id: string;
      readonly location_revision: number;
    };

    const createSyncedRequest = command(
      project.id,
      storeEpoch,
      "probe:create-synced",
      {
        kind: "create_synced_source",
        sourceBlockId: "probe:synced-library",
        documentId: "document:probe-synced-library",
        initialBlocks: [paragraph("probe:synced-library:body", "Library")],
        placement: {
          kind: "space",
          before: {
            blockId: anchor.id,
            expectedLocationRevision: anchor.location_revision,
          },
        },
      },
    );
    const createdSynced = applyAdditionalDocumentCommand(
      getDb(),
      createSyncedRequest,
    );
    invariant(createdSynced.ok, "create Synced source command failed");
    const syncedRetry = applyAdditionalDocumentCommand(getDb(), {
      ...createSyncedRequest,
      clientSessionId: "probe:lost-create-response",
      actor: { retry: true },
    });
    invariant(
      syncedRetry.ok &&
        syncedRetry.value.duplicate &&
        syncedRetry.value.semanticHash === createdSynced.value.semanticHash,
      "Synced source exact receipt retry failed",
    );
    const syncedCollision = applyAdditionalDocumentCommand(getDb(), {
      ...createSyncedRequest,
      operation: {
        ...createSyncedRequest.operation,
        initialBlocks: [paragraph("probe:synced-library:body", "Changed")],
      },
    });
    invariant(
      !syncedCollision.ok &&
        syncedCollision.error.code === "operation_id_collision",
      "Synced source operation identity collision was not rejected",
    );

    seedHost(
      project.id,
      "probe:sync-host",
      "document:probe-sync-host",
      [
        paragraph("probe:sync-root", "Root", [
          paragraph("probe:sync-child", "Child"),
        ]),
      ],
    );
    const promoted = applyAdditionalDocumentCommand(
      getDb(),
      command(
        project.id,
        storeEpoch,
        "probe:promote",
        {
          kind: "promote_synced_source",
          host: {
            documentId: "document:probe-sync-host",
            generation: 1,
            headSeq: 1,
          },
          rootBlockId: "probe:sync-root",
          referenceBlockId: "probe:sync-reference",
          sourceBlockId: "probe:sync-source",
          sourceDocumentId: "document:probe-sync-source",
        },
        lease("probe:lease-promote", [
          {
            documentId: "document:probe-sync-host",
            generation: 1,
            headSeq: 1,
          },
        ]),
      ),
    );
    invariant(promoted.ok, "Synced promotion command failed");
    const hostHead = promoted.value.effect.documentHeads.find(
      (head) => head.documentId === "document:probe-sync-host",
    );
    const sourceHead = promoted.value.effect.documentHeads.find(
      (head) => head.documentId === "document:probe-sync-source",
    );
    invariant(hostHead && sourceHead, "Synced promotion lost Document heads");
    invariant(
      promoted.value.effect.preservedBlockIds.join(",") ===
        "probe:sync-child,probe:sync-root",
      "Synced promotion did not preserve subtree identities",
    );
    const demoteRequest = command(
      project.id,
      storeEpoch,
      "probe:demote",
      {
        kind: "demote_synced_source",
        host: hostHead,
        source: sourceHead,
        referenceBlockId: "probe:sync-reference",
        sourceBlockId: "probe:sync-source",
      },
      lease("probe:lease-demote", [hostHead, sourceHead]),
    );
    const demoted = applyAdditionalDocumentCommand(getDb(), demoteRequest);
    invariant(
      demoted.ok &&
        demoted.value.effect.deletedBlockIds.join(",") ===
          "probe:sync-reference,probe:sync-source" &&
        demoted.value.effect.preservedBlockIds.join(",") ===
          "probe:sync-child,probe:sync-root",
      "Synced demotion identity effect is invalid",
    );
    const demoteReplay = applyAdditionalDocumentCommand(getDb(), {
      ...demoteRequest,
      coordination: { kind: "receipt_replay" },
      actor: { retry: true },
    });
    invariant(
      demoteReplay.ok && demoteReplay.value.duplicate,
      "Synced demotion receipt replay failed",
    );
    const demoteCollision = applyAdditionalDocumentCommand(getDb(), {
      ...demoteRequest,
      coordination: { kind: "receipt_replay" },
      operation: {
        ...demoteRequest.operation,
        referenceBlockId: "probe:different-reference",
      },
    });
    invariant(
      !demoteCollision.ok &&
        demoteCollision.error.code === "operation_id_collision",
      "Receipt replay wrapped different logical content",
    );

    seedHost(
      project.id,
      "probe:target",
      "document:probe-target",
      [paragraph("probe:target-anchor", "Target")],
    );
    const template = applyAdditionalDocumentCommand(
      getDb(),
      command(project.id, storeEpoch, "probe:template", {
        kind: "create_template",
        sourceBlockId: "probe:template-source",
        documentId: "document:probe-template",
        displayName: "Review",
        initialBlocks: [paragraph("probe:template-root", "Template")],
        placement: { kind: "space" },
      }),
    );
    invariant(template.ok, "Template source command failed");
    const instantiated = applyAdditionalDocumentCommand(
      getDb(),
      command(
        project.id,
        storeEpoch,
        "probe:instantiate",
        {
          kind: "instantiate_template",
          sourceBlockId: "probe:template-source",
          source: {
            documentId: "document:probe-template",
            generation: 1,
            headSeq: 1,
          },
          target: {
            documentId: "document:probe-target",
            generation: 1,
            headSeq: 1,
          },
        },
        lease("probe:lease-instantiate", [
          {
            documentId: "document:probe-template",
            generation: 1,
            headSeq: 1,
          },
          {
            documentId: "document:probe-target",
            generation: 1,
            headSeq: 1,
          },
        ]),
      ),
    );
    invariant(
      instantiated.ok &&
        instantiated.value.effect.preservedBlockIds[0] ===
          "probe:template-source" &&
        !instantiated.value.effect.createdBlockIds.includes(
          "probe:template-root",
        ) &&
        !instantiated.value.effect.createdBlockIds.includes("probe:target"),
      "Template instance identities were not freshly derived",
    );

    const largeDocument = applyAdditionalDocumentCommand(
      getDb(),
      command(
        project.id,
        storeEpoch,
        "probe:large-document",
        {
          kind: "create_large_document",
          blockId: "probe:large-owner",
          documentId: "document:probe-large",
          displayName: "Architecture",
          content: {
            kind: "large_document",
            initialBlocks: [paragraph("probe:large-body", "Large")],
          },
          location: {
            kind: "document",
            host: {
              documentId: "document:probe-target",
              generation: 1,
              headSeq: 2,
            },
          },
        },
        lease("probe:lease-large", [
          {
            documentId: "document:probe-target",
            generation: 1,
            headSeq: 2,
          },
        ]),
      ),
    );
    invariant(
      largeDocument.ok &&
        largeDocument.value.effect.createdBlockIds.join(",") ===
          "probe:large-body,probe:large-owner" &&
        largeDocument.value.effect.documentHeads.length === 2,
      "Large Document command receipt is invalid",
    );
    const largeCode = applyAdditionalDocumentCommand(
      getDb(),
      command(project.id, storeEpoch, "probe:large-code", {
        kind: "create_large_document",
        blockId: "probe:code-owner",
        documentId: "document:probe-code",
        displayName: "Worker",
        content: {
          kind: "large_code",
          language: "typescript",
          code: "export const ready = true;",
        },
        location: { kind: "space" },
      }),
    );
    invariant(largeCode.ok, "Large Code command failed");

    const staleAnchor = applyAdditionalDocumentCommand(
      getDb(),
      command(project.id, storeEpoch, "probe:stale-anchor", {
        kind: "create_synced_source",
        sourceBlockId: "probe:stale-source",
        documentId: "document:probe-stale",
        initialBlocks: [paragraph("probe:stale-body", "Stale")],
        placement: {
          kind: "space",
          before: {
            blockId: anchor.id,
            expectedLocationRevision: anchor.location_revision + 1,
          },
        },
      }),
    );
    const staleReceipt = getDb()
      .prepare(
        "SELECT outcome FROM block_mutations WHERE mutation_id = 'probe:stale-anchor'",
      )
      .get() as { readonly outcome: string } | undefined;
    invariant(
      !staleAnchor.ok &&
        staleAnchor.error.code === "block_revision_conflict" &&
        staleReceipt?.outcome === "rejected" &&
        !getDb()
          .prepare("SELECT 1 FROM blocks WHERE id = 'probe:stale-source'")
          .get(),
      "Stale top-level anchor was not durably rejected",
    );

    const missingReplay = applyAdditionalDocumentCommand(
      getDb(),
      command(
        project.id,
        storeEpoch,
        "probe:missing-replay",
        {
          kind: "instantiate_template",
          sourceBlockId: "probe:missing-template",
          source: {
            documentId: "document:missing-source",
            generation: 1,
            headSeq: 1,
          },
          target: {
            documentId: "document:missing-target",
            generation: 1,
            headSeq: 1,
          },
        },
        { kind: "receipt_replay" },
      ),
    );
    invariant(
      !missingReplay.ok &&
        missingReplay.error.code === "coordination_failed" &&
        !getDb()
          .prepare(
            "SELECT 1 FROM block_mutations WHERE mutation_id = 'probe:missing-replay'",
          )
          .get(),
      "Missing receipt replay executed or wrote authority",
    );

    const faultRequest = command(
      project.id,
      storeEpoch,
      "probe:fault",
      {
        kind: "create_template",
        sourceBlockId: "probe:fault-template",
        documentId: "document:probe-fault-template",
        displayName: "Fault",
        initialBlocks: [paragraph("probe:fault-body", "Rollback")],
        placement: { kind: "space" },
      },
    );
    const fault = applyAdditionalDocumentCommand(getDb(), faultRequest, {
      faultInjector: () => {
        throw new Error("native fault after nested domain mutation");
      },
    });
    invariant(
      !fault.ok &&
        fault.error.code === "unknown" &&
        fault.error.message ===
          "The additional Document command could not be committed" &&
        !getDb()
          .prepare("SELECT 1 FROM blocks WHERE id = 'probe:fault-template'")
          .get() &&
        !getDb()
          .prepare(
            "SELECT 1 FROM block_mutations WHERE mutation_id = 'probe:fault'",
          )
          .get(),
      "Adapter fault leaked details or retained partial authority",
    );
    const faultRolledBack =
      !fault.ok &&
      !getDb()
        .prepare("SELECT 1 FROM blocks WHERE id = 'probe:fault-template'")
        .get();
    invariant(
      applyAdditionalDocumentCommand(getDb(), faultRequest).ok,
      "Rolled-back operation identity could not be retried",
    );

    const gap = applyAdditionalDocumentCommand(
      getDb(),
      command(project.id, storeEpoch, "probe:canvas-gap", {
        kind: "create_canvas_owner",
        scope: "non_primary",
        blockId: "probe:secondary-canvas",
        documentId: "document:probe-secondary-canvas",
        displayName: "Sketch",
        placement: { kind: "space" },
      }),
    );
    invariant(
      !gap.ok &&
        gap.error.code === "capability_gap" &&
        !getDb()
          .prepare("SELECT 1 FROM blocks WHERE id = 'probe:secondary-canvas'")
          .get(),
      "Capability gap claimed success or changed authority",
    );

    const beforeRestart = getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM block_mutations WHERE project_id = ? AND outcome = 'committed'",
      )
      .get(project.id) as { readonly count: number };
    closeDatabase();
    await initializeDatabase();
    const afterRestart = getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM block_mutations WHERE project_id = ? AND outcome = 'committed'",
      )
      .get(project.id) as { readonly count: number };
    const foreignKeys = getDb().pragma("foreign_key_check") as readonly unknown[];

    process.stdout.write(
      `${JSON.stringify({
        createSynced: createdSynced.ok,
        exactRetry: syncedRetry.ok && syncedRetry.value.duplicate,
        collision: !syncedCollision.ok,
        promote: promoted.ok,
        demote: demoted.ok,
        stableIds:
          demoted.ok &&
          demoted.value.effect.preservedBlockIds.join(",") ===
            "probe:sync-child,probe:sync-root",
        receiptReplay: demoteReplay.ok && demoteReplay.value.duplicate,
        replayCollision: !demoteCollision.ok,
        createTemplate: template.ok,
        instantiate: instantiated.ok,
        largeDocument: largeDocument.ok,
        largeCode: largeCode.ok,
        staleAnchor: !staleAnchor.ok,
        durableRejection: staleReceipt?.outcome === "rejected",
        missingReplay: !missingReplay.ok,
        faultRollback: faultRolledBack,
        capabilityGap: !gap.ok,
        restart: beforeRestart.count === afterRestart.count,
        foreignKeys: foreignKeys.length === 0,
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
