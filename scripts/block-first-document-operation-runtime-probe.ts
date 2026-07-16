import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  applyDocumentOperationBatch,
  replaceDocumentFromNfm,
  type ApplyDocumentOperationOptions,
  type DocumentOperationFaultPoint,
} from "../src/main/local-store/block-document-operations";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  initializePageDocumentGenesis,
  loadBlockDocument,
} from "../src/main/local-store/block-document-store";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import {
  createPageDocumentGenesis,
  type BlockTreeNode,
} from "../src/shared/block-documents/block-document-codec";
import { locateBlockContainer } from "../src/shared/block-documents/block-subtree-relocation";
import { createUuidV7FromTimestamp } from "../src/shared/uuid-v7";

function invariant(condition: boolean, message: string): asserts condition {
  if (condition) return;
  throw new Error(message);
}

const probeBlockId = (sequence: number): string =>
  createUuidV7FromTimestamp(1_784_000_000_000, sequence);

const blockIds = {
  alpha: probeBlockId(1),
  beta: probeBlockId(2),
  gamma: probeBlockId(3),
  inserted: probeBlockId(4),
  titleBody: probeBlockId(5),
  netZeroInserted: probeBlockId(6),
  updateTemplate: probeBlockId(7),
  nfmSameOne: probeBlockId(8),
  nfmSameTwo: probeBlockId(9),
  nfmTail: probeBlockId(10),
  classificationParent: probeBlockId(11),
  classificationChild: probeBlockId(12),
  epochScoped: probeBlockId(13),
} as const;

const readEpoch = (): string =>
  (
    getDb()
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string }
  ).store_epoch;

const seedPrimaryDocument = (input: {
  readonly projectId: string;
  readonly pageId: string;
  readonly title: string;
  readonly nfm: string;
  readonly blockIds: readonly string[];
}): { readonly documentId: string; readonly headSeq: number } => {
  const database = getDb();
  const documentId = `document:${input.pageId}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'page', 'active', 'space', NULL, 1, 1, ?, ?)
    `,
    )
    .run(input.pageId, input.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO top_level_block_placements (
        block_id, project_id, rank_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      input.pageId,
      input.projectId,
      `operation:${input.pageId}`,
      now,
      now,
    );
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.page', 2, X'', '',
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
    .run(input.pageId, documentId, input.projectId, now);

  let blockIndex = 0;
  const genesis = createPageDocumentGenesis({
    documentId,
    title: input.title,
    nfm: input.nfm,
    allocateBlockId: () => {
      const blockId = input.blockIds[blockIndex];
      blockIndex += 1;
      if (blockId) return blockId;
      throw new Error(`Missing Block ID for ${documentId}`);
    },
  });
  try {
    const ack = initializePageDocumentGenesis(database, {
      documentId,
      storeEpoch: readEpoch(),
      generation: 1,
      updateId: `genesis:${input.pageId}`,
      clientSessionId: "document-operation-probe",
      update: genesis.update,
      finalAuthority: "ydoc_primary",
    });
    return { documentId, headSeq: ack.headSeq };
  } finally {
    genesis.document.destroy();
  }
};

const readHead = (documentId: string): number =>
  (
    getDb()
      .prepare("SELECT head_seq FROM documents WHERE id = ?")
      .get(documentId) as { readonly head_seq: number }
  ).head_seq;

const readNfm = (documentId: string): string =>
  (
    getDb()
      .prepare(
        "SELECT nfm FROM document_materializations WHERE document_id = ?",
      )
      .get(documentId) as { readonly nfm: string }
  ).nfm;

const mutationBase = (input: {
  readonly mutationId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly expectedHeadSeq: number;
}) => ({
  version: 1 as const,
  mutationId: input.mutationId,
  projectId: input.projectId,
  storeEpoch: readEpoch(),
  clientSessionId: "document-operation-probe",
  actor: { kind: "runtime_probe", id: "bf07d" },
  documentId: input.documentId,
  generation: 1,
  expectedHeadSeq: input.expectedHeadSeq,
});

const writeFence = (
  documentId: string,
  headSeq: number,
): ApplyDocumentOperationOptions => ({
  writeFence: {
    leaseId: `probe-fence:${documentId}:${headSeq}`,
    documentId,
    generation: 1,
    headSeq,
  },
});

const countMutation = (mutationId: string): number =>
  (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
      )
      .get(mutationId) as { readonly count: number }
  ).count;

const persistHistoricalBarrierFixture = (input: {
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly documentId: string;
  readonly blockId: string;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
}): void => {
  const database = getDb();
  const committedAt = new Date().toISOString();
  const change = database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, 'block_mutation', ?, ?, ?, '[]', '{}', ?)
    `,
    )
    .run(
      input.projectId,
      input.storeEpoch,
      input.mutationId,
      JSON.stringify([input.blockId]),
      JSON.stringify([input.documentId]),
      committedAt,
    );
  const changeLogSeq = Number(change.lastInsertRowid);
  const documentHeads = JSON.stringify({
    [input.documentId]: { generation: 1, headSeq: input.headSeq },
  });
  const result = {
    version: 1,
    mutationKind: "document_operation_batch",
    mutationId: input.mutationId,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    documentId: input.documentId,
    generation: 1,
    baseHeadSeq: input.baseHeadSeq,
    headSeq: input.headSeq,
    touchedBlockIds: [input.blockId],
    createdBlockIds: [],
    deletedBlockIds: [],
    updatedBlockIds: [input.blockId],
    movedBlockIds: [],
    writeFenceBlockIds: [input.blockId],
    titleChanged: false,
    coordination: "write_fence",
    changeLogSeq,
    committedAt,
    duplicate: false,
  };
  database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      ) VALUES (?, ?, ?, 'document_operation_batch', '{}', NULL, ?, '{}', ?,
        ?, '[]', ?, ?, 'committed', ?, ?, ?, ?, ?)
    `,
    )
    .run(
      input.mutationId,
      input.projectId,
      input.storeEpoch,
      "0".repeat(64),
      JSON.stringify([input.blockId]),
      JSON.stringify([input.documentId]),
      JSON.stringify([
        { path: `document.blocks.${input.blockId}`, operation: "update" },
      ]),
      JSON.stringify({
        document: {
          documentId: input.documentId,
          generation: 1,
          headSeq: input.baseHeadSeq,
        },
      }),
      JSON.stringify(result),
      documentHeads,
      documentHeads,
      changeLogSeq,
      committedAt,
    );
};

const findFirstXmlText = (
  root: Y.XmlElement | Y.XmlFragment,
): Y.XmlText | null => {
  for (const child of root.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (!(child instanceof Y.XmlElement)) continue;
    const nested = findFirstXmlText(child);
    if (nested) return nested;
  }
  return null;
};

const createOfflineTextUpdate = (
  documentId: string,
  fullState: Uint8Array,
  blockId: string,
  suffix: string,
): Uint8Array => {
  const offline = new Y.Doc({ guid: documentId });
  try {
    Y.applyUpdate(offline, fullState);
    const baseStateVector = Y.encodeStateVector(offline);
    const location = locateBlockContainer(
      offline.getXmlFragment("body"),
      blockId,
    );
    const text = findFirstXmlText(location.container);
    invariant(text !== null, `Block ${blockId} has no editable text`);
    text.insert(text.length, suffix);
    return Y.encodeStateAsUpdate(offline, baseStateVector);
  } finally {
    offline.destroy();
  }
};

const run = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-document-operation-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Document operations" });
    const main = seedPrimaryDocument({
      projectId: project.id,
      pageId: "operation-main-card",
      title: "Before",
      nfm: "Alpha\nBeta\nGamma",
      blockIds: [blockIds.alpha, blockIds.beta, blockIds.gamma],
    });
    invariant(main.headSeq === 1, "main genesis head is not 1");

    const insertTemplate = createPageDocumentGenesis({
      documentId: "operation-insert-template",
      title: "",
      nfm: "Inserted",
      allocateBlockId: () => blockIds.inserted,
    });
    const insertedBlock = insertTemplate.materialization
      .blockTree[0] as BlockTreeNode;
    insertTemplate.document.destroy();
    const mergeRequest = {
      ...mutationBase({
        mutationId: "document-merge-friendly",
        projectId: project.id,
        documentId: main.documentId,
        expectedHeadSeq: 1,
      }),
      operations: [
        {
          kind: "insert_block" as const,
          block: insertedBlock,
          beforeBlockId: blockIds.beta,
        },
      ],
    };
    const merged = applyDocumentOperationBatch(getDb(), mergeRequest);
    invariant(merged.ok, "merge-friendly mutation failed");
    invariant(
      merged.value.headSeq === 2,
      "merge-friendly head did not advance",
    );
    invariant(
      merged.value.coordination === "merge_friendly" &&
        !merged.value.titleChanged &&
        merged.value.createdBlockIds.join(",") === blockIds.inserted,
      "merge-friendly semantic result is wrong",
    );

    closeDatabase();
    const duplicate = applyDocumentOperationBatch(getDb(), mergeRequest);
    invariant(
      duplicate.ok &&
        duplicate.value.duplicate &&
        duplicate.value.headSeq === 2,
      "exact restart retry did not return the original committed result",
    );
    const collision = applyDocumentOperationBatch(getDb(), {
      ...mergeRequest,
      operations: [{ kind: "set_title", title: "Collision" }],
    });
    invariant(
      !collision.ok && collision.error.code === "mutation_id_collision",
      "mutation ID collision was not typed",
    );

    const titleOnly = seedPrimaryDocument({
      projectId: project.id,
      pageId: "operation-title-card",
      title: "Before title",
      nfm: "Title body",
      blockIds: [blockIds.titleBody],
    });
    const titleRequest = {
      ...mutationBase({
        mutationId: "document-title-fence",
        projectId: project.id,
        documentId: titleOnly.documentId,
        expectedHeadSeq: 1,
      }),
      operations: [{ kind: "set_title" as const, title: "After title" }],
    };
    const unfencedTitle = applyDocumentOperationBatch(getDb(), titleRequest);
    invariant(
      !unfencedTitle.ok &&
        unfencedTitle.error.code === "write_fence_required" &&
        readHead(titleOnly.documentId) === 1 &&
        countMutation(titleRequest.mutationId) === 0,
      "whole-title replacement bypassed the write fence",
    );
    const fencedTitle = applyDocumentOperationBatch(
      getDb(),
      titleRequest,
      writeFence(titleOnly.documentId, 1),
    );
    invariant(
      fencedTitle.ok &&
        fencedTitle.value.titleChanged &&
        fencedTitle.value.coordination === "write_fence" &&
        fencedTitle.value.writeFenceBlockIds.join(",") ===
          "operation-title-card",
      "title fence did not record its owner Card identity",
    );
    closeDatabase();
    const crossSessionRetry = applyDocumentOperationBatch(getDb(), {
      ...titleRequest,
      clientSessionId: "replacement-window",
      actor: { kind: "browser_retry", id: "bf07d" },
    });
    invariant(
      crossSessionRetry.ok &&
        crossSessionRetry.value.duplicate &&
        crossSessionRetry.value.headSeq === 2,
      "cross-session exact retry did not recover the first durable outcome",
    );
    const netZeroTemplate = createPageDocumentGenesis({
      documentId: "operation-net-zero-template",
      title: "",
      nfm: "Net zero insert",
      allocateBlockId: () => blockIds.netZeroInserted,
    });
    const netZeroInserted = netZeroTemplate.materialization
      .blockTree[0] as BlockTreeNode;
    netZeroTemplate.document.destroy();
    const netZeroTitleRequest = {
      ...mutationBase({
        mutationId: "document-net-zero-title-fence",
        projectId: project.id,
        documentId: titleOnly.documentId,
        expectedHeadSeq: 2,
      }),
      operations: [
        { kind: "set_title" as const, title: "Transient title" },
        { kind: "set_title" as const, title: "After title" },
        { kind: "insert_block" as const, block: netZeroInserted },
      ],
    };
    const unfencedNetZeroTitle = applyDocumentOperationBatch(
      getDb(),
      netZeroTitleRequest,
    );
    invariant(
      !unfencedNetZeroTitle.ok &&
        unfencedNetZeroTitle.error.code === "write_fence_required",
      "net-zero title struct replacement bypassed the write fence",
    );
    const fencedNetZeroTitle = applyDocumentOperationBatch(
      getDb(),
      netZeroTitleRequest,
      writeFence(titleOnly.documentId, 2),
    );
    invariant(
      fencedNetZeroTitle.ok &&
        !fencedNetZeroTitle.value.titleChanged &&
        fencedNetZeroTitle.value.coordination === "write_fence" &&
        fencedNetZeroTitle.value.createdBlockIds.join(",") ===
          blockIds.netZeroInserted &&
        fencedNetZeroTitle.value.writeFenceBlockIds.join(",") ===
          "operation-title-card",
      "net-zero title rewrite lost its structural barrier",
    );

    const offlineBase = loadBlockDocument(getDb(), main.documentId);
    const offlineFullState = Y.encodeStateAsUpdate(offlineBase.document);
    offlineBase.document.destroy();
    const offlineUpdates = {
      replaced: createOfflineTextUpdate(
        main.documentId,
        offlineFullState,
        blockIds.alpha,
        " offline-replaced",
      ),
      deleted: createOfflineTextUpdate(
        main.documentId,
        offlineFullState,
        blockIds.beta,
        " offline-deleted",
      ),
      moved: createOfflineTextUpdate(
        main.documentId,
        offlineFullState,
        blockIds.gamma,
        " offline-moved",
      ),
      unaffected: createOfflineTextUpdate(
        main.documentId,
        offlineFullState,
        blockIds.inserted,
        " offline-safe",
      ),
    };

    const updateTemplate = createPageDocumentGenesis({
      documentId: "operation-update-template",
      title: "",
      nfm: "Alpha updated",
      allocateBlockId: () => blockIds.updateTemplate,
    });
    const updatedBlock = updateTemplate.materialization
      .blockTree[0] as BlockTreeNode;
    updateTemplate.document.destroy();
    const destructiveRequest = {
      ...mutationBase({
        mutationId: "document-destructive",
        projectId: project.id,
        documentId: main.documentId,
        expectedHeadSeq: 2,
      }),
      operations: [
        {
          kind: "update_block" as const,
          blockId: blockIds.alpha,
          patch: {
            type: updatedBlock.type,
            props: updatedBlock.props,
            content: updatedBlock.content ?? [],
          },
        },
        {
          kind: "move_block" as const,
          blockId: blockIds.gamma,
          parentBlockId: blockIds.alpha,
        },
        { kind: "delete_block" as const, blockId: blockIds.beta },
      ],
    };
    const unfenced = applyDocumentOperationBatch(getDb(), destructiveRequest);
    invariant(
      !unfenced.ok &&
        unfenced.error.code === "write_fence_required" &&
        unfenced.error.retryable,
      "destructive mutation did not require a trusted write fence",
    );
    invariant(
      countMutation(destructiveRequest.mutationId) === 0 &&
        readHead(main.documentId) === 2,
      "missing fence produced durable evidence",
    );
    const destructive = applyDocumentOperationBatch(
      getDb(),
      destructiveRequest,
      writeFence(main.documentId, 2),
    );
    invariant(destructive.ok, "fenced destructive mutation failed");
    invariant(
      destructive.value.coordination === "write_fence" &&
        destructive.value.deletedBlockIds.includes(blockIds.beta) &&
        destructive.value.updatedBlockIds.includes(blockIds.alpha) &&
        destructive.value.movedBlockIds.includes(blockIds.gamma) &&
        destructive.value.writeFenceBlockIds.join(",") ===
          [blockIds.alpha, blockIds.beta, blockIds.gamma].join(","),
      "destructive semantic change set is incomplete",
    );
    invariant(
      readNfm(main.documentId) === "Alpha updated\n\tGamma\nInserted",
      "destructive batch did not commit all operations",
    );

    const tombstoneReuse = applyDocumentOperationBatch(getDb(), {
      ...mutationBase({
        mutationId: "document-tombstone-reuse",
        projectId: project.id,
        documentId: main.documentId,
        expectedHeadSeq: 3,
      }),
      operations: [
        {
          kind: "insert_block",
          block: { ...insertedBlock, id: blockIds.beta },
        },
      ],
    });
    invariant(
      !tombstoneReuse.ok &&
        tombstoneReuse.error.code === "duplicate_block_id" &&
        readHead(main.documentId) === 3,
      "ordinary insert reused a tombstoned identity",
    );

    const rollbackFaultPoints: readonly DocumentOperationFaultPoint[] = [
      "after_update_prepared",
      "after_document_update",
      "after_change_log",
      "after_ledger",
      "before_commit",
    ];
    let rollbackHead = 3;
    for (const [index, faultPoint] of rollbackFaultPoints.entries()) {
      const faultRequest = {
        ...mutationBase({
          mutationId: `document-fault-rollback-${faultPoint}`,
          projectId: project.id,
          documentId: main.documentId,
          expectedHeadSeq: rollbackHead,
        }),
        operations: [
          {
            kind: "set_title" as const,
            title: `Fault recovered ${index + 1}`,
          },
        ],
      };
      let faultInjected = false;
      try {
        applyDocumentOperationBatch(getDb(), faultRequest, {
          ...writeFence(main.documentId, rollbackHead),
          faultInjector: (point) => {
            if (point !== faultPoint) return;
            throw new Error(`injected ${faultPoint}`);
          },
        });
      } catch {
        faultInjected = true;
      }
      invariant(
        faultInjected &&
          readHead(main.documentId) === rollbackHead &&
          countMutation(faultRequest.mutationId) === 0,
        `${faultPoint} did not roll back the authoritative mutation`,
      );
      const recovered = applyDocumentOperationBatch(
        getDb(),
        faultRequest,
        writeFence(main.documentId, rollbackHead),
      );
      rollbackHead += 1;
      invariant(
        recovered.ok && recovered.value.headSeq === rollbackHead,
        `${faultPoint} mutation could not retry after rollback`,
      );
    }

    const lostResponseRequest = {
      ...mutationBase({
        mutationId: "document-lost-response",
        projectId: project.id,
        documentId: main.documentId,
        expectedHeadSeq: rollbackHead,
      }),
      operations: [{ kind: "set_title" as const, title: "Lost response" }],
    };
    let responseLost = false;
    try {
      applyDocumentOperationBatch(getDb(), lostResponseRequest, {
        ...writeFence(main.documentId, rollbackHead),
        faultInjector: (point) => {
          if (point !== "after_commit") return;
          throw new Error("injected lost response");
        },
      });
    } catch {
      responseLost = true;
    }
    const recoveredResponse = applyDocumentOperationBatch(
      getDb(),
      lostResponseRequest,
    );
    invariant(
      responseLost &&
        recoveredResponse.ok &&
        recoveredResponse.value.duplicate &&
        recoveredResponse.value.headSeq === rollbackHead + 1,
      "lost response retry was not exactly idempotent",
    );

    const applyOfflineUpdate = (
      updateId: string,
      update: Uint8Array,
    ): { readonly code: string; readonly artifactId: string } => {
      try {
        applyBlockDocumentUpdate(getDb(), {
          documentId: main.documentId,
          storeEpoch: readEpoch(),
          generation: 1,
          updateId,
          clientSessionId: "offline-document-operation-probe",
          baseHeadSeq: 2,
          touchedBlockIds: [],
          update,
        });
        return { code: "acked", artifactId: "" };
      } catch (error) {
        if (!(error instanceof BlockDocumentStoreError)) throw error;
        return {
          code: error.code,
          artifactId: error.recoveryArtifactId ?? "",
        };
      }
    };
    const replacedRecovery = applyOfflineUpdate(
      "offline-crosses-replaced-block",
      offlineUpdates.replaced,
    );
    const deletedRecovery = applyOfflineUpdate(
      "offline-crosses-deleted-block",
      offlineUpdates.deleted,
    );
    const movedRecovery = applyOfflineUpdate(
      "offline-crosses-moved-block",
      offlineUpdates.moved,
    );
    invariant(
      [replacedRecovery, deletedRecovery, movedRecovery].every(
        (outcome) =>
          outcome.code === "recovery_required" &&
          outcome.artifactId.startsWith("document-recovery:"),
      ) && readHead(main.documentId) === rollbackHead + 1,
      "stale updates crossing a write-fence mutation were silently acknowledged",
    );
    const repeatedRecovery = applyOfflineUpdate(
      "offline-crosses-replaced-block",
      offlineUpdates.replaced,
    );
    invariant(
      repeatedRecovery.artifactId === replacedRecovery.artifactId,
      "recovery artifact retry did not return stable evidence",
    );
    const safeOfflineAck = applyBlockDocumentUpdate(getDb(), {
      documentId: main.documentId,
      storeEpoch: readEpoch(),
      generation: 1,
      updateId: "offline-crosses-unaffected-block",
      clientSessionId: "offline-document-operation-probe",
      baseHeadSeq: 2,
      touchedBlockIds: [],
      update: offlineUpdates.unaffected,
    });
    invariant(
      safeOfflineAck.headSeq === rollbackHead + 2 &&
        readNfm(main.documentId) ===
          "Alpha updated\n\tGamma\nInserted offline-safe",
      "stale update to an unaffected Block did not converge",
    );

    const nfm = seedPrimaryDocument({
      projectId: project.id,
      pageId: "operation-nfm-card",
      title: "NFM title",
      nfm: "Same\nSame\nTail",
      blockIds: [blockIds.nfmSameOne, blockIds.nfmSameTwo, blockIds.nfmTail],
    });
    const staleNfm = replaceDocumentFromNfm(getDb(), {
      ...mutationBase({
        mutationId: "document-nfm-stale",
        projectId: project.id,
        documentId: nfm.documentId,
        expectedHeadSeq: 0,
      }),
      nfm: "Same revised\nSame\nTail",
    });
    invariant(
      !staleNfm.ok && staleNfm.error.code === "document_head_conflict",
      "stale NFM replacement did not return a typed CAS conflict",
    );
    const nfmRequest = {
      ...mutationBase({
        mutationId: "document-nfm-replace",
        projectId: project.id,
        documentId: nfm.documentId,
        expectedHeadSeq: 1,
      }),
      nfm: "Same revised\nSame\nTail",
    };
    const unfencedNfm = replaceDocumentFromNfm(getDb(), nfmRequest);
    invariant(
      !unfencedNfm.ok && unfencedNfm.error.code === "write_fence_required",
      "NFM replacement bypassed the write fence",
    );
    const replaced = replaceDocumentFromNfm(
      getDb(),
      nfmRequest,
      writeFence(nfm.documentId, 1),
    );
    invariant(replaced.ok, "fenced NFM replacement failed");
    invariant(
      replaced.value.createdBlockIds.length === 2 &&
        replaced.value.deletedBlockIds.includes(blockIds.nfmSameOne) &&
        replaced.value.deletedBlockIds.includes(blockIds.nfmSameTwo) &&
        !replaced.value.deletedBlockIds.includes(blockIds.nfmTail) &&
        readNfm(nfm.documentId) === "Same revised\nSame\nTail",
      "ambiguous NFM identity replacement was not conservative",
    );

    const classification = seedPrimaryDocument({
      projectId: project.id,
      pageId: "operation-classification-card",
      title: "Classification",
      nfm: "Parent",
      blockIds: [blockIds.classificationParent],
    });
    const classificationTemplate = createPageDocumentGenesis({
      documentId: "operation-classification-template",
      title: "",
      nfm: "New child",
      allocateBlockId: () => blockIds.classificationChild,
    });
    const classificationBlock = classificationTemplate.materialization
      .blockTree[0] as BlockTreeNode;
    classificationTemplate.document.destroy();
    const insertedThenArranged = applyDocumentOperationBatch(getDb(), {
      ...mutationBase({
        mutationId: "document-insert-then-arrange",
        projectId: project.id,
        documentId: classification.documentId,
        expectedHeadSeq: 1,
      }),
      operations: [
        { kind: "insert_block", block: classificationBlock },
        {
          kind: "move_block",
          blockId: blockIds.classificationChild,
          parentBlockId: blockIds.classificationParent,
        },
      ],
    });
    invariant(
      insertedThenArranged.ok &&
        insertedThenArranged.value.coordination === "merge_friendly" &&
        insertedThenArranged.value.writeFenceBlockIds.length === 0 &&
        readNfm(classification.documentId) === "Parent\n\tNew child",
      "transient struct arrangement was misclassified as a durable write fence",
    );

    const epochScoped = seedPrimaryDocument({
      projectId: project.id,
      pageId: "operation-epoch-card",
      title: "Epoch",
      nfm: "Epoch body",
      blockIds: [blockIds.epochScoped],
    });
    const epochBase = loadBlockDocument(getDb(), epochScoped.documentId);
    const epochBaseState = Y.encodeStateAsUpdate(epochBase.document);
    epochBase.document.destroy();
    const oldEpoch = readEpoch();
    const currentEpochUpdate = createOfflineTextUpdate(
      epochScoped.documentId,
      epochBaseState,
      blockIds.epochScoped,
      " server",
    );
    const futureEpochUpdate = createOfflineTextUpdate(
      epochScoped.documentId,
      epochBaseState,
      blockIds.epochScoped,
      " client",
    );
    const currentEpochAck = applyBlockDocumentUpdate(getDb(), {
      documentId: epochScoped.documentId,
      storeEpoch: oldEpoch,
      generation: 1,
      updateId: "epoch-scoped-current-update",
      clientSessionId: "epoch-scoped-current-client",
      baseHeadSeq: 1,
      touchedBlockIds: [],
      update: currentEpochUpdate,
    });
    invariant(
      currentEpochAck.headSeq === 2,
      "epoch fixture did not reach head 2",
    );
    persistHistoricalBarrierFixture({
      mutationId: "historical-epoch-barrier",
      projectId: project.id,
      storeEpoch: oldEpoch,
      documentId: epochScoped.documentId,
      blockId: blockIds.epochScoped,
      baseHeadSeq: 1,
      headSeq: 2,
    });
    const restoredEpoch = `${oldEpoch}:restored`;
    getDb()
      .prepare(
        "UPDATE block_store_metadata SET store_epoch = ?, updated_at = ? WHERE id = 1",
      )
      .run(restoredEpoch, new Date().toISOString());
    const restoredEpochAck = applyBlockDocumentUpdate(getDb(), {
      documentId: epochScoped.documentId,
      storeEpoch: restoredEpoch,
      generation: 1,
      updateId: "epoch-scoped-restored-update",
      clientSessionId: "epoch-scoped-restored-client",
      baseHeadSeq: 1,
      touchedBlockIds: [],
      update: futureEpochUpdate,
    });
    const epochNfm = readNfm(epochScoped.documentId);
    invariant(
      restoredEpochAck.headSeq === 3 &&
        epochNfm.includes(" server") &&
        epochNfm.includes(" client"),
      "old-epoch mutation evidence formed a false structural barrier",
    );

    invariant(
      (getDb().pragma("foreign_key_check") as unknown[]).length === 0,
      "Document operation probe left foreign-key violations",
    );
    process.stdout.write(
      `${JSON.stringify({
        mergeFriendlyHead: merged.value.headSeq,
        exactRestartRetry: duplicate.value.duplicate,
        titleWriteFence: fencedTitle.value.coordination,
        crossSessionRetry: crossSessionRetry.value.duplicate,
        netZeroTitleWriteFence: fencedNetZeroTitle.value.coordination,
        destructiveFence: destructive.value.coordination,
        tombstoneReuseRejected: true,
        faultRollbacks: rollbackFaultPoints.length,
        lostResponseRetry: recoveredResponse.value.duplicate,
        staleStructuralRecoveries: 3,
        unaffectedOfflineHead: safeOfflineAck.headSeq,
        nfmCreated: replaced.value.createdBlockIds.length,
        transientArrangement: insertedThenArranged.value.coordination,
        epochScopedBarrier: true,
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
