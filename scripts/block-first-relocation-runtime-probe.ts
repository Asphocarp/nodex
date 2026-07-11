import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  compactBlockDocument,
  initializeCardDocumentGenesis,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import {
  BlockRelocationStoreError,
  relocateBlocksAtomically,
  type BlockRelocationFaultPoint,
} from "../src/main/local-store/block-relocations";
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
import {
  assertValidCardDocumentRoots,
  locateBlockContainer,
  type RelocateBlocks,
} from "../src/shared/block-documents";

const invariant = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const seedPrimaryDocument = (input: {
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly nfm: string;
  readonly blockIds: readonly string[];
}): { readonly documentId: string; readonly headSeq: number } => {
  const database = getDb();
  const documentId = `document:${input.cardBlockId}`;
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
      `probe:${input.cardBlockId}`,
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

  let blockIndex = 0;
  const genesis = createCardDocumentGenesis({
    documentId,
    title: input.cardBlockId,
    nfm: input.nfm,
    allocateBlockId: () => {
      const blockId = input.blockIds[blockIndex];
      blockIndex += 1;
      if (blockId) return blockId;
      throw new Error(`Missing Block ID for ${documentId}`);
    },
  });
  try {
    invariant(
      blockIndex === input.blockIds.length,
      `${documentId} did not consume its exact Block IDs`,
    );
    const epoch = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const ack = initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch: epoch.store_epoch,
      generation: 1,
      updateId: `genesis:${input.cardBlockId}`,
      clientSessionId: "relocation-probe",
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

const readEpoch = (): string =>
  (
    getDb()
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string }
  ).store_epoch;

const readHead = (documentId: string): number =>
  (
    getDb()
      .prepare("SELECT head_seq FROM documents WHERE id = ?")
      .get(documentId) as { readonly head_seq: number }
  ).head_seq;

const readLocation = (
  blockId: string,
): { readonly documentId: string | null; readonly revision: number } => {
  const row = getDb()
    .prepare(
      `
    SELECT containing_document_id, location_revision FROM blocks WHERE id = ?
  `,
    )
    .get(blockId) as {
    readonly containing_document_id: string | null;
    readonly location_revision: number;
  };
  return {
    documentId: row.containing_document_id,
    revision: row.location_revision,
  };
};

const readNfm = (documentId: string): string => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    return materializeCardDocument(loaded.document).nfm;
  } finally {
    loaded.document.destroy();
  }
};

const clonePrimaryDocument = (documentId: string): Y.Doc => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    const replica = new Y.Doc({ guid: documentId });
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(loaded.document));
    return replica;
  } finally {
    loaded.document.destroy();
  }
};

const readBlockText = (document: Y.Doc, blockId: string): Y.XmlText => {
  const body = assertValidCardDocumentRoots(document).body;
  const container = locateBlockContainer(body, blockId).container;
  for (const node of container.createTreeWalker(() => true)) {
    if (node instanceof Y.XmlText) return node;
  }
  throw new TypeError(`Block ${blockId} has no text node`);
};

const relocationInput = (input: {
  readonly relocationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly sourceDocumentId: string;
  readonly sourceHeadSeq: number;
  readonly targetDocumentId: string;
  readonly targetHeadSeq: number;
  readonly rootBlockIds: readonly string[];
  readonly beforeBlockId?: string;
  readonly parentBlockId?: string;
}): RelocateBlocks => ({
  relocationId: input.relocationId,
  projectId: input.projectId,
  storeEpoch: input.storeEpoch,
  rootBlockIds: input.rootBlockIds,
  sourceDocumentId: input.sourceDocumentId,
  sourceGeneration: 1,
  expectedSourceHeadSeq: input.sourceHeadSeq,
  expectedLocationRevisions: Object.fromEntries(
    input.rootBlockIds.map((blockId) => [blockId, 1]),
  ),
  target: {
    kind: "document",
    documentId: input.targetDocumentId,
    generation: 1,
    expectedHeadSeq: input.targetHeadSeq,
    ...(input.parentBlockId ? { parentBlockId: input.parentBlockId } : {}),
    ...(input.beforeBlockId ? { beforeBlockId: input.beforeBlockId } : {}),
  },
});

const run = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-block-relocation-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Atomic relocation probe" });
    const source = seedPrimaryDocument({
      projectId: project.id,
      cardBlockId: "relocation-source-card",
      nfm: ["A **bold**", "\tA child", "B", "C", "\tC child"].join("\n"),
      blockIds: ["a", "a-child", "b", "c", "c-child"],
    });
    const target = seedPrimaryDocument({
      projectId: project.id,
      cardBlockId: "relocation-target-card",
      nfm: ["Parent", "\tX", "\tY"].join("\n"),
      blockIds: ["parent", "x", "y"],
    });
    const offlineMovedReplica = clonePrimaryDocument(source.documentId);
    const offlineSafeReplica = clonePrimaryDocument(source.documentId);
    const offlineBaseVector = Y.encodeStateVector(offlineMovedReplica);
    const request = relocationInput({
      relocationId: "relocation-success",
      projectId: project.id,
      storeEpoch: readEpoch(),
      sourceDocumentId: source.documentId,
      sourceHeadSeq: source.headSeq,
      targetDocumentId: target.documentId,
      targetHeadSeq: target.headSeq,
      rootBlockIds: ["c", "a"],
      parentBlockId: "parent",
      beforeBlockId: "y",
    });
    const committed = relocateBlocksAtomically(getDb(), request);
    invariant(!committed.duplicate, "first relocation was reported duplicate");
    invariant(
      committed.rootBlockIds.join(",") === "a,c",
      "relocation did not canonicalize roots to source order",
    );
    invariant(
      committed.movedBlockIds.join(",") === "a,a-child,c,c-child",
      "relocation did not include the exact ordered forest",
    );
    invariant(
      readNfm(source.documentId) === "B",
      "source subtree was not deleted",
    );
    invariant(
      readNfm(target.documentId) ===
        [
          "Parent",
          "\tX",
          "\tA **bold**",
          "\t\tA child",
          "\tC",
          "\t\tC child",
          "\tY",
        ].join("\n"),
      "target subtree/order/formatting did not round-trip",
    );
    invariant(
      readLocation("a").documentId === target.documentId &&
        readLocation("a").revision === 2 &&
        readLocation("a-child").revision === 2,
      "registry identity/location revisions did not move with the subtree",
    );
    invariant(
      readHead(source.documentId) === source.headSeq + 1 &&
        readHead(target.documentId) === target.headSeq + 1,
      "relocation did not advance both heads exactly once",
    );

    closeDatabase();
    invariant(readNfm(source.documentId) === "B", "restart lost source state");
    const reversedRetry = relocateBlocksAtomically(getDb(), {
      ...request,
      rootBlockIds: ["a", "c"],
      expectedLocationRevisions: { a: 1, c: 1 },
    });
    invariant(
      reversedRetry.duplicate,
      "source-order-equivalent retry was not idempotent",
    );
    invariant(
      reversedRetry.sourceCommit.update instanceof Uint8Array,
      "uncompacted duplicate lost its source update",
    );
    compactBlockDocument(getDb(), { documentId: source.documentId });
    compactBlockDocument(getDb(), { documentId: target.documentId });
    const compactedRetry = relocateBlocksAtomically(getDb(), request);
    invariant(compactedRetry.duplicate, "compacted retry was not idempotent");
    invariant(
      compactedRetry.sourceCommit.update === null &&
        compactedRetry.targetCommit?.update === null,
      "compacted retry did not fall back to state-vector resync",
    );
    let collisionCode = "";
    try {
      relocateBlocksAtomically(getDb(), {
        ...request,
        target: { ...request.target, beforeBlockId: "x" },
      });
    } catch (error) {
      collisionCode =
        error instanceof BlockRelocationStoreError ? error.code : "";
    }
    invariant(
      collisionCode === "relocation_id_collision",
      "ID collision was not typed",
    );

    const movedText = readBlockText(offlineMovedReplica, "a");
    movedText.insert(movedText.length, " from offline source");
    const staleMovedUpdate = Y.encodeStateAsUpdate(
      offlineMovedReplica,
      offlineBaseVector,
    );
    let staleError: BlockDocumentStoreError | null = null;
    try {
      applyBlockDocumentUpdate(getDb(), {
        documentId: source.documentId,
        storeEpoch: readEpoch(),
        generation: 1,
        updateId: "stale-after-relocation:moved",
        clientSessionId: "offline-source-window",
        baseHeadSeq: source.headSeq,
        touchedBlockIds: [],
        update: staleMovedUpdate,
      });
    } catch (error) {
      if (error instanceof BlockDocumentStoreError) staleError = error;
      else throw error;
    }
    invariant(
      staleError?.code === "block_relocated" &&
        typeof staleError.recoveryArtifactId === "string",
      "stale moved-Block update did not produce a typed durable recovery artifact",
    );
    if (!staleError?.recoveryArtifactId) {
      throw new Error("stale moved-Block recovery artifact ID is missing");
    }
    invariant(
      readHead(source.documentId) === committed.sourceCommit.headSeq,
      "rejected stale moved-Block update advanced the source head",
    );
    const artifact = getDb()
      .prepare(
        `
          SELECT status, reason, update_id
          FROM document_recovery_artifacts
          WHERE id = ?
        `,
      )
      .get(staleError.recoveryArtifactId) as
      | {
          readonly status: string;
          readonly reason: string;
          readonly update_id: string;
        }
      | undefined;
    invariant(
      artifact?.status === "pending" &&
        artifact.reason === "block_relocated" &&
        artifact.update_id === "stale-after-relocation:moved",
      "stale moved-Block recovery artifact was not committed",
    );
    const staleReceipt = getDb()
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM document_update_receipts
          WHERE document_id = ? AND update_id = ?
        `,
      )
      .get(source.documentId, "stale-after-relocation:moved") as {
      readonly count: number;
    };
    invariant(
      staleReceipt.count === 0,
      "rejected stale update leaked into the ordinary durable update log",
    );

    const safeText = readBlockText(offlineSafeReplica, "b");
    safeText.insert(safeText.length, " still visible");
    const safeStaleUpdate = Y.encodeStateAsUpdate(
      offlineSafeReplica,
      offlineBaseVector,
    );
    const safeAck = applyBlockDocumentUpdate(getDb(), {
      documentId: source.documentId,
      storeEpoch: readEpoch(),
      generation: 1,
      updateId: "stale-after-relocation:safe",
      clientSessionId: "offline-source-window",
      baseHeadSeq: source.headSeq,
      touchedBlockIds: [],
      update: safeStaleUpdate,
    });
    invariant(
      safeAck.headSeq === committed.sourceCommit.headSeq + 1 &&
        readNfm(source.documentId) === "B still visible",
      "structurally visible stale update did not commit safely",
    );
    offlineMovedReplica.destroy();
    offlineSafeReplica.destroy();

    const faultSource = seedPrimaryDocument({
      projectId: project.id,
      cardBlockId: "fault-source-card",
      nfm: "Move me",
      blockIds: ["fault-root"],
    });
    const faultTarget = seedPrimaryDocument({
      projectId: project.id,
      cardBlockId: "fault-target-card",
      nfm: "Stay",
      blockIds: ["fault-stay"],
    });
    const preCommitFaults: readonly BlockRelocationFaultPoint[] = [
      "after_documents_loaded",
      "after_subtree_relocated",
      "after_indexes_deleted",
      "after_registry_moved",
      "after_source_commit",
      "after_target_commit",
      "after_materializations",
      "after_change_log",
      "after_ledger",
      "before_commit",
    ];
    for (const point of preCommitFaults) {
      const faultRequest = relocationInput({
        relocationId: `fault:${point}`,
        projectId: project.id,
        storeEpoch: readEpoch(),
        sourceDocumentId: faultSource.documentId,
        sourceHeadSeq: faultSource.headSeq,
        targetDocumentId: faultTarget.documentId,
        targetHeadSeq: faultTarget.headSeq,
        rootBlockIds: ["fault-root"],
      });
      let injected = false;
      try {
        relocateBlocksAtomically(getDb(), faultRequest, {
          faultInjector: (current) => {
            if (current !== point) return;
            throw new Error(`injected:${point}`);
          },
        });
      } catch (error) {
        injected =
          error instanceof Error && error.message === `injected:${point}`;
      }
      invariant(injected, `${point} fault was not observed`);
      invariant(
        readHead(faultSource.documentId) === faultSource.headSeq &&
          readHead(faultTarget.documentId) === faultTarget.headSeq &&
          readLocation("fault-root").documentId === faultSource.documentId &&
          readLocation("fault-root").revision === 1,
        `${point} exposed a partial relocation`,
      );
      const ledger = getDb()
        .prepare("SELECT COUNT(*) AS count FROM block_relocations WHERE id = ?")
        .get(faultRequest.relocationId) as { readonly count: number };
      invariant(ledger.count === 0, `${point} retained a rolled-back ledger`);
    }

    const afterCommitRequest = relocationInput({
      relocationId: "fault:after_commit",
      projectId: project.id,
      storeEpoch: readEpoch(),
      sourceDocumentId: faultSource.documentId,
      sourceHeadSeq: faultSource.headSeq,
      targetDocumentId: faultTarget.documentId,
      targetHeadSeq: faultTarget.headSeq,
      rootBlockIds: ["fault-root"],
    });
    let crashedAfterCommit = false;
    try {
      relocateBlocksAtomically(getDb(), afterCommitRequest, {
        faultInjector: (point) => {
          if (point !== "after_commit") return;
          throw new Error("injected:after_commit");
        },
      });
    } catch (error) {
      crashedAfterCommit =
        error instanceof Error && error.message === "injected:after_commit";
    }
    invariant(crashedAfterCommit, "after_commit crash was not observed");
    invariant(
      readHead(faultSource.documentId) === faultSource.headSeq + 1 &&
        readHead(faultTarget.documentId) === faultTarget.headSeq + 1 &&
        readLocation("fault-root").documentId === faultTarget.documentId,
      "after_commit crash did not leave the complete new state",
    );
    invariant(
      relocateBlocksAtomically(getDb(), afterCommitRequest).duplicate,
      "after_commit retry did not replay the committed result",
    );

    const integrity = getDb().pragma("foreign_key_check") as readonly unknown[];
    invariant(integrity.length === 0, "relocation left foreign-key violations");
    process.stdout.write(
      `${JSON.stringify({
        movedBlockIds: committed.movedBlockIds,
        preCommitFaults: preCommitFaults.length,
        compactedReplay: compactedRetry.sourceCommit.update === null,
        afterCommitReplay: true,
        staleRecoveryArtifact: artifact?.reason ?? null,
        safeStaleUpdate: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousNodexDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousNodexDir;
  }
};

void run();
