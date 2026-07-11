import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CardMutationWriter } from "../src/main/card-mutation-writer";
import { applyCardLifecycleMutation } from "../src/main/local-store/card-block-lifecycle";
import { readBlockStoreEpoch } from "../src/main/local-store/block-store-metadata";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import {
  parseCardLifecycleMutationRequest,
  type CardLifecycleMutationRequest,
} from "../src/shared/card-lifecycle";
import { createUuidV7 } from "../src/shared/card-id";
import type { BoardChangeEvent } from "../src/shared/ipc-api";
import type { DatabaseChangeEvent } from "../src/shared/database-events";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

interface Scope {
  readonly projectId: string;
  readonly storeEpoch: string;
}

const lifecycleRequest = (
  scope: Scope,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
): CardLifecycleMutationRequest =>
  parseCardLifecycleMutationRequest({
    version: 1,
    operationId,
    projectId: scope.projectId,
    storeEpoch: scope.storeEpoch,
    clientSessionId: "trusted-lifecycle-window",
    actor: { kind: "electron_renderer", windowId: "window:lifecycle-probe" },
    operation,
  });

const createOperation = (
  cardId: string,
  title: string,
): Readonly<Record<string, unknown>> => ({
  kind: "create_card",
  cardId,
  title,
  nfm: "Card body committed through the worker FIFO",
  status: "draft",
});

const createWriter = (
  events: BoardChangeEvent[],
  databaseEvents: DatabaseChangeEvent[],
): CardMutationWriter =>
  new CardMutationWriter({
    publishBoardEvent: (event) => events.push(event),
    publishDatabaseEvent: (event) => databaseEvents.push(event),
  });

const eventCount = (events: readonly unknown[]): number =>
  events.length;

const main = async (): Promise<void> => {
  const previousNodexDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-lifecycle-worker-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  let writer: CardMutationWriter | undefined;

  try {
    await initializeDatabase();
    const project = createProject({ name: "Card lifecycle worker" });
    const storeEpoch = readBlockStoreEpoch(getDb());
    invariant(storeEpoch, "Store epoch is missing");
    const scope: Scope = { projectId: project.id, storeEpoch };
    const cardId = createUuidV7();
    const create = lifecycleRequest(
      scope,
      "worker-lifecycle:create",
      createOperation(cardId, "Worker lifecycle Card"),
    );
    const archive = lifecycleRequest(scope, "worker-lifecycle:archive", {
      kind: "archive_card",
      cardId,
      expectedMetadataRevision: 1,
    });
    const staleUnarchive = lifecycleRequest(
      scope,
      "worker-lifecycle:stale-unarchive",
      {
        kind: "unarchive_card",
        cardId,
        expectedMetadataRevision: 1,
      },
    );
    closeDatabase();

    const firstEvents: BoardChangeEvent[] = [];
    const firstDatabaseEvents: DatabaseChangeEvent[] = [];
    writer = createWriter(firstEvents, firstDatabaseEvents);
    const created = await writer.applyCardLifecycleMutation(create);
    invariant(
      created.result.ok &&
        !created.result.value.duplicate &&
        created.result.value.operationId === create.operationId &&
        created.result.value.storeEpoch === scope.storeEpoch,
      "Worker did not preserve the lifecycle request identity and receipt",
    );
    const createdDocumentId = created.result.value.documentId;
    const preflight = await writer.readCardLifecyclePreflight(
      scope.projectId,
      cardId,
    );
    invariant(
      preflight.result.ok &&
        preflight.result.value.storeEpoch === scope.storeEpoch &&
        preflight.result.value.value?.card?.cardId === cardId &&
        preflight.result.value.value.card.document.documentId ===
          created.result.value.documentId &&
        preflight.result.value.value.card.membership?.membershipId ===
          created.result.value.membershipId,
      "Worker did not return the Card lifecycle authority as one preflight snapshot",
    );
    invariant(
      created.metrics.eventCount === 1 &&
        created.events.length === 1 &&
        eventCount(firstEvents) === 1 &&
        firstEvents[0]?.changeType === "create" &&
        firstEvents[0]?.summary?.title === "Worker lifecycle Card" &&
        eventCount(firstDatabaseEvents) === 1 &&
        firstDatabaseEvents[0]?.sourceKind === "card_lifecycle" &&
        firstDatabaseEvents[0]?.affectedDatabaseBlockIds[0] ===
          created.result.value.databaseBlockId,
      "First lifecycle commit did not fan out its authoritative summary once",
    );

    const duplicateCreate = await writer.applyCardLifecycleMutation(create);
    invariant(
      duplicateCreate.result.ok &&
        duplicateCreate.result.value.duplicate &&
        duplicateCreate.metrics.eventCount === 0 &&
        duplicateCreate.events.length === 0 &&
        eventCount(firstEvents) === 1 &&
        eventCount(firstDatabaseEvents) === 1,
      "Exact lifecycle retry emitted a second semantic event",
    );

    const archived = await writer.applyCardLifecycleMutation(archive);
    invariant(
      archived.result.ok &&
        !archived.result.value.duplicate &&
        archived.metrics.eventCount === 1 &&
        eventCount(firstEvents) === 2 &&
        firstEvents[1]?.summary?.archived === true &&
        eventCount(firstDatabaseEvents) === 2,
      "Archive commit did not fan out the committed archived summary",
    );
    const duplicateArchive = await writer.applyCardLifecycleMutation(archive);
    invariant(
      duplicateArchive.result.ok &&
        duplicateArchive.result.value.duplicate &&
        duplicateArchive.metrics.eventCount === 0 &&
        eventCount(firstEvents) === 2 &&
        eventCount(firstDatabaseEvents) === 2,
      "Exact archive retry emitted a second semantic event",
    );

    const rejected = await writer.applyCardLifecycleMutation(staleUnarchive);
    invariant(
      !rejected.result.ok &&
        rejected.result.error.code === "metadata_revision_conflict" &&
        rejected.metrics.eventCount === 0 &&
        rejected.events.length === 0 &&
        eventCount(firstEvents) === 2 &&
        eventCount(firstDatabaseEvents) === 2,
      "Rejected lifecycle mutation escaped its typed result or emitted an event",
    );

    const compacted = await writer.compactEligibleBlockDocuments({
      storeEpoch: scope.storeEpoch,
      policy: {
        minimumUpdateCount: 1,
        minimumUpdateBytes: 1,
        maximumDocuments: 8,
        maximumTailBytes: 1024 * 1024,
        scanLimit: 64,
      },
    });
    invariant(
      compacted.result.storeEpoch === scope.storeEpoch &&
        compacted.result.selectedDocumentCount >= 1 &&
        compacted.result.documents.some(
          (document) =>
            document.documentId === createdDocumentId,
        ) &&
        compacted.events.length === 0 &&
        compacted.metrics.eventCount === 0 &&
        eventCount(firstEvents) === 2 &&
        eventCount(firstDatabaseEvents) === 2,
      `Document compaction did not stay inside the FIFO or emitted content fanout: ${JSON.stringify({
        result: compacted.result,
        workerEventCount: compacted.events.length,
        metricEventCount: compacted.metrics.eventCount,
        boardEventCount: eventCount(firstEvents),
        databaseEventCount: eventCount(firstDatabaseEvents),
      })}`,
    );

    await writer.shutdown();
    writer = undefined;

    await initializeDatabase();
    const rollbackCardId = createUuidV7();
    const rollbackRequest = lifecycleRequest(
      scope,
      "worker-lifecycle:precommit-fault",
      createOperation(rollbackCardId, "Pre-commit fault"),
    );
    let rolledBack = false;
    try {
      applyCardLifecycleMutation(getDb(), rollbackRequest, {
        faultInjector: (point) => {
          if (point === "before_commit") throw new Error("pre-commit fault");
        },
      });
    } catch {
      rolledBack = true;
    }
    invariant(
      rolledBack &&
        getDb().prepare("SELECT 1 FROM blocks WHERE id = ?").get(rollbackCardId) ===
          undefined &&
        getDb()
          .prepare("SELECT 1 FROM block_mutations WHERE mutation_id = ?")
          .get(rollbackRequest.operationId) === undefined,
      "Pre-commit lifecycle fault left partial authority or a receipt",
    );
    closeDatabase();

    const restartEvents: BoardChangeEvent[] = [];
    const restartDatabaseEvents: DatabaseChangeEvent[] = [];
    writer = createWriter(restartEvents, restartDatabaseEvents);
    const createAfterRestart = await writer.applyCardLifecycleMutation(create);
    const rejectionAfterRestart =
      await writer.applyCardLifecycleMutation(staleUnarchive);
    invariant(
      createAfterRestart.result.ok &&
        createAfterRestart.result.value.duplicate &&
        !rejectionAfterRestart.result.ok &&
        rejectionAfterRestart.result.error.code ===
          "metadata_revision_conflict" &&
        createAfterRestart.metrics.eventCount === 0 &&
        rejectionAfterRestart.metrics.eventCount === 0 &&
        eventCount(restartEvents) === 0 &&
        eventCount(restartDatabaseEvents) === 0,
      "Worker restart did not replay committed and rejected receipts exactly",
    );
    const recovered = await writer.applyCardLifecycleMutation(rollbackRequest);
    invariant(
      recovered.result.ok &&
        !recovered.result.value.duplicate &&
        eventCount(restartEvents) === 1 &&
        restartEvents[0]?.summary?.id === rollbackCardId &&
        eventCount(restartDatabaseEvents) === 1,
      "Worker did not cleanly commit after a rolled-back pre-commit fault",
    );
    await writer.shutdown();
    writer = undefined;

    await initializeDatabase();
    const lostResponseCardId = createUuidV7();
    const lostResponseRequest = lifecycleRequest(
      scope,
      "worker-lifecycle:lost-response",
      createOperation(lostResponseCardId, "Lost response"),
    );
    let responseLost = false;
    try {
      applyCardLifecycleMutation(getDb(), lostResponseRequest, {
        faultInjector: (point) => {
          if (point === "after_commit") throw new Error("response lost");
        },
      });
    } catch {
      responseLost = true;
    }
    closeDatabase();

    const lostResponseEvents: BoardChangeEvent[] = [];
    const lostResponseDatabaseEvents: DatabaseChangeEvent[] = [];
    writer = createWriter(lostResponseEvents, lostResponseDatabaseEvents);
    const recoveredResponse =
      await writer.applyCardLifecycleMutation(lostResponseRequest);
    invariant(
      responseLost &&
        recoveredResponse.result.ok &&
        recoveredResponse.result.value.duplicate &&
        recoveredResponse.metrics.eventCount === 0 &&
        eventCount(lostResponseEvents) === 0 &&
        eventCount(lostResponseDatabaseEvents) === 0,
      "Post-commit response loss did not recover as an event-free exact retry",
    );
    await writer.shutdown();
    writer = undefined;

    await initializeDatabase();
    const database = getDb();
    const compatibilityTable = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
      )
      .get();
    const storedIdentity = database
      .prepare(
        `
        SELECT actor_json, client_session_id
        FROM block_mutations
        WHERE mutation_id = ?
      `,
      )
      .get(create.operationId) as {
      readonly actor_json: string;
      readonly client_session_id: string | null;
    };
    const actor = JSON.parse(storedIdentity.actor_json) as {
      readonly kind?: string;
      readonly windowId?: string;
    };
    const snapshotCount = (
      database
        .prepare("SELECT COUNT(*) AS count FROM document_snapshots WHERE document_id = ?")
        .get(created.result.value.documentId) as { readonly count: number }
    ).count;
    const quickCheck = database.pragma("quick_check", { simple: true });
    const foreignKeys = database.pragma("foreign_key_check") as unknown[];
    invariant(
      compatibilityTable === undefined,
      "Lifecycle worker wrote a compatibility cards row",
    );
    invariant(
      storedIdentity.client_session_id === "trusted-lifecycle-window" &&
        actor.kind === "electron_renderer" &&
        actor.windowId === "window:lifecycle-probe",
      "Worker changed the trusted actor or client session identity",
    );
    invariant(snapshotCount > 0, "FIFO compaction did not persist a snapshot");
    invariant(
      quickCheck === "ok" && foreignKeys.length === 0,
      "Lifecycle worker probe left SQLite integrity failures",
    );

    process.stdout.write(
      `${JSON.stringify({
        fifo: true,
        typedReceipt: true,
        preflightSnapshot: true,
        trustedIdentityPreserved: true,
        firstCommitFanoutOnce: true,
        databaseInvalidationOnce: true,
        duplicateNoFanout: true,
        rejectedNoFanout: true,
        exactRestartRetry: true,
        preCommitFaultRollback: true,
        postCommitResponseRecovery: true,
        compactionInFifo: true,
        noCardsRow: true,
        integrity: true,
      })}\n`,
    );
  } finally {
    if (writer) await writer.shutdown().catch(() => undefined);
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousNodexDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousNodexDir;
  }
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
