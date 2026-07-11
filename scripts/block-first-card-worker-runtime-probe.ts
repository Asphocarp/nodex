import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { CardMutationWriter } from "../src/main/card-mutation-writer";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import {
  createCard as createCardDirect,
  readCardSummaryById,
} from "../src/main/local-store/cards";
import { loadBlockDocument } from "../src/main/local-store/block-document-store";
import { createProject } from "../src/main/local-store/projects";
import {
  createCardDocumentGenesis,
  materializeCardDocument,
  type BlockTreeNode,
} from "../src/shared/block-documents/block-document-codec";
import { openCardDocument } from "../src/shared/block-documents";
import { cloneXmlSubtree } from "../src/shared/block-documents/xml-subtree-codec";
import type { BoardChangeEvent } from "../src/shared/ipc-api";

function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (condition) return;
  throw new Error(message);
}

const flattenIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenIds(block.children)]);

const captureDocumentUpdate = (
  document: Y.Doc,
  mutate: () => void,
): Uint8Array => {
  let captured: Uint8Array | undefined;
  const onUpdate = (update: Uint8Array): void => {
    captured = update.slice();
  };
  document.on("update", onUpdate);
  try {
    mutate();
  } finally {
    document.off("update", onUpdate);
  }
  invariant(captured, "Expected the collaborative mutation to emit an update");
  return captured;
};

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

const archiveCardForProbe = (cardId: string): void => {
  const database = new Database(getDatabasePath(), { readonly: false });
  database.pragma("foreign_keys = ON");
  try {
    const result = database.prepare(`
      UPDATE cards
      SET archived = 1, revision = revision + 1
      WHERE id = ?
    `).run(cardId);
    invariant(result.changes === 1, `Could not archive projection host ${cardId}`);
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

  const documentBoardEvents: BoardChangeEvent[] = [];
  let documentEventObservedCommittedState = false;
  let cutoverCandidateId = "";
  const cutoverWriter = new CardMutationWriter({
    publishBoardEvent: (event) => {
      documentBoardEvents.push(event);
      if (event.cardId !== cutoverCandidateId) return;
      documentEventObservedCommittedState =
        readPersistedCardDocument(event.cardId).title === event.summary?.title;
    },
  });
  const projectedTarget = await cutoverWriter.createCard(project.id, "draft", {
    title: "Legacy projected target",
    description: "Projected body",
  });
  const directProjectionHost = await cutoverWriter.createCard(project.id, "draft", {
    title: "Direct projection host",
    description: `<card-ref project="${project.id}" card="${projectedTarget.result.id}" />`,
  });
  archiveCardForProbe(directProjectionHost.result.id);
  const projectedTargetPreparation = await cutoverWriter.prepareOwnedBlockDocument(
    project.id,
    projectedTarget.result.id,
  );
  invariant(projectedTargetPreparation.ok, "Projected target preparation failed");
  invariant(
    projectedTargetPreparation.value.authority === "legacy_shadow",
    "Inbound legacy projection target crossed the authority fence",
  );
  const projectionHostPreparation = await cutoverWriter.prepareOwnedBlockDocument(
    project.id,
    directProjectionHost.result.id,
  );
  invariant(projectionHostPreparation.ok, "Projection host preparation failed");
  invariant(
    projectionHostPreparation.value.authority === "legacy_shadow",
    "Legacy projection host crossed the authority fence",
  );

  await initializeDatabase();
  const querySourceProject = createProject({ name: "Legacy query source" });
  closeDatabase();
  const possibleQueryRow = await cutoverWriter.createCard(
    querySourceProject.id,
    "draft",
    { title: "Possible legacy query row" },
  );
  await cutoverWriter.createCard(project.id, "draft", {
    title: "Legacy query host",
    description: `<toggle-list-inline-view project="${querySourceProject.id}" rules-v2="eyJtb2RlIjoiYWxsIn0" property-order="priority,estimate,status,tags" show-empty-estimate="false" show-empty-priority="false" />`,
  });
  const queryRowPreparation = await cutoverWriter.prepareOwnedBlockDocument(
    querySourceProject.id,
    possibleQueryRow.result.id,
  );
  invariant(queryRowPreparation.ok, "Query row preparation failed");
  invariant(
    queryRowPreparation.value.authority === "legacy_shadow",
    "Possible legacy query row crossed the authority fence",
  );
  const cutoverCandidate = await cutoverWriter.createCard(project.id, "in_review", {
    title: "Cutover candidate",
    description: "Primary body",
  });
  cutoverCandidateId = cutoverCandidate.result.id;
  const shadowDescriptor = await cutoverWriter.getOwnedBlockDocumentDescriptor(
    project.id,
    cutoverCandidate.result.id,
  );
  invariant(
    shadowDescriptor.result.authority === "legacy_shadow",
    "Descriptor did not expose legacy authority",
  );
  let crossProjectPrepareRejected = false;
  const crossProjectPrepare = await cutoverWriter.prepareOwnedBlockDocument(
    "not-the-owner-project",
    cutoverCandidate.result.id,
  );
  crossProjectPrepareRejected = !crossProjectPrepare.ok
    && crossProjectPrepare.error.code === "document_not_found";
  invariant(crossProjectPrepareRejected, "Cross-Project prepare was accepted");
  invariant(
    (await cutoverWriter.getOwnedBlockDocumentDescriptor(
      project.id,
      cutoverCandidate.result.id,
    )).result.authority === "legacy_shadow",
    "Rejected prepare still changed Document authority",
  );
  const primaryDescriptor = await cutoverWriter.prepareOwnedBlockDocument(
    project.id,
    cutoverCandidate.result.id,
  );
  invariant(primaryDescriptor.ok, "Writer cutover failed");
  invariant(
    primaryDescriptor.value.authority === "ydoc_primary",
    "Writer cutover did not publish primary authority",
  );
  const primarySync = await cutoverWriter.syncBlockDocument({
    documentId: primaryDescriptor.value.documentId,
    clientSessionId: "primary-after-cutover",
    stateVector: new Uint8Array([0]),
  });
  invariant(primarySync.ok, "Primary Document was not syncable after cutover");

  documentBoardEvents.length = 0;
  const collaborativeDocument = new Y.Doc({
    guid: primaryDescriptor.value.documentId,
  });
  Y.applyUpdate(collaborativeDocument, primarySync.value.update, "probe-sync");
  const collaborativeRoots = openCardDocument(collaborativeDocument);
  const collaborativeUpdate = captureDocumentUpdate(
    collaborativeDocument,
    () => {
      collaborativeDocument.transact(() => {
        collaborativeRoots.title.delete(0, collaborativeRoots.title.length);
        collaborativeRoots.title.insert(0, "Collaborative title");
      }, "probe-title-edit");
    },
  );
  const applyRequest = {
    documentId: primaryDescriptor.value.documentId,
    storeEpoch: primarySync.value.storeEpoch,
    generation: primarySync.value.generation,
    updateId: "probe:collaborative-title",
    clientSessionId: "primary-after-cutover",
    baseHeadSeq: primarySync.value.headSeq,
    touchedBlockIds: [cutoverCandidate.result.id],
    update: collaborativeUpdate,
  } as const;
  const applied = await cutoverWriter.applyBlockDocumentUpdate(applyRequest);
  invariant(applied.ok, "Collaborative Document update failed");
  invariant(!applied.value.duplicate, "First collaborative update was duplicate");
  invariant(documentBoardEvents.length === 1, "Document update did not publish one board event");
  const documentBoardEvent = documentBoardEvents[0];
  invariant(documentBoardEvent?.cardId === cutoverCandidate.result.id, "Document event targeted the wrong Card");
  invariant(documentBoardEvent.summary?.title === "Collaborative title", "Document event used the legacy Card title");
  invariant(documentBoardEvent.summary?.descriptionPreview === "Primary body", "Document event omitted the materialized body preview");
  invariant(documentEventObservedCommittedState, "Document event was published before its SQLite commit became visible");

  const foreignTemplate = createCardDocumentGenesis({
    documentId: "document:foreign-body-template",
    title: "",
    nfm: `<card-ref project="${project.id}" card="${created.result.id}" />`,
  });
  const foreignTemplateRoot = openCardDocument(foreignTemplate.document).body.get(0);
  invariant(foreignTemplateRoot instanceof Y.XmlElement, "Foreign template root is invalid");
  const foreignBlock = foreignTemplateRoot.get(0);
  invariant(foreignBlock instanceof Y.XmlElement, "Foreign template Block is missing");
  const collaborativeRoot = collaborativeRoots.body.get(0);
  invariant(collaborativeRoot instanceof Y.XmlElement, "Collaborative body root is invalid");
  const rejectedForeignUpdate = captureDocumentUpdate(
    collaborativeDocument,
    () => collaborativeRoot.insert(collaborativeRoot.length, [cloneXmlSubtree(foreignBlock)]),
  );
  const rejectedForeign = await cutoverWriter.applyBlockDocumentUpdate({
    documentId: primaryDescriptor.value.documentId,
    storeEpoch: primarySync.value.storeEpoch,
    generation: primarySync.value.generation,
    updateId: "probe:foreign-body-rejected",
    clientSessionId: "primary-after-cutover",
    baseHeadSeq: applied.value.headSeq,
    touchedBlockIds: [],
    update: rejectedForeignUpdate,
  });
  invariant(!rejectedForeign.ok, "Primary Document accepted a legacy foreign-body projection");
  invariant(
    rejectedForeign.error.code === "invalid_document_update",
    "Foreign-body rejection returned the wrong error code",
  );
  foreignTemplate.document.destroy();

  const duplicate = await cutoverWriter.applyBlockDocumentUpdate(applyRequest);
  invariant(duplicate.ok, "Idempotent Document retry failed");
  invariant(duplicate.value.duplicate, "Idempotent Document retry was not marked duplicate");
  invariant(documentBoardEvents.length === 1, "Idempotent retry published a duplicate board event");
  collaborativeDocument.destroy();
  await cutoverWriter.shutdown();

  await initializeDatabase();
  const restartedPrimarySummary = readCardSummaryById(cutoverCandidate.result.id);
  invariant(
    restartedPrimarySummary?.title === "Collaborative title",
    "Restarted Card summary fell back to the legacy Card title",
  );
  invariant(
    restartedPrimarySummary.descriptionPreview === "Primary body",
    "Restarted Card summary fell back to the legacy Card body",
  );
  closeDatabase();

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
    legacyProjectionParticipantsStayedOnOneAuthority: true,
    primarySyncWorkedAfterCutover: true,
    documentBoardEventWasPostCommitAndIdempotent: true,
    primaryWriterRejectedForeignBodyProjection: true,
    primarySummarySurvivedRestartWithoutDualWrite: true,
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
