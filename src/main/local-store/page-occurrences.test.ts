import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  PageInput,
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
} from "../../shared/types";
import { createUuidV7 } from "../../shared/uuid-v7";
import type { PortableRichText } from "../../shared/block-documents";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { listBlockChangeHistory } from "./document-versions";
import { readDatabasePageById } from "./page-read-store";
import { createPageLifecycleV2Fixture } from "./page-lifecycle-v2-test-fixture";
import { createProject } from "./projects";
import { putProjectResourceGrantInDatabase } from "./project-resource-grants";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { executeReadOnlyQuery } from "./sql-inspection";
import {
  completePageOccurrence as completeStoredPageOccurrence,
  listPageOccurrences,
  skipPageOccurrence as skipStoredPageOccurrence,
  updatePageOccurrence as updateStoredPageOccurrence,
} from "./page-occurrences";

type TestOccurrenceComplete = Omit<
  PageOccurrenceCompleteInput,
  "operationId" | "createdPageId"
> & {
  readonly operationId?: string;
  readonly createdPageId?: string;
};
type TestOccurrenceAction = Omit<PageOccurrenceActionInput, "operationId"> & {
  readonly operationId?: string;
};
type TestOccurrenceUpdate = Omit<
  PageOccurrenceUpdateInput,
  "operationId" | "createdPageId"
> & {
  readonly operationId?: string;
  readonly createdPageId?: string;
};

let testOperationSequence = 0;

const nextTestOperationId = (): string =>
  `page-occurrence-test:${++testOperationSequence}`;

const completePageOccurrence = (
  targetProjectId: string,
  input: TestOccurrenceComplete,
  sessionId?: string,
) =>
  completeStoredPageOccurrence(
    targetProjectId,
    {
      ...input,
      operationId: input.operationId ?? nextTestOperationId(),
      createdPageId: input.createdPageId ?? createUuidV7(),
    },
    sessionId,
  );

const skipPageOccurrence = (
  targetProjectId: string,
  input: TestOccurrenceAction,
  sessionId?: string,
) =>
  skipStoredPageOccurrence(
    targetProjectId,
    { ...input, operationId: input.operationId ?? nextTestOperationId() },
    sessionId,
  );

const updatePageOccurrence = (
  targetProjectId: string,
  input: TestOccurrenceUpdate,
  sessionId?: string,
) => {
  const operationId = input.operationId ?? nextTestOperationId();
  if (input.scope === "all") {
    return updateStoredPageOccurrence(
      targetProjectId,
      {
        operationId,
        pageId: input.pageId,
        occurrenceStart: input.occurrenceStart,
        source: input.source,
        scope: "all",
        updates: input.updates,
      },
      sessionId,
    );
  }
  return updateStoredPageOccurrence(
    targetProjectId,
    {
      ...input,
      operationId,
      createdPageId: input.createdPageId ?? createUuidV7(),
    } as PageOccurrenceUpdateInput,
    sessionId,
  );
};

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

let projectId = "";

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-occurrence-actions-"));
  process.env.NODEX_HOME = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_HOME;
      return false;
    }
    throw error;
  }

  projectId = createProject({ name: "Default" }).id;

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_HOME;
  }
}

function toIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function recurringInput(startIso: string, endIso: string): PageInput {
  return {
    title: "Recurring event",
    scheduledStart: new Date(startIso),
    scheduledEnd: new Date(endIso),
    recurrence: {
      frequency: "daily",
      interval: 1,
      endCondition: { type: "never" },
    },
    reminders: [{ offsetMinutes: 10 }],
    scheduleTimezone: "UTC",
  };
}

function allDayInput(startIso: string, endIso: string): PageInput {
  return {
    title: "All-day event",
    scheduledStart: new Date(startIso),
    scheduledEnd: new Date(endIso),
    isAllDay: true,
  };
}

async function createCard(targetProjectId: string, status: "build", input: PageInput) {
  const database = getDb();
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Card fixture has no Block store epoch");
  const pageId = createUuidV7();
  createPageLifecycleV2Fixture(database, {
    operationId: `occurrence-fixture:create:${pageId}`,
    projectId: targetProjectId,
    storeEpoch,
    actor: { kind: "test" },
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
  });
  const primary = readDatabasePageById(database, targetProjectId, pageId);
  if (!primary) throw new Error("Authoritative Card disappeared after creation");
  return primary;
}

const getCard = (targetProjectId: string, pageId: string) =>
  readDatabasePageById(getDb(), targetProjectId, pageId);

function recurringInputWithUntilDate(startIso: string, endIso: string, untilDate: string): PageInput {
  return {
    title: "Recurring event",
    scheduledStart: new Date(startIso),
    scheduledEnd: new Date(endIso),
    recurrence: {
      frequency: "daily",
      interval: 1,
      endCondition: { type: "untilDate", untilDate },
    },
    reminders: [{ offsetMinutes: 10 }],
    scheduleTimezone: "UTC",
  };
}

function authorityRows(lifecycle: "active" | "archived", status: "build" | "ship") {
  return executeReadOnlyQuery(
    `SELECT block.id,
            schedule.scheduled_start,
            schedule.scheduled_end,
            schedule.recurrence_json,
            schedule.reminders_json
     FROM blocks block
     INNER JOIN data_source_page_memberships membership
       ON membership.page_block_id = block.id
       AND membership.removed_at IS NULL
     INNER JOIN data_source_property_values status_value
       ON status_value.membership_id = membership.id
       AND status_value.data_source_id = membership.data_source_id
       AND status_value.property_id = 'status'
     LEFT JOIN scheduled_page_index schedule
       ON schedule.page_block_id = block.id
       AND schedule.project_id = block.project_id
     WHERE block.project_id = ? AND block.type = 'page'
       AND block.lifecycle = ? AND status_value.value_json = json_quote(?)
     ORDER BY block.created_at DESC, block.id DESC`,
    [projectId, lifecycle, status],
  ).rows;
}

function archiveRows() {
  return authorityRows("archived", "ship");
}

describe("occurrence actions", () => {
  test("done on recurring current occurrence creates archive card and advances master", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));

      const result = await completePageOccurrence(
        projectId,
        {
          pageId: card.id,
          occurrenceStart: new Date(startIso),
          source: "calendar",
        },
        "session-recurring-current",
      );

      expect(result.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe("2026-03-02T10:00:00.000Z");
      expect(master?.scheduledEnd?.toISOString()).toBe("2026-03-02T11:00:00.000Z");

      const archives = archiveRows();
      expect(archives.length).toBe(1);
      expect(toIso(archives[0]?.scheduled_start)).toBe(startIso);
      expect(toIso(archives[0]?.scheduled_end)).toBe(endIso);
      expect(archives[0]?.recurrence_json).toBe("null");
      expect(archives[0]?.reminders_json).toBe("[]");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("done on recurring future occurrence creates archive card and skip exception without advancing master", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const futureIso = "2026-03-05T10:00:00.000Z";
      const futureEndIso = "2026-03-05T11:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));

      const result = await completePageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(futureIso),
        source: "calendar",
      });

      expect(result.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe(startIso);
      expect(master?.scheduledEnd?.toISOString()).toBe(endIso);

      const archives = archiveRows();
      expect(archives.length).toBe(1);
      expect(toIso(archives[0]?.scheduled_start)).toBe(futureIso);
      expect(toIso(archives[0]?.scheduled_end)).toBe(futureEndIso);

      const exceptions = executeReadOnlyQuery(
        `SELECT exception_type, occurrence_start
         FROM recurrence_exceptions
         WHERE project_id = ? AND page_id = ?`,
        [projectId, card.id],
      ).rows;
      expect(exceptions.length).toBe(1);
      expect(exceptions[0]?.exception_type).toBe("skip");
      expect(toIso(exceptions[0]?.occurrence_start)).toBe(futureIso);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("done on one-time occurrence creates archive card and unschedules master", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const card = await createCard(projectId, "build", {
        title: "One-time event",
        scheduledStart: new Date(startIso),
        scheduledEnd: new Date(endIso),
      });

      const result = await completePageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
      });

      expect(result.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart).toBe(undefined);
      expect(master?.scheduledEnd).toBe(undefined);

      const archives = archiveRows();
      expect(archives.length).toBe(1);
      expect(toIso(archives[0]?.scheduled_start)).toBe(startIso);
      expect(toIso(archives[0]?.scheduled_end)).toBe(endIso);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("skip occurrence does not create archive card", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));

      const result = await skipPageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
      });

      expect(result.success).toBe(true);

      const archives = archiveRows();
      expect(archives.length).toBe(0);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("scope this detaches targeted occurrence into a standalone card and skips the series occurrence", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const detachedStartIso = "2026-03-01T12:00:00.000Z";
      const detachedEndIso = "2026-03-01T13:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));
      const database = getDb();
      const richHead = database
        .prepare(
          `SELECT ownership.document_id, document.generation, document.head_seq
           FROM block_documents ownership
           JOIN documents document ON document.id = ownership.document_id
           WHERE ownership.block_id = ?`,
        )
        .get(card.id) as {
        readonly document_id: string;
        readonly generation: number;
        readonly head_seq: number;
      };
      const storeEpoch = readBlockStoreEpoch(database);
      if (!storeEpoch) throw new Error("Card fixture has no Block store epoch");
      const richTitle = [
        {
          type: "text" as const,
          text: "Recurring ",
          styles: { bold: true },
        },
        {
          type: "link" as const,
          text: "event",
          href: "https://nodex.local/recurrence",
          styles: {},
        },
      ] satisfies PortableRichText;
      const titleUpdate = applyDocumentOperationBatch(
        database,
        {
          version: 1,
          mutationId: "occurrence-fixture:rich-title",
          projectId,
          storeEpoch,
          actor: { kind: "test" },
          documentId: richHead.document_id,
          generation: richHead.generation,
          expectedHeadSeq: richHead.head_seq,
          operations: [{ kind: "set_rich_title", richTitle }],
        },
        {
          writeFence: {
            leaseId: "occurrence-fixture:rich-title:lease",
            documentId: richHead.document_id,
            generation: richHead.generation,
            headSeq: richHead.head_seq,
          },
        },
      );
      expect(titleUpdate.ok).toBe(true);
      const createdPageId = createUuidV7();

      const result = await updatePageOccurrence(projectId, {
        createdPageId,
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
        scope: "this",
        updates: {
          scheduledStart: new Date(detachedStartIso),
          scheduledEnd: new Date(detachedEndIso),
        },
      });
      expect(result.success).toBe(true);
      expect(result.createdPageId).toBe(createdPageId);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe(startIso);
      expect(master?.scheduledEnd?.toISOString()).toBe(endIso);

      const exceptions = executeReadOnlyQuery(
        `SELECT exception_type, occurrence_start, override_start, override_end
         FROM recurrence_exceptions
         WHERE project_id = ? AND page_id = ?`,
        [projectId, card.id],
      ).rows;
      expect(exceptions.length).toBe(1);
      expect(exceptions[0]?.exception_type).toBe("skip");
      expect(toIso(exceptions[0]?.occurrence_start)).toBe(startIso);
      expect(exceptions[0]?.override_start).toBe(null);
      expect(exceptions[0]?.override_end).toBe(null);

      const rows = authorityRows("active", "build");
      expect(rows.length).toBe(2);
      const detachedRow = rows.find((row) => row.id !== card.id);
      expect(detachedRow?.id).toBe(createdPageId);
      expect(toIso(detachedRow?.scheduled_start)).toBe(detachedStartIso);
      expect(toIso(detachedRow?.scheduled_end)).toBe(detachedEndIso);
      expect(detachedRow?.recurrence_json).toBe("null");
      expect((await getCard(projectId, createdPageId))?.richTitle).toEqual(
        richTitle,
      );

      const occurrences = await listPageOccurrences(
        projectId,
        new Date("2026-03-01T00:00:00.000Z"),
        new Date("2026-03-03T00:00:00.000Z"),
      );
      expect(occurrences.length).toBe(2);
      expect(occurrences[0]?.scheduledStart?.toISOString()).toBe(detachedStartIso);
      expect(occurrences[0]?.scheduledEnd?.toISOString()).toBe(detachedEndIso);
      expect(occurrences[0]?.isRecurring).toBe(false);
      expect(occurrences[0]?.thisAndFutureEquivalentToAll).toBe(false);
      expect(occurrences[1]?.scheduledStart?.toISOString()).toBe("2026-03-02T10:00:00.000Z");
      expect(occurrences[1]?.scheduledEnd?.toISOString()).toBe("2026-03-02T11:00:00.000Z");
      expect(occurrences[1]?.isRecurring).toBe(true);
      expect(occurrences[1]?.thisAndFutureEquivalentToAll).toBe(false);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("calendar occurrences flag first recurring instance when this-and-future equals all", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));

      const occurrences = await listPageOccurrences(
        projectId,
        new Date("2026-03-01T00:00:00.000Z"),
        new Date("2026-03-04T00:00:00.000Z"),
      );

      const first = occurrences.find((occurrence) => occurrence.pageId === card.id);
      const second = occurrences.find(
        (occurrence) =>
          occurrence.pageId === card.id && occurrence.occurrenceStart.toISOString() === "2026-03-02T10:00:00.000Z",
      );

      expect(first?.occurrenceStart.toISOString()).toBe(startIso);
      expect(first?.thisAndFutureEquivalentToAll).toBe(true);
      expect(second?.thisAndFutureEquivalentToAll).toBe(false);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("detached occurrences preserve absent manual View participation", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const card = await createCard(
        projectId,
        "build",
        recurringInput(startIso, endIso),
      );
      const database = getDb();
      database
        .prepare("DELETE FROM database_view_page_positions WHERE page_block_id = ?")
        .run(card.id);
      const createdPageId = createUuidV7();

      const result = await updatePageOccurrence(projectId, {
        createdPageId,
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
        scope: "this",
        updates: {
          scheduledStart: new Date("2026-03-01T12:00:00.000Z"),
          scheduledEnd: new Date("2026-03-01T13:00:00.000Z"),
        },
      });

      expect(result.success).toBe(true);
      expect((await getCard(projectId, createdPageId))?.order).toBe(
        Number.MAX_SAFE_INTEGER,
      );
      expect(
        database
          .prepare(
            "SELECT COUNT(*) FROM database_view_page_positions WHERE page_block_id = ?",
          )
          .pluck()
          .get(createdPageId),
      ).toBe(0);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("calendar occurrences return explicit all-day flag", async () => {
    const ran = await withTempDatabase(async () => {
      await createCard(projectId, "build", allDayInput("2026-03-10T00:00:00.000Z", "2026-03-11T00:00:00.000Z"));

      const occurrences = await listPageOccurrences(
        projectId,
        new Date("2026-03-09T00:00:00.000Z"),
        new Date("2026-03-12T00:00:00.000Z"),
      );

      expect(occurrences.length).toBe(1);
      expect(occurrences[0]?.isAllDay).toBe(true);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("scope this-and-future splits recurring series into a new card", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const splitOccurrenceIso = "2026-03-03T10:00:00.000Z";
      const splitStartIso = "2026-03-03T15:00:00.000Z";
      const splitEndIso = "2026-03-03T16:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));
      const createdPageId = createUuidV7();

      const result = await updatePageOccurrence(projectId, {
        createdPageId,
        pageId: card.id,
        occurrenceStart: new Date(splitOccurrenceIso),
        source: "calendar",
        scope: "this-and-future",
        updates: {
          scheduledStart: new Date(splitStartIso),
          scheduledEnd: new Date(splitEndIso),
        },
      });
      expect(result.success).toBe(true);
      expect(result.createdPageId).toBe(createdPageId);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe(startIso);
      expect(master?.scheduledEnd?.toISOString()).toBe(endIso);
      expect(master?.recurrence?.endCondition?.type).toBe("untilDate");
      if (master?.recurrence?.endCondition?.type === "untilDate") {
        expect(master.recurrence.endCondition.untilDate).toBe("2026-03-02");
      }

      const rows = authorityRows("active", "build");
      expect(rows.length).toBe(2);

      const splitRow = rows.find((row) => row.id !== card.id);
      expect(splitRow?.id).toBe(createdPageId);
      expect(toIso(splitRow?.scheduled_start)).toBe(splitStartIso);
      expect(toIso(splitRow?.scheduled_end)).toBe(splitEndIso);
      const splitRecurrence =
        typeof splitRow?.recurrence_json === "string" ? JSON.parse(splitRow.recurrence_json) : null;
      expect(splitRecurrence?.frequency).toBe("daily");
      expect(splitRecurrence?.interval).toBe(1);

      const exceptions = executeReadOnlyQuery(
        `SELECT * FROM recurrence_exceptions WHERE project_id = ? AND page_id = ?`,
        [projectId, card.id],
      ).rows;
      expect(exceptions.length).toBe(0);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("scope this-and-future on first occurrence is equivalent to all (no split)", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const updatedStartIso = "2026-03-01T14:00:00.000Z";
      const updatedEndIso = "2026-03-01T15:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));

      const result = await updatePageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
        scope: "this-and-future",
        updates: {
          scheduledStart: new Date(updatedStartIso),
          scheduledEnd: new Date(updatedEndIso),
        },
      });
      expect(result.success).toBe(true);

      const rows = authorityRows("active", "build");
      expect(rows.length).toBe(1);
      expect(rows[0]?.id).toBe(card.id);
      expect(toIso(rows[0]?.scheduled_start)).toBe(updatedStartIso);
      expect(toIso(rows[0]?.scheduled_end)).toBe(updatedEndIso);
      const recurrence = typeof rows[0]?.recurrence_json === "string" ? JSON.parse(rows[0].recurrence_json) : null;
      expect(recurrence?.frequency).toBe("daily");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("scope all updates recurring master schedule directly", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const allStartIso = "2026-03-01T14:00:00.000Z";
      const allEndIso = "2026-03-01T15:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));

      const result = await updatePageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
        scope: "all",
        updates: {
          scheduledStart: new Date(allStartIso),
          scheduledEnd: new Date(allEndIso),
        },
      });
      expect(result.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe(allStartIso);
      expect(master?.scheduledEnd?.toISOString()).toBe(allEndIso);
      expect(master?.recurrence?.frequency).toBe("daily");

      const exceptions = executeReadOnlyQuery(
        `SELECT * FROM recurrence_exceptions WHERE project_id = ? AND page_id = ?`,
        [projectId, card.id],
      ).rows;
      expect(exceptions.length).toBe(0);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("scope all drag-shift moves recurrence untilDate by the same day delta", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const shiftedStartIso = "2026-03-03T10:00:00.000Z";
      const shiftedEndIso = "2026-03-03T11:00:00.000Z";
      const card = await createCard(
        projectId,
        "build",
        recurringInputWithUntilDate(startIso, endIso, "2026-03-10"),
      );

      const result = await updatePageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
        scope: "all",
        updates: {
          scheduledStart: new Date(shiftedStartIso),
          scheduledEnd: new Date(shiftedEndIso),
        },
      });
      expect(result.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe(shiftedStartIso);
      expect(master?.scheduledEnd?.toISOString()).toBe(shiftedEndIso);
      if (master?.recurrence?.endCondition?.type === "untilDate") {
        expect(master.recurrence.endCondition.untilDate).toBe("2026-03-12");
      }
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("scope this-and-future drag-shift moves future split untilDate by the same day delta", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const splitOccurrenceIso = "2026-03-05T10:00:00.000Z";
      const shiftedSplitStartIso = "2026-03-07T10:00:00.000Z";
      const shiftedSplitEndIso = "2026-03-07T11:00:00.000Z";
      const card = await createCard(
        projectId,
        "build",
        recurringInputWithUntilDate(startIso, endIso, "2026-03-10"),
      );

      const result = await updatePageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(splitOccurrenceIso),
        source: "calendar",
        scope: "this-and-future",
        updates: {
          scheduledStart: new Date(shiftedSplitStartIso),
          scheduledEnd: new Date(shiftedSplitEndIso),
        },
      });
      expect(result.success).toBe(true);

      const rows = authorityRows("active", "build");
      expect(rows.length).toBe(2);

      const oldRow = rows.find((row) => row.id === card.id);
      const splitRow = rows.find((row) => row.id !== card.id);
      const oldRecurrence = typeof oldRow?.recurrence_json === "string" ? JSON.parse(oldRow.recurrence_json) : null;
      const newRecurrence = typeof splitRow?.recurrence_json === "string" ? JSON.parse(splitRow.recurrence_json) : null;

      expect(oldRecurrence?.endCondition?.untilDate).toBe("2026-03-04");
      expect(newRecurrence?.endCondition?.untilDate).toBe("2026-03-12");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("complete uses only Block authorities for a lifecycle-created Card", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const card = await createCard(projectId, "build", recurringInput(startIso, endIso));

      const completeResult = await completePageOccurrence(projectId, {
        pageId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
      });
      expect(completeResult.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe("2026-03-02T10:00:00.000Z");
      expect(archiveRows().length).toBe(1);
      const archiveId = archiveRows()[0]?.id;
      expect(typeof archiveId).toBe("string");
      if (typeof archiveId !== "string") {
        throw new Error("Completed occurrence has no archived Card identity");
      }
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("complete exact-retries across restart without cloning twice and preserves first attribution", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const operationId = "occurrence-complete-restart-test";
      const createdPageId = createUuidV7();
      const card = await createCard(
        projectId,
        "build",
        recurringInput(startIso, endIso),
      );

      const first = await completePageOccurrence(
        projectId,
        {
          operationId,
          createdPageId,
          pageId: card.id,
          occurrenceStart: new Date(startIso),
          source: "calendar",
        },
        "first-session",
      );
      expect(first.success).toBe(true);
      expect(first.duplicate).toBe(false);
      const countAfterFirst = executeReadOnlyQuery(
        "SELECT COUNT(*) AS count FROM blocks WHERE project_id = ? AND type = 'page'",
        [projectId],
      ).rows[0]?.count;

      closeDatabase();
      await initializeDatabase();
      const retry = await completePageOccurrence(
        projectId,
        {
          operationId,
          createdPageId,
          pageId: card.id,
          occurrenceStart: new Date(startIso),
          source: "api",
        },
        "retry-session",
      );
      expect(retry.success).toBe(true);
      expect(retry.duplicate).toBe(true);
      expect(retry.createdPageId).toBe(first.createdPageId);
      expect(retry.createdPageId).toBe(createdPageId);
      expect(retry.changeLogSeq).toBe(first.changeLogSeq);
      expect(
        executeReadOnlyQuery(
          "SELECT COUNT(*) AS count FROM blocks WHERE project_id = ? AND type = 'page'",
          [projectId],
        ).rows[0]?.count,
      ).toBe(countAfterFirst);

      const collision = await completePageOccurrence(projectId, {
        operationId,
        createdPageId: createUuidV7(),
        pageId: card.id,
        occurrenceStart: new Date("2026-03-02T10:00:00.000Z"),
        source: "notification",
      });
      expect(collision.success).toBe(false);
      expect(collision.code).toBe("operation_id_collision");

      const history = listBlockChangeHistory(getDb(), {
        projectId,
        blockId: card.id,
      }).find((entry) => entry.operationId === operationId);
      expect(history?.mutationKind).toBe("page_occurrence_complete");
      expect(history?.clientSessionId).toBe("first-session");
      expect(history?.actor.source).toBe("calendar");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("precondition rejection is durable, exact-retryable, and has no change cursor", async () => {
    const ran = await withTempDatabase(async () => {
      const operationId = "occurrence-rejected-restart-test";
      const missingCardId = "019bc123-4567-7000-8000-000000000001";
      const createdPageId = createUuidV7();
      const first = await completePageOccurrence(
        projectId,
        {
          operationId,
          createdPageId,
          pageId: missingCardId,
          occurrenceStart: new Date("2026-03-01T10:00:00.000Z"),
          source: "calendar",
        },
        "rejected-first-session",
      );
      expect(first.success).toBe(false);
      expect(first.duplicate).toBe(false);
      expect(first.code).toBe("page_not_found");
      const ledger = executeReadOnlyQuery(
        `SELECT outcome, change_log_seq
         FROM block_mutations
         WHERE mutation_id = ?`,
        [operationId],
      ).rows[0];
      expect(ledger?.outcome).toBe("rejected");
      expect(ledger?.change_log_seq).toBe(null);
      expect(
        executeReadOnlyQuery(
          "SELECT COUNT(*) AS count FROM change_log WHERE operation_id = ?",
          [operationId],
        ).rows[0]?.count,
      ).toBe(0);

      closeDatabase();
      await initializeDatabase();
      const retry = await completePageOccurrence(
        projectId,
        {
          operationId,
          createdPageId,
          pageId: missingCardId,
          occurrenceStart: new Date("2026-03-01T10:00:00.000Z"),
          source: "api",
        },
        "rejected-retry-session",
      );
      expect(retry.success).toBe(false);
      expect(retry.duplicate).toBe(true);
      expect(retry.code).toBe(first.code);
      expect(retry.error).toBe(first.error);

      const collision = await skipPageOccurrence(projectId, {
        operationId,
        pageId: missingCardId,
        occurrenceStart: new Date("2026-03-01T10:00:00.000Z"),
        source: "notification",
      });
      expect(collision.success).toBe(false);
      expect(collision.code).toBe("operation_id_collision");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("durably rejects a non-v7 created Card identity", async () => {
    const ran = await withTempDatabase(async () => {
      const operationId = "occurrence-invalid-created-uuid-v7";
      const card = await createCard(
        projectId,
        "build",
        recurringInput(
          "2026-03-01T10:00:00.000Z",
          "2026-03-01T11:00:00.000Z",
        ),
      );
      const command = {
        operationId,
        createdPageId: crypto.randomUUID(),
        pageId: card.id,
        occurrenceStart: new Date("2026-03-01T10:00:00.000Z"),
        source: "calendar" as const,
      };

      const first = await completeStoredPageOccurrence(projectId, command);
      expect(first.success).toBe(false);
      expect(first.duplicate).toBe(false);
      expect(first.code).toBe("invalid_occurrence_request");

      const retry = await completeStoredPageOccurrence(projectId, {
        ...command,
        source: "api",
      });
      expect(retry.success).toBe(false);
      expect(retry.duplicate).toBe(true);
      expect(retry.code).toBe("invalid_occurrence_request");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("durably rejects a created Card identity for scope all", async () => {
    const ran = await withTempDatabase(async () => {
      const operationId = "occurrence-all-rejects-created-uuid-v7";
      const card = await createCard(
        projectId,
        "build",
        recurringInput(
          "2026-03-01T10:00:00.000Z",
          "2026-03-01T11:00:00.000Z",
        ),
      );
      const invalidCommand = {
        operationId,
        createdPageId: createUuidV7(),
        pageId: card.id,
        occurrenceStart: new Date("2026-03-01T10:00:00.000Z"),
        source: "calendar" as const,
        scope: "all" as const,
        updates: { title: "Updated" },
      } as unknown as PageOccurrenceUpdateInput;

      const first = await updateStoredPageOccurrence(projectId, invalidCommand);
      expect(first.success).toBe(false);
      expect(first.duplicate).toBe(false);
      expect(first.code).toBe("invalid_occurrence_request");

      const retry = await updateStoredPageOccurrence(projectId, invalidCommand);
      expect(retry.success).toBe(false);
      expect(retry.duplicate).toBe(true);
      expect(retry.code).toBe("invalid_occurrence_request");
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("discovers granted Library Pages while reserving structural occurrence mutations for the bound Project", async () => {
    const ran = await withTempDatabase(async () => {
      const ownerProjectId = projectId;
      const grantee = createProject({ name: "Granted calendar worker" });
      const start = new Date("2026-03-01T10:00:00.000Z");
      const end = new Date("2026-03-01T11:00:00.000Z");
      const page = await createCard(
        ownerProjectId,
        "build",
        recurringInput(start.toISOString(), end.toISOString()),
      );

      expect(
        await listPageOccurrences(
          grantee.id,
          new Date("2026-03-01T00:00:00.000Z"),
          new Date("2026-03-03T00:00:00.000Z"),
        ),
      ).toHaveLength(0);

      putProjectResourceGrantInDatabase(getDb(), {
        projectId: grantee.id,
        root: { kind: "page", pageId: page.id },
        access: "read",
      });
      const readable = await listPageOccurrences(
        grantee.id,
        new Date("2026-03-01T00:00:00.000Z"),
        new Date("2026-03-03T00:00:00.000Z"),
      );
      expect(readable.map((occurrence) => occurrence.pageId)).toEqual([
        page.id,
        page.id,
      ]);

      const readOnlyUpdate = await updatePageOccurrence(grantee.id, {
        pageId: page.id,
        occurrenceStart: start,
        source: "api",
        scope: "all",
        updates: { scheduledEnd: new Date("2026-03-01T11:30:00.000Z") },
      });
      expect(readOnlyUpdate).toMatchObject({
        success: false,
        code: "authorization_denied",
      });

      putProjectResourceGrantInDatabase(getDb(), {
        projectId: grantee.id,
        root: { kind: "page", pageId: page.id },
        access: "read_write",
      });
      const writableUpdate = await updatePageOccurrence(grantee.id, {
        pageId: page.id,
        occurrenceStart: start,
        source: "api",
        scope: "all",
        updates: { scheduledEnd: new Date("2026-03-01T12:00:00.000Z") },
      });
      expect(writableUpdate.success).toBe(true);
      expect(
        (await getCard(ownerProjectId, page.id))?.scheduledEnd?.toISOString(),
      ).toBe(
        "2026-03-01T12:00:00.000Z",
      );

      const complete = await completePageOccurrence(grantee.id, {
        pageId: page.id,
        occurrenceStart: start,
        source: "api",
      });
      expect(complete).toMatchObject({
        success: false,
        code: "authorization_denied",
      });
      expect(archiveRows()).toHaveLength(0);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });
});
