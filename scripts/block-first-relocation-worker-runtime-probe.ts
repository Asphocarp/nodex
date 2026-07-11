import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { BlockMutationWriter } from "../src/main/block-mutation-writer";
import {
  compactBlockDocument,
  initializeCardDocumentGenesis,
} from "../src/main/local-store/block-document-store";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import {
  createCardDocumentGenesis,
  materializeCardDocument,
} from "../src/shared/block-documents/block-document-codec";
import type { RelocationIntent } from "../src/shared/block-documents";
import type { BoardChangeEvent } from "../src/shared/ipc-api";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const seedPrimaryDocument = (input: {
  readonly projectId: string;
  readonly ownerBlockId: string;
  readonly nfm: string;
  readonly blockIds: readonly string[];
}): { readonly documentId: string; readonly headSeq: number } => {
  const database = getDb();
  const documentId = `document:${input.ownerBlockId}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
  `,
    )
    .run(input.ownerBlockId, input.projectId, now, now);
  database
    .prepare(
      `
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(
      input.ownerBlockId,
      input.projectId,
      `worker-probe:${input.ownerBlockId}`,
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
    .run(input.ownerBlockId, documentId, input.projectId, now);

  let index = 0;
  const genesis = createCardDocumentGenesis({
    documentId,
    title: input.ownerBlockId,
    nfm: input.nfm,
    allocateBlockId: () => {
      const blockId = input.blockIds[index];
      index += 1;
      invariant(blockId, `Missing Block identity for ${documentId}`);
      return blockId;
    },
  });
  try {
    invariant(
      index === input.blockIds.length,
      "Genesis identity count diverged",
    );
    const metadata = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const ack = initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch: metadata.store_epoch,
      generation: 1,
      updateId: `genesis:${input.ownerBlockId}`,
      clientSessionId: "relocation-worker-probe",
      update: genesis.update,
    });
    database
      .prepare("UPDATE documents SET authority = 'ydoc_primary' WHERE id = ?")
      .run(documentId);
    return { documentId, headSeq: ack.headSeq };
  } finally {
    genesis.document.destroy();
  }
};

const materializeSync = (documentId: string, update: Uint8Array): string => {
  const document = new Y.Doc({ guid: documentId });
  try {
    Y.applyUpdate(document, update, "worker-probe-sync");
    return materializeCardDocument(document).nfm;
  } finally {
    document.destroy();
  }
};

const run = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-relocation-worker-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;
  let writer: BlockMutationWriter | undefined;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Relocation worker probe" });
    const source = seedPrimaryDocument({
      projectId: project.id,
      ownerBlockId: "worker-relocation-source",
      nfm: "Move\n\tChild\nStay",
      blockIds: ["move", "child", "stay"],
    });
    const target = seedPrimaryDocument({
      projectId: project.id,
      ownerBlockId: "worker-relocation-target",
      nfm: "Target",
      blockIds: ["target"],
    });
    const storeEpoch = (
      getDb()
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    closeDatabase();

    const boardEvents: BoardChangeEvent[] = [];
    writer = new BlockMutationWriter({
      publishBoardEvent: (event) => boardEvents.push(event),
    });
    const sourceBefore = await writer.syncBlockDocument({
      documentId: source.documentId,
      clientSessionId: "source-before",
      stateVector: new Uint8Array([0]),
    });
    const targetBefore = await writer.syncBlockDocument({
      documentId: target.documentId,
      clientSessionId: "target-before",
      stateVector: new Uint8Array([0]),
    });
    invariant(
      sourceBefore.ok && targetBefore.ok,
      "Could not warm worker cache",
    );

    const sourceReplica = new Y.Doc({ guid: source.documentId });
    Y.applyUpdate(sourceReplica, sourceBefore.value.update, "prepare-probe");
    const sourceVector = Y.encodeStateVector(sourceReplica);
    sourceReplica.getText("title").insert(
      sourceReplica.getText("title").length,
      " flushed",
    );
    const flushed = await writer.applyBlockDocumentUpdate({
      documentId: source.documentId,
      storeEpoch,
      generation: sourceBefore.value.generation,
      updateId: "prepare-probe-flush",
      clientSessionId: "source-before",
      baseHeadSeq: sourceBefore.value.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(sourceReplica, sourceVector),
    });
    sourceReplica.destroy();
    invariant(flushed.ok, "Could not flush source before preparation");

    const intent: RelocationIntent = {
      relocationId: "worker-relocation",
      projectId: project.id,
      storeEpoch,
      rootBlockIds: ["move"],
      sourceDocumentId: source.documentId,
      sourceGeneration: sourceBefore.value.generation,
      target: {
        kind: "document",
        documentId: target.documentId,
        generation: targetBefore.value.generation,
      },
    };
    const beforeCommit = await writer.readCommittedRelocation(intent);
    invariant(
      beforeCommit.ok && beforeCommit.value === null,
      "Uncommitted intent unexpectedly had a durable result",
    );
    const prepared = await writer.prepareRelocationCommand(intent);
    invariant(prepared.ok, "Worker could not prepare relocation intent");
    const request = prepared.value;
    invariant(
      request.expectedSourceHeadSeq === flushed.value.headSeq &&
        request.target.kind === "document" &&
        request.target.expectedHeadSeq === targetBefore.value.headSeq &&
        request.expectedLocationRevisions.move === 1,
      "Preparation did not capture the latest flushed fence boundaries",
    );

    // All three requests are accepted synchronously. The worker's single FIFO
    // must commit relocation before either subsequent sync observes a head.
    const relocationPending = writer.relocateBlocks(request);
    const sourceAfterPending = writer.syncBlockDocument({
      documentId: source.documentId,
      clientSessionId: "source-after",
      stateVector: new Uint8Array([0]),
    });
    const targetAfterPending = writer.syncBlockDocument({
      documentId: target.documentId,
      clientSessionId: "target-after",
      stateVector: new Uint8Array([0]),
    });
    const relocation = await relocationPending;
    const [sourceAfter, targetAfter] = await Promise.all([
      sourceAfterPending,
      targetAfterPending,
    ]);
    invariant(relocation.ok, "Worker relocation failed");
    invariant(
      !relocation.value.duplicate,
      "First worker relocation was duplicate",
    );
    invariant(
      relocation.value.sourceCommit.update instanceof Uint8Array &&
        relocation.value.targetCommit?.update instanceof Uint8Array,
      "Worker structured clone did not preserve binary relocation updates",
    );
    invariant(
      sourceAfter.ok &&
        targetAfter.ok &&
        sourceAfter.value.headSeq === relocation.value.sourceCommit.headSeq &&
        targetAfter.value.headSeq === relocation.value.targetCommit?.headSeq,
      "Worker FIFO exposed a pre-relocation Document head",
    );
    invariant(
      materializeSync(source.documentId, sourceAfter.value.update) === "Stay",
      "Invalidated source cache served the old subtree",
    );
    invariant(
      materializeSync(target.documentId, targetAfter.value.update) ===
        "Target\nMove\n\tChild",
      "Invalidated target cache served the old subtree",
    );
    invariant(
      boardEvents.length === 0,
      "Projection-less Card shells unexpectedly emitted board events",
    );

    const stale = await writer.relocateBlocks({
      ...request,
      relocationId: "worker-relocation-stale",
    });
    invariant(
      !stale.ok &&
        stale.error.code === "source_head_mismatch" &&
        stale.error.reloadRequired &&
        !stale.error.retryable &&
        stale.error.relocationId === "worker-relocation-stale",
      "Worker did not preserve typed relocation reload semantics",
    );

    await writer.shutdown();
    writer = undefined;

    const restartedWriter = new BlockMutationWriter();
    writer = restartedWriter;
    const restartedLookup = await restartedWriter.readCommittedRelocation(
      intent,
    );
    invariant(
      restartedLookup.ok &&
        restartedLookup.value?.duplicate &&
        restartedLookup.value.sourceCommit.update instanceof Uint8Array,
      "Restarted worker did not recover the committed intent",
    );
    const collision = await restartedWriter.readCommittedRelocation({
      ...intent,
      target: { ...intent.target, beforeBlockId: "target" },
    });
    invariant(
      !collision.ok && collision.error.code === "relocation_id_collision",
      "Logical target mismatch did not produce a typed ID collision",
    );

    await restartedWriter.barrier();
    const database = new Database(getDatabasePath(), { readonly: false });
    database.pragma("foreign_keys = ON");
    try {
      compactBlockDocument(database, { documentId: source.documentId });
      compactBlockDocument(database, { documentId: target.documentId });
    } finally {
      database.close();
    }
    const duplicate = await restartedWriter.readCommittedRelocation(intent);
    if (!duplicate.ok || !duplicate.value) {
      throw new Error("Compacted worker replay did not return a result");
    }
    invariant(
      duplicate.value.duplicate &&
        duplicate.value.sourceCommit.update === null &&
        duplicate.value.targetCommit?.update === null,
      "Compacted worker replay did not return typed null updates",
    );
    const restartSync = await restartedWriter.syncBlockDocument({
      documentId: target.documentId,
      clientSessionId: "target-restart",
      stateVector: new Uint8Array([0]),
    });
    invariant(
      restartSync.ok &&
        materializeSync(target.documentId, restartSync.value.update) ===
          "Target\nMove\n\tChild",
      "Restarted writer did not load the committed relocation",
    );
    await restartedWriter.shutdown();
    writer = undefined;

    process.stdout.write(
      `${JSON.stringify({
        fifo: true,
        cacheInvalidation: true,
        binaryStructuredClone: true,
        compactedNullReplay: true,
        latestFlushedPreparation: true,
        restartIntentLookup: true,
        logicalCollision: true,
        typedStaleError: true,
        projectionFanoutBestEffort: true,
        restart: true,
      })}\n`,
    );
  } finally {
    if (writer) await writer.shutdown().catch(() => undefined);
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousNodexDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousNodexDir;
  }
};

void run();
