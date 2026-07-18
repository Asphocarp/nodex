import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  applyBlockDocumentUpdate,
  compactBlockDocument,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import { getOwnedBlockDocumentDescriptor } from "../src/main/local-store/block-document-cutover";
import { createPage } from "../src/main/local-store/database-pages";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import {
  createDocumentVersionCheckpoint,
  getDocumentVersionCheckpoint,
  listBlockChangeHistory,
  listDocumentVersions,
  prepareDocumentVersionRestore,
  previewDocumentVersion,
} from "../src/main/local-store/document-versions";
import {
  applyDocumentOperationBatch,
  replaceDocumentFromNfm,
  restoreDocumentVersion,
} from "../src/main/local-store/block-document-operations";
import { createProject } from "../src/main/local-store/projects";
import { openPageDocument } from "../src/shared/block-documents";
import { materializePageDocument } from "../src/shared/block-documents/block-document-codec";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../src/shared/block-documents/document-history";
import type {
  OwnedDocumentMaterialization,
  RegisteredOwnedDocumentMaterialization,
} from "../src/shared/block-documents/document-schema-adapters";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const requireBlockTreeMaterialization = (
  materialization: RegisteredOwnedDocumentMaterialization,
): OwnedDocumentMaterialization => {
  if (materialization.kind !== "canvas_scene") return materialization;
  throw new Error("Block-tree history probe received a Canvas materialization");
};

const readStoreEpoch = (): string => {
  const row = getDb()
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  invariant(row, "Block store metadata is missing");
  return row.store_epoch;
};

const findFirstXmlText = (
  root: Y.XmlFragment | Y.XmlElement,
): Y.XmlText | null => {
  for (const child of root.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (!(child instanceof Y.XmlElement)) continue;
    const nested = findFirstXmlText(child);
    if (nested) return nested;
  }
  return null;
};

const editPrimaryDocument = (
  documentId: string,
  updateId: string,
  title: string,
  body: string,
): number => {
  const database = getDb();
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    const before = Y.encodeStateVector(loaded.document);
    const envelope = openPageDocument(loaded.document);
    const bodyText = findFirstXmlText(envelope.body);
    invariant(bodyText, "Expected a text Block in the seeded Card");
    loaded.document.transact(() => {
      envelope.title.delete(0, envelope.title.length);
      envelope.title.insert(0, title);
      bodyText.delete(0, bodyText.length);
      bodyText.insert(0, body);
    }, "document-version-probe");
    return applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId,
      clientSessionId: "document-version-probe:window",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(loaded.document, before),
    }).headSeq;
  } finally {
    loaded.document.destroy();
  }
};

const countVersionRows = (documentId: string): number => {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS count FROM document_versions WHERE document_id = ?",
    )
    .get(documentId) as { readonly count: number };
  return row.count;
};

const countUpdatePayloads = (documentId: string): number => {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS count FROM document_updates WHERE document_id = ?",
    )
    .get(documentId) as { readonly count: number };
  return row.count;
};

const main = async (): Promise<void> => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-document-version-runtime-"),
  );
  process.env.NODEX_HOME = tempDir;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Document version runtime probe" });
    const card = await createPage(project.id, "triage", {
      title: "Checkpoint title",
      description: "Checkpoint body",
    });
    const descriptor = getOwnedBlockDocumentDescriptor(
      getDb(),
      project.id,
      card.id,
    );
    const storeEpoch = readStoreEpoch();
    const createRequest = {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch,
      documentId: descriptor.documentId,
      expectedGeneration: descriptor.generation,
      expectedHeadSeq: descriptor.headSeq,
      cause: "manual",
      label: "Before rewrite",
      actor: { kind: "runtime_probe" },
    } as const;
    const created = createDocumentVersionCheckpoint(getDb(), createRequest, {
      now: () => "2026-07-11T01:00:00.000Z",
    });
    invariant(!created.duplicate, "First checkpoint was reported as duplicate");
    const createdMaterialization = requireBlockTreeMaterialization(
      created.checkpoint.materialization,
    );
    invariant(
      created.checkpoint.title === "Checkpoint title" &&
        createdMaterialization.nfm === "Checkpoint body",
      "Checkpoint did not materialize exact current title/body",
    );
    const stableBlockIds = createdMaterialization.blockTree.map(
      (block) => block.id,
    );
    const duplicate = createDocumentVersionCheckpoint(getDb(), createRequest, {
      now: () => "2026-07-11T01:00:01.000Z",
    });
    invariant(
      duplicate.duplicate &&
        duplicate.checkpoint.versionId === created.checkpoint.versionId &&
        duplicate.checkpoint.createdAt === created.checkpoint.createdAt,
      "Exact checkpoint retry was not immutable and idempotent",
    );
    const sameHeadVersion = createDocumentVersionCheckpoint(
      getDb(),
      { ...createRequest, label: "Second label at the same head" },
      { now: () => "2026-07-11T01:00:02.000Z" },
    );
    invariant(
      !sameHeadVersion.duplicate &&
        sameHeadVersion.checkpoint.versionId !== created.checkpoint.versionId,
      "Distinct checkpoint metadata collapsed into one version identity",
    );

    let injectedFailureRolledBack = false;
    try {
      createDocumentVersionCheckpoint(
        getDb(),
        { ...createRequest, label: "Must roll back" },
        {
          faultInjector: (point) => {
            if (point === "after_insert") {
              throw new Error("injected document version failure");
            }
          },
        },
      );
    } catch (error) {
      injectedFailureRolledBack =
        error instanceof Error &&
        error.message === "injected document version failure";
    }
    invariant(
      injectedFailureRolledBack &&
        countVersionRows(descriptor.documentId) === 2,
      "Failed checkpoint left partial durable state",
    );

    const editedHead = editPrimaryDocument(
      descriptor.documentId,
      "document-version-probe:rewrite",
      "Changed title",
      "Changed body",
    );
    const lostResponseRetry = createDocumentVersionCheckpoint(
      getDb(),
      createRequest,
    );
    invariant(
      lostResponseRetry.duplicate &&
        lostResponseRetry.checkpoint.versionId === created.checkpoint.versionId,
      "Checkpoint retry after the Document advanced did not replay the durable result",
    );
    const listed = listDocumentVersions(getDb(), {
      projectId: project.id,
      documentId: descriptor.documentId,
    });
    const firstPage = listDocumentVersions(getDb(), {
      projectId: project.id,
      documentId: descriptor.documentId,
      limit: 1,
    });
    const firstCursor = firstPage[0];
    invariant(firstCursor, "Expected a first Document version page");
    const secondPage = listDocumentVersions(getDb(), {
      projectId: project.id,
      documentId: descriptor.documentId,
      before: {
        baseHeadSeq: firstCursor.baseHeadSeq,
        createdAt: firstCursor.createdAt,
        versionId: firstCursor.versionId,
      },
      limit: 1,
    });
    const preview = previewDocumentVersion(getDb(), {
      projectId: project.id,
      documentId: descriptor.documentId,
      versionId: created.checkpoint.versionId,
    });
    invariant(
      listed.length === 2 &&
        secondPage.length === 1 &&
        secondPage[0]?.versionId !== firstCursor.versionId &&
        preview.title === "Checkpoint title" &&
        preview.preview === "Checkpoint body",
      "List/preview did not decode the immutable checkpoint",
    );

    const restoreRequest = {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      mutationId: "document-version-probe:restore",
      projectId: project.id,
      storeEpoch,
      documentId: descriptor.documentId,
      versionId: created.checkpoint.versionId,
      generation: descriptor.generation,
      expectedHeadSeq: editedHead,
      clientSessionId: "document-version-probe:window",
      actor: { kind: "runtime_probe_restore" },
    } as const;
    const prepared = prepareDocumentVersionRestore(getDb(), restoreRequest);
    invariant(
      prepared.kind === "operation_plan" &&
        prepared.plan.contentModel === "block_tree" &&
        prepared.plan.requiresWriteFence &&
        prepared.plan.targetBlockTree.map((block) => block.id).join(",") ===
          stableBlockIds.join(","),
      "Restore did not prepare a stable-ID trusted-writer plan",
    );
    const writeFence = {
      leaseId: "document-version-probe:lease",
      documentId: descriptor.documentId,
      generation: descriptor.generation,
      headSeq: editedHead,
    } as const;
    const payloadsBeforeRestore = countUpdatePayloads(descriptor.documentId);
    const unfencedRestore = restoreDocumentVersion(getDb(), restoreRequest);
    invariant(
      !unfencedRestore.ok &&
        unfencedRestore.error.code === "write_fence_required" &&
        countVersionRows(descriptor.documentId) === 2,
      "Restore bypassed the coordinator fence or checkpointed before a lease",
    );
    let restoreFaultRolledBack = false;
    try {
      restoreDocumentVersion(
        getDb(),
        { ...restoreRequest, mutationId: "document-version-probe:fault-restore" },
        {
          writeFence,
          faultInjector: (point) => {
            if (point === "after_document_update") {
              throw new Error("injected restore transaction failure");
            }
          },
        },
      );
    } catch (error) {
      restoreFaultRolledBack =
        error instanceof Error &&
        error.message === "injected restore transaction failure";
    }
    invariant(
      restoreFaultRolledBack &&
        countVersionRows(descriptor.documentId) === 2 &&
        countUpdatePayloads(descriptor.documentId) === payloadsBeforeRestore,
      "Restore failure did not roll back its before_restore checkpoint and update",
    );
    const restored = restoreDocumentVersion(getDb(), restoreRequest, {
      writeFence,
    });
    invariant(restored.ok, "Restore operation batch did not commit");
    invariant(
      restored.value.baseHeadSeq === editedHead &&
        restored.value.headSeq === editedHead + 1 &&
        restored.value.coordination === "write_fence" &&
        countUpdatePayloads(descriptor.documentId) ===
          payloadsBeforeRestore + 1 &&
        countVersionRows(descriptor.documentId) === 4,
      "Restore rewound history instead of appending one forward update",
    );
    const restoreRetry = restoreDocumentVersion(getDb(), restoreRequest);
    invariant(
      restoreRetry.ok &&
        restoreRetry.value.duplicate &&
        restoreRetry.value.headSeq === restored.value.headSeq &&
        countVersionRows(descriptor.documentId) === 4,
      "Restore lost-response retry did not replay its exact durable receipt",
    );
    const restoredDocument = loadPrimaryBlockDocument(
      getDb(),
      descriptor.documentId,
    );
    try {
      const envelope = openPageDocument(restoredDocument.document);
      const bodyText = findFirstXmlText(envelope.body);
      invariant(
        envelope.title.toString() === "Checkpoint title" &&
          bodyText?.toString() === "Checkpoint body",
        "Forward restore did not reproduce checkpoint semantics",
      );
    } finally {
      restoredDocument.document.destroy();
    }
    const changes = listBlockChangeHistory(getDb(), {
      projectId: project.id,
      documentId: descriptor.documentId,
    });
    invariant(
      changes[0]?.operationId === "document-version-probe:restore" &&
        changes[0].kind === "block_mutation" &&
        changes[0].mutationKind === "document_version_restore",
      "Read-only Block change history did not join the immutable mutation ledger",
    );

    const compacted = compactBlockDocument(getDb(), {
      documentId: descriptor.documentId,
      expectedGeneration: descriptor.generation,
      expectedHeadSeq: restored.value.headSeq,
    });
    invariant(
      compacted.snapshotSeq === restored.value.headSeq &&
        countVersionRows(descriptor.documentId) === 4,
      "Compaction pruned an independent durable Document version",
    );
    closeDatabase();
    await initializeDatabase();
    const restarted = getDocumentVersionCheckpoint(getDb(), {
      projectId: project.id,
      documentId: descriptor.documentId,
      versionId: created.checkpoint.versionId,
    });
    const restartedMaterialization = requireBlockTreeMaterialization(
      restarted.materialization,
    );
    invariant(
      restarted.checkpointHash === created.checkpoint.checkpointHash &&
        restarted.materializationHash ===
          created.checkpoint.materializationHash &&
        restartedMaterialization.blockTree
          .map((block) => block.id)
          .join(",") === stableBlockIds.join(","),
      "Checkpoint did not survive restart and authority compaction",
    );
    const alreadyCurrent = prepareDocumentVersionRestore(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      mutationId: "document-version-probe:noop-restore",
      projectId: project.id,
      storeEpoch,
      documentId: descriptor.documentId,
      versionId: restarted.versionId,
      generation: descriptor.generation,
      expectedHeadSeq: restored.value.headSeq,
      actor: { kind: "runtime_probe_noop" },
    });
    invariant(
      alreadyCurrent.kind === "already_current",
      "Semantically current checkpoint produced another destructive restore",
    );

    const largeNfm = Array.from(
      { length: 520 },
      (_, index) => `Large restore paragraph ${index}`,
    ).join("\n\n");
    const largeCard = await createPage(project.id, "triage", {
      title: "Large restore",
      description: largeNfm,
    });
    const largeDescriptor = getOwnedBlockDocumentDescriptor(
      getDb(),
      project.id,
      largeCard.id,
    );
    const largeCheckpoint = createDocumentVersionCheckpoint(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch,
      documentId: largeDescriptor.documentId,
      expectedGeneration: largeDescriptor.generation,
      expectedHeadSeq: largeDescriptor.headSeq,
      cause: "manual",
      label: "Large history target",
      actor: { kind: "runtime_probe_large" },
    });
    invariant(
      largeCheckpoint.checkpoint.blockCount > 512,
      "Large checkpoint did not exceed the public operation batch limit",
    );
    const replacementRequest = {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      mutationId: "document-version-probe:large-replacement",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "document-version-probe:large-window",
      actor: { kind: "runtime_probe_large_replacement" },
      documentId: largeDescriptor.documentId,
      generation: largeDescriptor.generation,
      expectedHeadSeq: largeDescriptor.headSeq,
      nfm: "One replacement paragraph",
    } as const;
    const replacementFence = {
      leaseId: "document-version-probe:large-replacement-lease",
      documentId: largeDescriptor.documentId,
      generation: largeDescriptor.generation,
      headSeq: largeDescriptor.headSeq,
    } as const;
    const replacement = replaceDocumentFromNfm(
      getDb(),
      replacementRequest,
      { writeFence: replacementFence },
    );
    invariant(replacement.ok, "Large target replacement did not commit");
    const largeMaterialization = requireBlockTreeMaterialization(
      largeCheckpoint.checkpoint.materialization,
    );
    const retainedBlock = largeMaterialization.blockTree[0];
    invariant(retainedBlock, "Large checkpoint has no retained Block identity");
    const ordinaryReuse = applyDocumentOperationBatch(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      mutationId: "document-version-probe:ordinary-tombstone-reuse",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "document-version-probe:large-window",
      actor: { kind: "runtime_probe_illegal_reuse" },
      documentId: largeDescriptor.documentId,
      generation: largeDescriptor.generation,
      expectedHeadSeq: replacement.value.headSeq,
      operations: [{ kind: "insert_block", block: retainedBlock }],
    });
    invariant(
      !ordinaryReuse.ok && ordinaryReuse.error.code === "duplicate_block_id",
      "Ordinary Document insert was allowed to reuse a retained tombstone",
    );
    const largeRestoreRequest = {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      mutationId: "document-version-probe:large-restore",
      projectId: project.id,
      storeEpoch,
      documentId: largeDescriptor.documentId,
      versionId: largeCheckpoint.checkpoint.versionId,
      generation: largeDescriptor.generation,
      expectedHeadSeq: replacement.value.headSeq,
      clientSessionId: "document-version-probe:large-window",
      actor: { kind: "runtime_probe_large_restore" },
    } as const;
    const largePlan = prepareDocumentVersionRestore(
      getDb(),
      largeRestoreRequest,
    );
    invariant(
      largePlan.kind === "operation_plan" &&
        largePlan.plan.contentModel === "block_tree" &&
        largePlan.plan.operations.length > 512,
      "Large restore did not retain its trusted oversized internal plan",
    );
    const largeRestore = restoreDocumentVersion(
      getDb(),
      largeRestoreRequest,
      {
        writeFence: {
          leaseId: "document-version-probe:large-restore-lease",
          documentId: largeDescriptor.documentId,
          generation: largeDescriptor.generation,
          headSeq: replacement.value.headSeq,
        },
      },
    );
    invariant(
      largeRestore.ok &&
        largeRestore.value.headSeq === replacement.value.headSeq + 1 &&
        largeRestore.value.createdBlockIds.length > 512,
      "Trusted oversized restore did not commit as one forward update",
    );
    const restoredLargeDocument = loadPrimaryBlockDocument(
      getDb(),
      largeDescriptor.documentId,
    );
    try {
      invariant(
        materializePageDocument(restoredLargeDocument.document).blockTree.length ===
          largeMaterialization.blockTree.length,
        "Oversized restore did not reproduce the immutable BlockTree",
      );
    } finally {
      restoredLargeDocument.document.destroy();
    }

    process.stdout.write(
      `${JSON.stringify({
        immutableIdempotency: true,
        lostResponseRetry: true,
        sameHeadPagination: true,
        faultRollback: true,
        exactMaterialization: true,
        forwardRestore: true,
        restoreReceiptReplay: true,
        restoreFaultRollback: true,
        stableBlockIds: true,
        mutationHistory: true,
        compactionIndependent: true,
        restartVerified: true,
        noOpRestore: true,
        oversizedRestore: true,
        narrowTombstoneReactivation: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_HOME;
  }
};

void main();
