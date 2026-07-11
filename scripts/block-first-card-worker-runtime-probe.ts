import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CardMutationWriter } from "../src/main/card-mutation-writer";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createCard as createCardDirect } from "../src/main/local-store/cards";
import { loadBlockDocument } from "../src/main/local-store/block-document-store";
import { createProject } from "../src/main/local-store/projects";
import {
  materializeCardDocument,
  type BlockTreeNode,
} from "../src/shared/block-documents/block-document-codec";

function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (condition) return;
  throw new Error(message);
}

const flattenIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenIds(block.children)]);

interface PersistedCardDocument {
  readonly readiness: string;
  readonly authority: string;
  readonly headSeq: number;
  readonly title: string;
  readonly nfm: string;
  readonly ids: readonly string[];
  readonly projectedSeq: number;
}

const readPersistedCardDocument = (
  cardId: string,
): PersistedCardDocument => {
  const database = new Database(getDatabasePath(), { readonly: false });
  database.pragma("foreign_keys = ON");
  try {
    const documentId = `document:${cardId}`;
    const documentRow = database.prepare(`
      SELECT readiness, authority, head_seq
      FROM documents
      WHERE id = ?
    `).get(documentId) as
      | {
          readonly readiness: string;
          readonly authority: string;
          readonly head_seq: number;
        }
      | undefined;
    invariant(documentRow, `Document ${documentId} is missing`);
    const projection = database.prepare(`
      SELECT projected_seq
      FROM document_materializations
      WHERE document_id = ?
    `).get(documentId) as { readonly projected_seq: number } | undefined;
    invariant(projection, `Projection ${documentId} is missing`);
    const loaded = loadBlockDocument(database, documentId);
    try {
      const materialization = materializeCardDocument(loaded.document);
      return {
        readiness: documentRow.readiness,
        authority: documentRow.authority,
        headSeq: documentRow.head_seq,
        title: materialization.title,
        nfm: materialization.nfm,
        ids: flattenIds(materialization.blockTree),
        projectedSeq: projection.projected_seq,
      };
    } finally {
      loaded.document.destroy();
    }
  } finally {
    database.close();
  }
};

const enqueueLegacyUpdate = (
  cardId: string,
  input: { readonly title?: string; readonly description?: string },
): void => {
  const database = new Database(getDatabasePath(), { readonly: false });
  database.pragma("foreign_keys = ON");
  try {
    const fields = ["revision = revision + 1"];
    const values: string[] = [];
    if (input.title !== undefined) {
      fields.push("title = ?");
      values.push(input.title);
    }
    if (input.description !== undefined) {
      fields.push("description = ?");
      values.push(input.description);
    }
    const result = database.prepare(`
      UPDATE cards
      SET ${fields.join(", ")}
      WHERE id = ?
    `).run(...values, cardId);
    invariant(result.changes === 1, `Could not enqueue update for ${cardId}`);
  } finally {
    database.close();
  }
};

const corruptLatestPendingShadowFence = (cardId: string): void => {
  const database = new Database(getDatabasePath(), { readonly: false });
  database.pragma("foreign_keys = ON");
  try {
    const result = database.prepare(`
      UPDATE legacy_card_shadow_jobs
      SET expected_document_head_seq = expected_document_head_seq + 100
      WHERE id = (
        SELECT id
        FROM legacy_card_shadow_jobs
        WHERE card_id = ? AND status = 'pending'
        ORDER BY source_event_seq DESC
        LIMIT 1
      )
    `).run(cardId);
    invariant(result.changes === 1, "Could not corrupt the pending shadow fence");
  } finally {
    database.close();
  }
};

const countShadowJobs = (status: string): number => {
  const database = new Database(getDatabasePath(), { readonly: true });
  try {
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM legacy_card_shadow_jobs
      WHERE status = ?
    `).get(status) as { readonly count: number };
    return row.count;
  } finally {
    database.close();
  }
};

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "nodex-card-worker-shadow-"),
);
const previousNodexDir = process.env.NODEX_DIR;
process.env.NODEX_DIR = tempDir;

try {
  await initializeDatabase();
  const project = createProject({ name: "Card worker shadow probe" });
  closeDatabase();

  const firstWriter = new CardMutationWriter();
  const created = await firstWriter.createCard(project.id, "draft", {
    title: "Worker genesis",
    description: "Alpha\nBeta",
  });
  invariant(
    created.metrics.shadowJobsApplied === 1,
    `Create did not drain genesis: ${JSON.stringify(created.metrics)}`,
  );
  const genesis = readPersistedCardDocument(created.result.id);
  invariant(genesis.readiness === "ready", "Create ACK preceded Document readiness");
  invariant(genesis.authority === "legacy_shadow", "Unexpected genesis authority");
  invariant(genesis.title === "Worker genesis", "Genesis title parity failed");
  invariant(genesis.nfm === "Alpha\nBeta", "Genesis NFM parity failed");
  invariant(genesis.projectedSeq === genesis.headSeq, "Genesis projection lagged");

  const translated = await firstWriter.updateCard(
    project.id,
    "draft",
    created.result.id,
    {
      title: "Worker translated",
      description: "Alpha\nBeta\nGamma",
    },
  );
  invariant(translated.result.status === "updated", "Legacy update failed");
  invariant(translated.metrics.shadowJobsApplied === 1, "Update did not drain shadow");
  const afterTranslation = readPersistedCardDocument(created.result.id);
  invariant(afterTranslation.title === "Worker translated", "Translated title lagged");
  invariant(afterTranslation.nfm === "Alpha\nBeta\nGamma", "Translated NFM lagged");
  invariant(
    afterTranslation.ids.slice(0, genesis.ids.length).join(",") === genesis.ids.join(","),
    "Legacy translation replaced stable Block identities",
  );

  for (let index = 0; index < 110; index += 1) {
    await createCardDirect(project.id, "backlog", {
      title: `Unrelated backlog ${index}`,
    });
  }
  closeDatabase();
  const bypassedBacklog = await firstWriter.createCard(project.id, "draft", {
    title: "Mutation fence target",
    description: "Must be ready before ACK",
  });
  invariant(
    (bypassedBacklog.metrics.shadowJobsProcessed ?? 0) >= 101,
    "Post-mutation drain did not combine bounded background and targeted work",
  );
  invariant(
    bypassedBacklog.metrics.shadowDrainExhausted === false,
    "The probe did not leave the intended unrelated backlog",
  );
  invariant(
    readPersistedCardDocument(bypassedBacklog.result.id).readiness === "ready",
    "More than 100 unrelated jobs delayed the current mutation Document",
  );
  await firstWriter.shutdown();

  enqueueLegacyUpdate(created.result.id, {
    title: "Recovered at restart",
    description: "Alpha\nBeta\nGamma\nDelta",
  });
  const pendingBeforeRestart = countShadowJobs("pending");
  invariant(pendingBeforeRestart > 1, "Restart fixture has no unrelated backlog");

  const restartedWriter = new CardMutationWriter();
  const publicScopeBeforeMutation = await restartedWriter.getBlockDocumentProjectId(
    `document:${created.result.id}`,
  );
  invariant(publicScopeBeforeMutation.ok, "Public Document scope lookup failed");
  invariant(
    countShadowJobs("pending") === pendingBeforeRestart,
    "Public Document sync unexpectedly drained legacy shadow work",
  );
  const startup = await restartedWriter.initializeBlockDocumentShadows();
  invariant(
    startup.result.exhausted &&
      startup.result.failed === 0 &&
      startup.result.errors === 0 &&
      startup.result.processed >= pendingBeforeRestart,
    `Explicit startup drain did not reach parity: ${JSON.stringify(startup.result)}`,
  );
  const recovered = readPersistedCardDocument(created.result.id);
  invariant(recovered.title === "Recovered at restart", "Startup drain did not recover title");
  invariant(
    recovered.nfm === "Alpha\nBeta\nGamma\nDelta",
    "Startup drain did not recover NFM",
  );
  const afterRestart = await restartedWriter.createCard(project.id, "backlog", {
    title: "Restart boundary",
    description: "Restart body",
  });
  invariant(
    afterRestart.metrics.shadowJobsApplied === 1,
    "Post-startup mutation did not drain its own genesis",
  );
  invariant(
    readPersistedCardDocument(afterRestart.result.id).readiness === "ready",
    "Restart mutation ACK preceded its own genesis",
  );
  await restartedWriter.shutdown();

  enqueueLegacyUpdate(created.result.id, { title: "Terminal failure fixture" });
  corruptLatestPendingShadowFence(created.result.id);

  const resilientWriter = new CardMutationWriter();
  const afterFailure = await resilientWriter.createCard(project.id, "in_progress", {
    title: "FIFO remains healthy",
    description: "Healthy body",
  });
  invariant(afterFailure.metrics.shadowJobsFailed === 1, "Failed shadow job was not observed");
  invariant(countShadowJobs("failed") === 1, "Failed shadow job was not durable");
  invariant(
    readPersistedCardDocument(afterFailure.result.id).readiness === "ready",
    "A terminal shadow failure poisoned a different Card mutation",
  );

  const queuedUpdate = resilientWriter.updateCard(
    project.id,
    "in_progress",
    afterFailure.result.id,
    { title: "Gracefully drained", description: "Healthy body\nQueued edit" },
  );
  const shutdown = resilientWriter.shutdown();
  const queuedResult = await queuedUpdate;
  invariant(queuedResult.result.status === "updated", "Queued mutation failed during shutdown");
  await shutdown;
  const gracefullyDrained = readPersistedCardDocument(afterFailure.result.id);
  invariant(gracefullyDrained.title === "Gracefully drained", "Shutdown lost queued title");
  invariant(
    gracefullyDrained.nfm === "Healthy body\nQueued edit",
    "Shutdown lost queued Document translation",
  );

  const cutoverWriter = new CardMutationWriter();
  const cutoverCandidate = await cutoverWriter.createCard(project.id, "in_review", {
    title: "Cutover candidate",
    description: "Primary body",
  });
  const shadowDescriptor = await cutoverWriter.getOwnedBlockDocumentDescriptor(
    project.id,
    cutoverCandidate.result.id,
  );
  invariant(
    shadowDescriptor.result.authority === "legacy_shadow",
    "Descriptor did not expose legacy authority",
  );
  const primaryDescriptor = await cutoverWriter.cutoverCardDocumentToPrimary({
    projectId: project.id,
    ownerBlockId: cutoverCandidate.result.id,
    expectedGeneration: shadowDescriptor.result.generation,
    expectedHeadSeq: shadowDescriptor.result.headSeq,
  });
  invariant(
    primaryDescriptor.result.authority === "ydoc_primary",
    "Writer cutover did not publish primary authority",
  );
  const primarySync = await cutoverWriter.syncBlockDocument({
    documentId: primaryDescriptor.result.documentId,
    clientSessionId: "primary-after-cutover",
    stateVector: new Uint8Array([0]),
  });
  invariant(primarySync.ok, "Primary Document was not syncable after cutover");
  await cutoverWriter.shutdown();

  enqueueLegacyUpdate(afterRestart.result.id, {
    title: "Shutdown must not project this",
  });
  const shutdownOnlyWriter = new CardMutationWriter();
  const publicScope = await shutdownOnlyWriter.getBlockDocumentProjectId(
    `document:${afterRestart.result.id}`,
  );
  invariant(publicScope.ok, "Could not start the shutdown-only worker");
  const pendingBeforeShutdown = countShadowJobs("pending");
  await shutdownOnlyWriter.shutdown();
  invariant(
    countShadowJobs("pending") === pendingBeforeShutdown,
    "Shutdown unexpectedly drained legacy shadow work",
  );

  process.stdout.write(`${JSON.stringify({
    createAckedReadyParity: true,
    legacyUpdatePreservedIds: true,
    currentMutationBypassedLargeBacklog: true,
    restartDrainedPending: true,
    terminalFailureDidNotPoisonFifo: true,
    gracefulShutdownDrainedShadow: true,
    publicDocumentCommandsDidNotDrainShadow: true,
    shutdownDidNotDrainShadow: true,
    descriptorAndCutoverStayedProjectScoped: true,
    primarySyncWorkedAfterCutover: true,
    failedJobs: countShadowJobs("failed"),
  })}\n`);
} finally {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousNodexDir === undefined) {
    delete process.env.NODEX_DIR;
  } else {
    process.env.NODEX_DIR = previousNodexDir;
  }
}
