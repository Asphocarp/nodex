import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createUuidV7 } from "../src/shared/uuid-v7";
import { parsePageLifecycleMutationRequest } from "../src/shared/page-lifecycle";
import type { PageInput } from "../src/shared/types";
import {
  materializePageDocument,
  type BlockTreeNode,
} from "../src/shared/block-documents/block-document-codec";
import {
  cloneAuthoritativePage,
  type AuthoritativePageCloneFaultPoint,
} from "../src/main/local-store/authoritative-page-clone";
import { AuthoritativeOperationReceiptError } from "../src/main/local-store/authoritative-operation-receipts";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import {
  completePageOccurrence,
  listPageOccurrences,
  skipPageOccurrence,
  updatePageOccurrence,
} from "../src/main/local-store/page-occurrences";
import { applyPageLifecycleMutation } from "../src/main/local-store/page-lifecycle";
import { readDatabasePageById } from "../src/main/local-store/page-read-store";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { listBlockChangeHistory } from "../src/main/local-store/document-versions";
import { createProject } from "../src/main/local-store/projects";
import { readBlockStoreEpoch } from "../src/main/local-store/block-store-metadata";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const updatePrimaryTitle = (documentId: string, nextTitle: string): void => {
  const database = getDb();
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    const before = Y.encodeStateVector(loaded.document);
    const title = loaded.document.getText("title");
    loaded.document.transact(() => {
      title.delete(0, title.length);
      title.insert(0, nextTitle);
    }, "page-clone-probe");
    applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: "page-clone-probe:source-title",
      clientSessionId: "page-clone-probe:window",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(loaded.document, before),
    });
  } finally {
    loaded.document.destroy();
  }
};

const readMaterialization = (documentId: string) => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    return materializePageDocument(loaded.document);
  } finally {
    loaded.document.destroy();
  }
};

const flattenBlockIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);

const countIdentity = (pageId: string): number => {
  const row = getDb()
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM blocks WHERE id = ?) +
        (SELECT COUNT(*) FROM documents WHERE id = 'document:' || ?) +
        (SELECT COUNT(*) FROM database_memberships WHERE card_block_id = ?) +
        (SELECT COUNT(*) FROM change_log
          WHERE kind = 'block_mutation'
            AND EXISTS (
              SELECT 1 FROM json_each(change_log.block_ids_json) member
              WHERE member.value = ?
            )) AS count
    `,
    )
    .get(pageId, pageId, pageId, pageId) as { readonly count: number };
  return row.count;
};

const countProjectPageBlocks = (projectId: string): number => {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS count FROM blocks WHERE project_id = ? AND type = 'page'",
    )
    .get(projectId) as { readonly count: number };
  return row.count;
};

const createPage = (
  projectId: string,
  status: "in_progress",
  input: PageInput,
) => {
  const database = getDb();
  const storeEpoch = readBlockStoreEpoch(database);
  assert(storeEpoch, "Block store epoch is missing");
  const pageId = createUuidV7();
  const result = applyPageLifecycleMutation(
    database,
    parsePageLifecycleMutationRequest({
      version: 1,
      operationId: `page-clone-probe:create:${pageId}`,
      projectId,
      storeEpoch,
      actor: { kind: "runtime-probe" },
      operation: {
        kind: "create_page",
        pageId: pageId,
        title: input.title,
        nfm: input.description ?? "",
        status,
        priority: input.priority ?? null,
        estimate: input.estimate ?? null,
        tags: input.tags ?? [],
        dueDate: input.dueDate?.toISOString().slice(0, 10) ?? null,
        scheduledStart: input.scheduledStart?.toISOString() ?? null,
        scheduledEnd: input.scheduledEnd?.toISOString() ?? null,
        isAllDay: input.isAllDay ?? false,
        recurrence: input.recurrence ?? null,
        reminders: input.reminders ?? [],
        scheduleTimezone: input.scheduleTimezone ?? null,
        assignee: input.assignee ?? null,
        runInTarget: input.runInTarget ?? "localProject",
        runInLocalPath: input.runInLocalPath ?? null,
        runInBaseBranch: input.runInBaseBranch ?? null,
        runInWorktreePath: input.runInWorktreePath ?? null,
        runInEnvironmentPath: input.runInEnvironmentPath ?? null,
      },
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  const card = readDatabasePageById(database, projectId, pageId);
  assert(card, "Created Page is missing from authority");
  return card;
};

const getPage = (projectId: string, pageId: string) =>
  readDatabasePageById(getDb(), projectId, pageId);

const main = async (): Promise<void> => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-page-clone-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Page clone runtime" });
    const source = createPage(project.id, "in_progress", {
      title: "Initial source title",
      description: [
        "Current collaborative paragraph",
        '<page-ref url="nodex://pages/stable-reference-target" />',
      ].join("\n"),
      priority: "p1-high",
      scheduledStart: new Date("2026-07-12T10:00:00.000Z"),
      scheduledEnd: new Date("2026-07-12T11:00:00.000Z"),
      recurrence: {
        frequency: "daily",
        interval: 1,
        endCondition: { type: "never" },
      },
      reminders: [{ offsetMinutes: 15 }],
      scheduleTimezone: "UTC",
      runInBaseBranch: "copied-base-branch",
    });
    let database = getDb();
    const sourceOwnership = database
      .prepare(
        `SELECT ownership.document_id
         FROM block_documents ownership
         INNER JOIN documents document ON document.id = ownership.document_id
         WHERE ownership.block_id = ? AND ownership.project_id = ?
           AND document.authority = 'ydoc_primary'
           AND document.readiness = 'ready'`,
      )
      .get(source.id, project.id) as { readonly document_id: string } | undefined;
    assert(sourceOwnership, "Source Page has no primary owned Document");
    updatePrimaryTitle(sourceOwnership.document_id, "Current Y.Doc source title");
    const sourceMaterialization = readMaterialization(sourceOwnership.document_id);

    const missingPageId = createUuidV7();
    const rejectedOperationId = "occurrence-rejected-exact-retry";
    const rejectedCreatedPageId = createUuidV7();
    const rejected = await completePageOccurrence(
      project.id,
      {
        operationId: rejectedOperationId,
        createdPageId: rejectedCreatedPageId,
        pageId: missingPageId,
        occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
        source: "calendar",
      },
      "rejected-first-session",
    );
    assert(
      !rejected.success &&
        !rejected.duplicate &&
        rejected.code === "page_not_found",
      "Missing Page did not create a typed durable rejection",
    );
    const rejectedLedger = database
      .prepare(
        `
        SELECT outcome, change_log_seq, actor_json, client_session_id
        FROM block_mutations
        WHERE mutation_id = ?
      `,
      )
      .get(rejectedOperationId) as
      | {
          readonly outcome: string;
          readonly change_log_seq: number | null;
          readonly actor_json: string;
          readonly client_session_id: string | null;
        }
      | undefined;
    assert(
      rejectedLedger?.outcome === "rejected" &&
        rejectedLedger.change_log_seq === null,
      "Rejected occurrence wrote a change cursor",
    );
    assert(
      rejectedLedger.client_session_id === "rejected-first-session" &&
        JSON.parse(rejectedLedger.actor_json).source === "calendar",
      "Rejected occurrence did not retain first-seen attribution",
    );
    assert(
      !database
        .prepare("SELECT 1 FROM change_log WHERE operation_id = ?")
        .get(rejectedOperationId),
      "Rejected occurrence entered the authority change log",
    );

    closeDatabase();
    await initializeDatabase();
    database = getDb();
    const rejectedRetry = await completePageOccurrence(
      project.id,
      {
        operationId: rejectedOperationId,
        createdPageId: rejectedCreatedPageId,
        pageId: missingPageId,
        occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
        source: "api",
      },
      "rejected-retry-session",
    );
    assert(
      !rejectedRetry.success &&
        rejectedRetry.duplicate &&
        rejectedRetry.code === rejected.code &&
        rejectedRetry.error === rejected.error,
      "Rejected occurrence retry did not return the exact first rejection",
    );
    const rejectedCollision = await skipPageOccurrence(project.id, {
      operationId: rejectedOperationId,
      pageId: missingPageId,
      occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
      source: "notification",
    });
    assert(
      !rejectedCollision.success &&
        rejectedCollision.code === "operation_id_collision",
      "Rejected operation ID reuse did not return a typed collision",
    );

    const unscheduled = createPage(project.id, "in_progress", {
      title: "Unscheduled rejection target",
    });
    const notScheduled = await skipPageOccurrence(project.id, {
      operationId: "occurrence-rejected-not-scheduled",
      pageId: unscheduled.id,
      occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
      source: "calendar",
    });
    assert(
      !notScheduled.success && notScheduled.code === "page_not_scheduled",
      "Unscheduled Page did not create a typed durable rejection",
    );
    const invalidUpdate = await updatePageOccurrence(project.id, {
      operationId: "occurrence-rejected-invalid-update",
      pageId: source.id,
      occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
      source: "calendar",
      scope: "invalid" as "all",
      updates: {},
    });
    assert(
      !invalidUpdate.success &&
        invalidUpdate.code === "invalid_occurrence_request",
      "Invalid occurrence update did not create a typed durable rejection",
    );

    const faultPoints: readonly AuthoritativePageCloneFaultPoint[] = [
      "after_identity",
      "after_relational_properties",
      "after_document_genesis",
      "after_authority_cutover",
      "after_projections",
      "before_commit",
    ];
    for (const point of faultPoints) {
      const failedPageId = createUuidV7();
      let failed = false;
      try {
        cloneAuthoritativePage(
          database,
          {
            projectId: project.id,
            sourcePageId: source.id,
            newPageId: failedPageId,
            lifecycle: "active",
            status: "in_progress",
            primaryViewRankKey: `fault:${point}`,
            operationId: `page-clone-fault:${point}`,
          },
          {
            faultInjector: (candidate) => {
              if (candidate === point) throw new Error(`fault:${point}`);
            },
          },
        );
      } catch (error) {
        failed = (error as Error).message === `fault:${point}`;
      }
      assert(failed, `Fault ${point} did not interrupt the clone`);
      assert(
        countIdentity(failedPageId) === 0,
        `Fault ${point} leaked clone state`,
      );
    }

    const exactRetryPageId = createUuidV7();
    const exactRetryOperationId = `page-clone-exact-retry:${exactRetryPageId}`;
    const exactRetryInput = {
      projectId: project.id,
      sourcePageId: source.id,
      newPageId: exactRetryPageId,
      lifecycle: "active" as const,
      status: "in_progress" as const,
      primaryViewRankKey: `exact-retry:${exactRetryPageId}`,
      topLevelRankKey: `exact-retry:${exactRetryPageId}`,
      operationId: exactRetryOperationId,
      clientSessionId: "clone-first-session",
      actor: { source: "first-clone-transport" },
      createdAt: "2026-07-11T00:00:00.000Z",
    };
    let responseLostAfterCommit = false;
    try {
      cloneAuthoritativePage(database, exactRetryInput, {
        faultInjector: (point) => {
          if (point === "after_commit") {
            throw new Error("lost-response-after-clone-commit");
          }
        },
      });
    } catch (error) {
      responseLostAfterCommit =
        (error as Error).message === "lost-response-after-clone-commit";
    }
    assert(
      responseLostAfterCommit,
      "Clone lost-response fault did not occur after commit",
    );
    assert(
      countIdentity(exactRetryPageId) === 4,
      "Committed clone identity was not singular",
    );

    closeDatabase();
    await initializeDatabase();
    database = getDb();
    const exactRetryClone = cloneAuthoritativePage(database, {
      ...exactRetryInput,
      clientSessionId: "clone-retry-session",
      actor: { source: "retry-clone-transport" },
      createdAt: "2026-07-11T01:00:00.000Z",
    });
    assert(
      exactRetryClone.duplicate,
      "Clone retry was not served from its durable receipt",
    );
    assert(
      exactRetryClone.createdAt === "2026-07-11T00:00:00.000Z",
      "Clone retry did not preserve the first commit result",
    );
    assert(
      countIdentity(exactRetryPageId) === 4,
      "Clone retry duplicated authoritative state",
    );

    let cloneCollision = false;
    try {
      cloneAuthoritativePage(database, {
        ...exactRetryInput,
        status: "done",
      });
    } catch (error) {
      cloneCollision =
        error instanceof AuthoritativeOperationReceiptError &&
        error.code === "operation_id_collision";
    }
    assert(
      cloneCollision,
      "Clone operation ID reuse did not return a typed collision",
    );
    const cloneHistory = listBlockChangeHistory(database, {
      projectId: project.id,
      blockId: exactRetryPageId,
    });
    const exactRetryCloneHistory = cloneHistory.find(
      (entry) => entry.operationId === exactRetryOperationId,
    );
    assert(
      exactRetryCloneHistory?.mutationKind === "page_clone",
      "Clone history is not canonical",
    );
    assert(
      exactRetryCloneHistory.clientSessionId === "clone-first-session" &&
        exactRetryCloneHistory.actor.source === "first-clone-transport",
      "Clone retry replaced first-seen attribution",
    );

    const clonePageId = createUuidV7();
    const clone = cloneAuthoritativePage(database, {
      projectId: project.id,
      sourcePageId: source.id,
      newPageId: clonePageId,
      lifecycle: "active",
      status: "done",
      primaryViewRankKey: `clone:${clonePageId}`,
      propertyOverrides: {
        database: {
          status: "done",
          scheduled_start: "2026-07-20T10:00:00.000Z",
          scheduled_end: "2026-07-20T11:00:00.000Z",
        },
        intrinsic: {
          "recurrence.config": null,
          "reminders.config": [],
        },
      },
      operationId: `page-clone-probe:${clonePageId}`,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    assert(
      clone.documentHeadSeq === 1,
      "Clone genesis did not commit at head 1",
    );
    const clonedPage = await getPage(project.id, clonePageId);
    assert(clonedPage, "Authoritative Page reader could not read the clone");
    assert(
      clonedPage.title === "Current Y.Doc source title",
      "Clone did not read the current Document title",
    );
    assert(
      clonedPage.status === "done",
      "Clone status override was not relational",
    );
    assert(
      clonedPage.priority === "p1-high",
      "Database properties were not copied",
    );
    assert(
      clonedPage.runInBaseBranch === "copied-base-branch",
      "Intrinsic property was not copied",
    );
    assert(
      clonedPage.recurrence === undefined,
      "Recurrence override was not applied",
    );

    const cloneMaterialization = readMaterialization(clone.documentId);
    const sourceIds = new Set(flattenBlockIds(sourceMaterialization.blockTree));
    const cloneIds = flattenBlockIds(cloneMaterialization.blockTree);
    assert(
      cloneIds.every((blockId) => !sourceIds.has(blockId)),
      "Clone reused an ordinary application Block identity",
    );
    assert(
      cloneMaterialization.references.find(
        (reference) => reference.kind === "block",
      )?.targetBlockId === "stable-reference-target",
      "Clone changed the reference target identity",
    );
    assert(
      Object.keys(clone.blockIdMap).length === sourceIds.size,
      "Clone did not publish a complete application identity map",
    );

    const completeOperationId = "occurrence-complete-exact-retry";
    const completedPageId = createUuidV7();
    const completed = await completePageOccurrence(
      project.id,
      {
        operationId: completeOperationId,
        createdPageId: completedPageId,
        pageId: source.id,
        occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
        source: "calendar",
      },
      "complete-first-session",
    );
    assert(completed.success, "Completing an occurrence failed");
    assert(
      completed.createdPageId,
      "Complete did not return its archived Page identity",
    );
    const pageCountAfterComplete = countProjectPageBlocks(project.id);

    closeDatabase();
    await initializeDatabase();
    database = getDb();
    const completedRetry = await completePageOccurrence(
      project.id,
      {
        operationId: completeOperationId,
        createdPageId: completedPageId,
        pageId: source.id,
        occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
        source: "api",
      },
      "complete-retry-session",
    );
    assert(
      completedRetry.success && completedRetry.duplicate,
      "Complete retry was not served from its durable receipt",
    );
    assert(
      completedRetry.createdPageId === completed.createdPageId &&
        completedRetry.changeLogSeq === completed.changeLogSeq,
      "Complete retry did not return the exact first result",
    );
    assert(
      countProjectPageBlocks(project.id) === pageCountAfterComplete,
      "Complete retry cloned a second archive Page",
    );
    const completeCollision = await completePageOccurrence(project.id, {
      operationId: completeOperationId,
      createdPageId: completedPageId,
      pageId: source.id,
      occurrenceStart: new Date("2026-07-13T10:00:00.000Z"),
      source: "notification",
    });
    assert(
      !completeCollision.success &&
        completeCollision.code === "operation_id_collision",
      "Complete operation ID reuse did not return a typed collision",
    );
    const completeKindCollision = await skipPageOccurrence(project.id, {
      operationId: completeOperationId,
      pageId: source.id,
      occurrenceStart: new Date("2026-07-12T10:00:00.000Z"),
      source: "api",
    });
    assert(
      !completeKindCollision.success &&
        completeKindCollision.code === "operation_id_collision",
      "Occurrence operation ID reuse across semantics did not collide",
    );
    const advancedSource = await getPage(project.id, source.id);
    assert(
      advancedSource?.scheduledStart?.toISOString() ===
        "2026-07-13T10:00:00.000Z",
      "Complete did not advance the relational source schedule",
    );
    const archive = database
      .prepare("SELECT id FROM blocks WHERE id = ? AND lifecycle = 'archived'")
      .get(completed.createdPageId) as { readonly id: string } | undefined;
    assert(archive, "Complete did not create an archived Page Block");
    const archivedPage = await getPage(project.id, archive.id);
    assert(
      archivedPage?.title === "Current Y.Doc source title" &&
        archivedPage.recurrence === undefined,
      "Complete archive did not clone current content with recurrence cleared",
    );
    const completeHistory = listBlockChangeHistory(database, {
      projectId: project.id,
      blockId: source.id,
    }).find((entry) => entry.operationId === completeOperationId);
    assert(
      completeHistory?.mutationKind === "page_occurrence_complete",
      "Complete did not enter canonical Block history",
    );
    assert(
      completeHistory.clientSessionId === "complete-first-session" &&
        completeHistory.actor.source === "calendar",
      "Complete retry replaced first-seen attribution",
    );

    const splitOperationId = "occurrence-update-split-exact-retry";
    const splitRequest = {
      operationId: splitOperationId,
      createdPageId: createUuidV7(),
      pageId: source.id,
      occurrenceStart: new Date("2026-07-15T10:00:00.000Z"),
      source: "calendar" as const,
      scope: "this-and-future" as const,
      updates: {
        scheduledStart: new Date("2026-07-15T12:00:00.000Z"),
        scheduledEnd: new Date("2026-07-15T13:00:00.000Z"),
      },
    };
    const split = await updatePageOccurrence(
      project.id,
      splitRequest,
      "split-first-session",
    );
    assert(split.success, "Splitting a recurring series failed");
    assert(
      split.createdPageId,
      "Split did not return its future Page identity",
    );
    const pageCountAfterSplit = countProjectPageBlocks(project.id);

    closeDatabase();
    await initializeDatabase();
    database = getDb();
    const splitRetry = await updatePageOccurrence(
      project.id,
      { ...splitRequest, source: "api" },
      "split-retry-session",
    );
    assert(
      splitRetry.success && splitRetry.duplicate,
      "Split retry was not served from its durable receipt",
    );
    assert(
      splitRetry.createdPageId === split.createdPageId &&
        splitRetry.changeLogSeq === split.changeLogSeq,
      "Split retry did not return the exact first result",
    );
    assert(
      countProjectPageBlocks(project.id) === pageCountAfterSplit,
      "Split retry cloned a second future Page",
    );
    const splitRow = database
      .prepare(
        `
        SELECT block.id
        FROM blocks block
        INNER JOIN scheduled_card_index schedule
          ON schedule.card_block_id = block.id
          AND schedule.project_id = block.project_id
        WHERE block.project_id = ? AND block.type = 'page'
          AND block.lifecycle = 'active'
          AND block.id = ?
          AND schedule.scheduled_start = '2026-07-15T12:00:00.000Z'
        LIMIT 1
      `,
      )
      .get(project.id, split.createdPageId) as
      { readonly id: string } | undefined;
    assert(splitRow, "Split did not create the future Page Block");
    const splitPage = await getPage(project.id, splitRow.id);
    assert(
      splitPage?.title === "Current Y.Doc source title" &&
        splitPage.scheduledStart?.toISOString() === "2026-07-15T12:00:00.000Z",
      "Split Page did not combine current Document content and relational schedule",
    );
    const splitHistory = listBlockChangeHistory(database, {
      projectId: project.id,
      blockId: source.id,
    }).find((entry) => entry.operationId === splitOperationId);
    assert(
      splitHistory?.mutationKind === "page_occurrence_update",
      "Split did not enter canonical Block history",
    );
    assert(
      splitHistory.clientSessionId === "split-first-session" &&
        splitHistory.actor.source === "calendar",
      "Split retry replaced first-seen attribution",
    );
    const skipOperationId = "occurrence-skip-exact-retry";
    database.exec(`
      CREATE TEMP TRIGGER reject_occurrence_receipt_probe
      BEFORE INSERT ON block_mutations
      WHEN NEW.mutation_id = '${skipOperationId}'
      BEGIN
        SELECT RAISE(ABORT, 'fault-before-occurrence-receipt');
      END;
    `);
    let occurrenceFaultRolledBack = false;
    try {
      await skipPageOccurrence(
        project.id,
        {
          operationId: skipOperationId,
          pageId: splitRow.id,
          occurrenceStart: new Date("2026-07-15T12:00:00.000Z"),
          source: "calendar",
        },
        "skip-first-session",
      );
    } catch (error) {
      occurrenceFaultRolledBack = (error as Error).message.includes(
        "fault-before-occurrence-receipt",
      );
    } finally {
      database.exec("DROP TRIGGER IF EXISTS reject_occurrence_receipt_probe");
    }
    assert(
      occurrenceFaultRolledBack,
      "Occurrence receipt fault was not injected",
    );
    const afterFailedSkip = await getPage(project.id, splitRow.id);
    assert(
      afterFailedSkip?.scheduledStart?.toISOString() ===
        "2026-07-15T12:00:00.000Z",
      "Occurrence fault did not roll back the source schedule",
    );
    assert(
      !database
        .prepare(
          "SELECT 1 FROM recurrence_exceptions WHERE project_id = ? AND card_id = ?",
        )
        .get(project.id, splitRow.id),
      "Occurrence fault leaked its recurrence exception",
    );
    assert(
      !database
        .prepare("SELECT 1 FROM block_mutations WHERE mutation_id = ?")
        .get(skipOperationId),
      "Occurrence fault leaked its durable receipt",
    );

    const skippedSplit = await skipPageOccurrence(
      project.id,
      {
        operationId: skipOperationId,
        pageId: splitRow.id,
        occurrenceStart: new Date("2026-07-15T12:00:00.000Z"),
        source: "calendar",
      },
      "skip-first-session",
    );
    assert(
      skippedSplit.success,
      "A Block-only recurring Page could not persist its exception",
    );
    const splitAfterSkip = await getPage(project.id, splitRow.id);
    assert(
      splitAfterSkip?.scheduledStart?.toISOString() ===
        "2026-07-16T12:00:00.000Z",
      "Skip did not advance the Block-only recurring Page once",
    );

    closeDatabase();
    await initializeDatabase();
    database = getDb();
    const skippedSplitRetry = await skipPageOccurrence(
      project.id,
      {
        operationId: skipOperationId,
        pageId: splitRow.id,
        occurrenceStart: new Date("2026-07-15T12:00:00.000Z"),
        source: "api",
      },
      "skip-retry-session",
    );
    assert(
      skippedSplitRetry.success && skippedSplitRetry.duplicate,
      "Skip retry was not served from its durable receipt",
    );
    assert(
      skippedSplitRetry.changeLogSeq === skippedSplit.changeLogSeq,
      "Skip retry did not return the exact first result",
    );
    const splitAfterSkipRetry = await getPage(project.id, splitRow.id);
    assert(
      splitAfterSkipRetry?.scheduledStart?.toISOString() ===
        "2026-07-16T12:00:00.000Z",
      "Skip retry advanced the schedule twice",
    );
    assert(
      Boolean(
        database
          .prepare(
            `
            SELECT 1
            FROM recurrence_exceptions
            WHERE project_id = ? AND card_id = ?
              AND occurrence_start = '2026-07-15T12:00:00.000Z'
          `,
          )
          .get(project.id, splitRow.id),
      ),
      "Recurrence exception did not reference the Page Block",
    );
    const skipHistory = listBlockChangeHistory(database, {
      projectId: project.id,
      blockId: splitRow.id,
    }).find((entry) => entry.operationId === skipOperationId);
    assert(
      skipHistory?.mutationKind === "page_occurrence_skip",
      "Skip did not enter canonical Block history",
    );
    assert(
      skipHistory.clientSessionId === "skip-first-session" &&
        skipHistory.actor.source === "calendar",
      "Skip retry replaced first-seen attribution",
    );
    const calendar = await listPageOccurrences(
      project.id,
      new Date("2026-07-13T00:00:00.000Z"),
      new Date("2026-07-17T00:00:00.000Z"),
    );
    assert(
      calendar.some(
        (occurrence) =>
          occurrence.pageId === splitRow.id &&
          occurrence.title === "Current Y.Doc source title",
      ),
      "Calendar did not read the split Page through schedule/Document authority",
    );

    closeDatabase();
    await initializeDatabase();
    const restarted = await getPage(project.id, clonePageId);
    assert(
      restarted?.title === "Current Y.Doc source title",
      "Clone did not survive restart from SQLite authority",
    );
    assert(
      readMaterialization(clone.documentId).references.find(
        (reference) => reference.kind === "block",
      )?.targetBlockId === "stable-reference-target",
      "Restart changed the cloned reference target",
    );

    process.stdout.write(
      `${JSON.stringify({
        faultPoints: faultPoints.length,
        noLegacyPageDependency: true,
        freshDocumentContent: true,
        copiedRelationalProperties: true,
        regeneratedBlockIds: true,
        stableReferenceTarget: true,
        recurrenceWritesAuthoritative: true,
        exactRetryAcrossRestart: ["clone", "complete", "update", "skip"],
        exactRejectedReceipt: ["not_found", "not_scheduled", "invalid_update"],
        typedOperationCollision: true,
        canonicalHistoryVisible: true,
        firstSeenAttributionPreserved: true,
        occurrenceFaultRollback: true,
        restartDurable: true,
        behaviorRecordsReferenceBlocks: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
