import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  compactEligibleBlockDocuments,
  listBlockDocumentCompactionCandidates,
} from "../src/main/local-store/block-document-compaction";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import { compilePageLifecycleCreateRequestV2InDatabase } from "../src/main/local-store/page-lifecycle-v2-compiler";
import { applyPageLifecycleMutationV2 } from "../src/main/local-store/page-lifecycle-v2-store";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createDocumentVersionCheckpoint } from "../src/main/local-store/document-versions";
import { createProject } from "../src/main/local-store/projects";
import { openPageDocument } from "../src/shared/block-documents";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../src/shared/block-documents/document-history";
import { createUuidV7FromTimestamp } from "../src/shared/uuid-v7";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const readStoreEpoch = (): string => {
  const row = getDb()
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  invariant(row, "Block store metadata is missing");
  return row.store_epoch;
};

const createCard = (
  projectId: string,
  storeEpoch: string,
  cardId: string,
): { readonly documentId: string; readonly generation: number; readonly headSeq: number } => {
  const result = applyPageLifecycleMutationV2(
    getDb(),
    compilePageLifecycleCreateRequestV2InDatabase(getDb(), {
      operationId: `create:${cardId}`,
      projectId,
      storeEpoch,
      clientSessionId: "compaction-probe:create",
      actor: { kind: "runtime_probe" },
      operation: {
        kind: "create_page",
        pageId: cardId,
        title: cardId,
        nfm: "Compaction body",
        status: "triage",
      },
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return {
    documentId: result.value.documentId,
    generation: result.value.documentGeneration,
    headSeq: result.value.documentHeadSeq,
  };
};

const rewriteTitle = (
  documentId: string,
  updateId: string,
  title: string,
): number => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    const before = Y.encodeStateVector(loaded.document);
    const envelope = openPageDocument(loaded.document);
    loaded.document.transact(() => {
      envelope.title.delete(0, envelope.title.length);
      envelope.title.insert(0, title);
    }, "compaction-probe");
    return applyBlockDocumentUpdate(getDb(), {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId,
      clientSessionId: "compaction-probe:editor",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(loaded.document, before),
    }).headSeq;
  } finally {
    loaded.document.destroy();
  }
};

const countRows = (table: string, documentId: string): number => {
  const allowed = new Set([
    "document_updates",
    "document_update_receipts",
    "document_snapshots",
    "document_versions",
  ]);
  invariant(allowed.has(table), `Unsupported probe table: ${table}`);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE document_id = ?`)
    .get(documentId) as { readonly count: number };
  return row.count;
};

const readTitle = (documentId: string): string => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    return openPageDocument(loaded.document).title.toString();
  } finally {
    loaded.document.destroy();
  }
};

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-document-compaction-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Document compaction runtime" });
    const storeEpoch = readStoreEpoch();
    const first = createCard(
      project.id,
      storeEpoch,
      createUuidV7FromTimestamp(1_784_000_000_000, 1),
    );
    const second = createCard(
      project.id,
      storeEpoch,
      createUuidV7FromTimestamp(1_784_000_000_000, 2),
    );
    rewriteTitle(first.documentId, "first-edit-1", "First one");
    const firstHead = rewriteTitle(
      first.documentId,
      "first-edit-2",
      "First two",
    );
    rewriteTitle(second.documentId, "second-edit-1", "Second one");

    createDocumentVersionCheckpoint(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch,
      documentId: first.documentId,
      expectedGeneration: first.generation,
      expectedHeadSeq: firstHead,
      cause: "manual",
      label: "Retained independently",
      actor: { kind: "runtime_probe" },
    });

    const policy = {
      // Both edited Cards have at least genesis + one edit. The Project's
      // primary Canvas only has genesis and must not become an incidental
      // candidate for this bounded two-Card compaction scenario.
      minimumUpdateCount: 2,
      minimumUpdateBytes: 64 * 1024 * 1024,
      maximumDocuments: 1,
      maximumTailBytes: 64 * 1024 * 1024,
      scanLimit: 16,
    } as const;
    const candidates = listBlockDocumentCompactionCandidates(getDb(), policy);
    invariant(candidates.length === 2, "Expected two compaction candidates");

    const firstReceipts = countRows(
      "document_update_receipts",
      first.documentId,
    );
    const firstVersions = countRows("document_versions", first.documentId);
    const firstBatch = compactEligibleBlockDocuments(getDb(), {
      storeEpoch,
      policy,
    });
    invariant(
      firstBatch.selectedDocumentCount === 1,
      "Compaction batch was not document bounded",
    );
    const compactedFirst = firstBatch.documents[0]?.documentId;
    invariant(compactedFirst, "Compaction batch returned no Document");
    invariant(
      countRows("document_updates", compactedFirst) === 0,
      "Compacted update payloads were retained",
    );
    if (compactedFirst === first.documentId) {
      invariant(
        countRows("document_update_receipts", first.documentId) === firstReceipts,
        "Compaction removed immutable update receipts",
      );
      invariant(
        countRows("document_versions", first.documentId) === firstVersions,
        "Compaction removed a durable Document version",
      );
    }

    const remainingDocumentId =
      compactedFirst === first.documentId
        ? second.documentId
        : first.documentId;
    const remainingUpdates = countRows("document_updates", remainingDocumentId);
    const remainingSnapshots = countRows(
      "document_snapshots",
      remainingDocumentId,
    );
    getDb().exec(`
      CREATE TRIGGER reject_compaction_probe_prune
      BEFORE DELETE ON document_updates
      WHEN OLD.document_id = '${remainingDocumentId}'
      BEGIN
        SELECT RAISE(ABORT, 'injected bounded compaction failure');
      END;
    `);
    let rollback = false;
    try {
      compactEligibleBlockDocuments(getDb(), { storeEpoch, policy });
    } catch (error) {
      rollback =
        error instanceof Error &&
        error.message.includes("injected bounded compaction failure");
    } finally {
      getDb().exec("DROP TRIGGER reject_compaction_probe_prune");
    }
    invariant(rollback, "Injected compaction failure was not observed");
    invariant(
      countRows("document_updates", remainingDocumentId) === remainingUpdates &&
        countRows("document_snapshots", remainingDocumentId) ===
          remainingSnapshots,
      "Failed compaction left partial snapshot/prune state",
    );

    let staleEpoch = false;
    try {
      compactEligibleBlockDocuments(getDb(), {
        storeEpoch: "restored-store-epoch",
        policy,
      });
    } catch (error) {
      staleEpoch =
        error instanceof BlockDocumentStoreError &&
        error.code === "store_epoch_mismatch";
    }
    invariant(staleEpoch, "Compaction accepted a stale store epoch");

    const secondBatch = compactEligibleBlockDocuments(getDb(), {
      storeEpoch,
      policy,
    });
    invariant(
      secondBatch.selectedDocumentCount === 1 &&
        secondBatch.documents[0]?.documentId === remainingDocumentId,
      "Remaining candidate did not compact on the next bounded pass",
    );
    invariant(
      countRows("document_updates", remainingDocumentId) === 0,
      "Second compaction did not prune its tail",
    );
    invariant(
      countRows("document_versions", first.documentId) === firstVersions,
      "Document version retention changed across batches",
    );

    closeDatabase();
    await initializeDatabase();
    const restart =
      readTitle(first.documentId) === "First two" &&
      readTitle(second.documentId) === "Second one";
    invariant(restart, "Compacted Documents did not reconstruct after restart");

    process.stdout.write(
      `${JSON.stringify({
        bounded: true,
        byteAccounted: firstBatch.selectedUpdateBytes > 0,
        receiptsRetained: true,
        versionsRetained: true,
        faultRollback: true,
        staleEpoch: true,
        restart: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main();
