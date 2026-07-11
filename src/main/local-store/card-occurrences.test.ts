import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CardInput,
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
} from "../../shared/types";
import { createUuidV7 } from "../../shared/card-id";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import { applyCardLifecycleMutation } from "./card-block-lifecycle";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { listBlockChangeHistory } from "./document-versions";
import { readAuthoritativeCardById } from "./card-read-store";
import { createProject } from "./projects";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { executeReadOnlyQuery } from "./sql-inspection";
import {
  completeCardOccurrence as completeStoredCardOccurrence,
  listCalendarOccurrences,
  skipCardOccurrence as skipStoredCardOccurrence,
  updateCardOccurrence as updateStoredCardOccurrence,
} from "./card-occurrences";

type TestOccurrenceAction = Omit<CardOccurrenceActionInput, "operationId"> & {
  readonly operationId?: string;
};
type TestOccurrenceUpdate = Omit<CardOccurrenceUpdateInput, "operationId"> & {
  readonly operationId?: string;
};

let testOperationSequence = 0;

const nextTestOperationId = (): string =>
  `card-occurrence-test:${++testOperationSequence}`;

const completeCardOccurrence = (
  targetProjectId: string,
  input: TestOccurrenceAction,
  sessionId?: string,
) =>
  completeStoredCardOccurrence(
    targetProjectId,
    { ...input, operationId: input.operationId ?? nextTestOperationId() },
    sessionId,
  );

const skipCardOccurrence = (
  targetProjectId: string,
  input: TestOccurrenceAction,
  sessionId?: string,
) =>
  skipStoredCardOccurrence(
    targetProjectId,
    { ...input, operationId: input.operationId ?? nextTestOperationId() },
    sessionId,
  );

const updateCardOccurrence = (
  targetProjectId: string,
  input: TestOccurrenceUpdate,
  sessionId?: string,
) =>
  updateStoredCardOccurrence(
    targetProjectId,
    { ...input, operationId: input.operationId ?? nextTestOperationId() },
    sessionId,
  );

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

let projectId = "";

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-occurrence-actions-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
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
    delete process.env.NODEX_DIR;
  }
}

function toIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function recurringInput(startIso: string, endIso: string): CardInput {
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

function allDayInput(startIso: string, endIso: string): CardInput {
  return {
    title: "All-day event",
    scheduledStart: new Date(startIso),
    scheduledEnd: new Date(endIso),
    isAllDay: true,
  };
}

async function createCard(targetProjectId: string, status: "in_progress", input: CardInput) {
  const database = getDb();
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Card fixture has no Block store epoch");
  const cardId = createUuidV7();
  const created = applyCardLifecycleMutation(database, parseCardLifecycleMutationRequest({
    version: 1,
    operationId: `occurrence-fixture:create:${cardId}`,
    projectId: targetProjectId,
    storeEpoch,
    actor: { kind: "test" },
    operation: {
      kind: "create_card",
      cardId,
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
      agentBlocked: input.agentBlocked ?? false,
      agentStatus: input.agentStatus ?? null,
      runInTarget: input.runInTarget ?? "localProject",
      runInLocalPath: input.runInLocalPath ?? null,
      runInBaseBranch: input.runInBaseBranch ?? null,
      runInWorktreePath: input.runInWorktreePath ?? null,
      runInEnvironmentPath: input.runInEnvironmentPath ?? null,
    },
  }));
  if (!created.ok) throw new Error(created.error.message);
  const primary = readAuthoritativeCardById(database, targetProjectId, cardId);
  if (!primary) throw new Error("Authoritative Card disappeared after creation");
  return primary;
}

const getCard = (targetProjectId: string, cardId: string) =>
  readAuthoritativeCardById(getDb(), targetProjectId, cardId);

function recurringInputWithUntilDate(startIso: string, endIso: string, untilDate: string): CardInput {
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

function authorityRows(lifecycle: "active" | "archived", status: "in_progress" | "done") {
  return executeReadOnlyQuery(
    `SELECT block.id,
            schedule.scheduled_start,
            schedule.scheduled_end,
            schedule.recurrence_json,
            schedule.reminders_json
     FROM blocks block
     INNER JOIN database_memberships membership
       ON membership.card_block_id = block.id
       AND membership.project_id = block.project_id
       AND membership.removed_at IS NULL
     INNER JOIN database_property_values status_value
       ON status_value.membership_id = membership.id
       AND status_value.property_id = membership.database_block_id || ':property:status'
     LEFT JOIN scheduled_card_index schedule
       ON schedule.card_block_id = block.id
       AND schedule.project_id = block.project_id
     WHERE block.project_id = ? AND block.type = 'card'
       AND block.lifecycle = ? AND status_value.value_json = json_quote(?)
     ORDER BY block.created_at DESC, block.id DESC`,
    [projectId, lifecycle, status],
  ).rows;
}

function archiveRows() {
  return authorityRows("archived", "done");
}

describe("occurrence actions", () => {
  test("done on recurring current occurrence creates archive card and advances master", async () => {
    const ran = await withTempDatabase(async () => {
      const startIso = "2026-03-01T10:00:00.000Z";
      const endIso = "2026-03-01T11:00:00.000Z";
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const result = await completeCardOccurrence(
        projectId,
        {
          cardId: card.id,
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const result = await completeCardOccurrence(projectId, {
        cardId: card.id,
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
         WHERE project_id = ? AND card_id = ?`,
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
      const card = await createCard(projectId, "in_progress", {
        title: "One-time event",
        scheduledStart: new Date(startIso),
        scheduledEnd: new Date(endIso),
      });

      const result = await completeCardOccurrence(projectId, {
        cardId: card.id,
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const result = await skipCardOccurrence(projectId, {
        cardId: card.id,
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const result = await updateCardOccurrence(projectId, {
        cardId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
        scope: "this",
        updates: {
          scheduledStart: new Date(detachedStartIso),
          scheduledEnd: new Date(detachedEndIso),
        },
      });
      expect(result.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe(startIso);
      expect(master?.scheduledEnd?.toISOString()).toBe(endIso);

      const exceptions = executeReadOnlyQuery(
        `SELECT exception_type, occurrence_start, override_start, override_end
         FROM recurrence_exceptions
         WHERE project_id = ? AND card_id = ?`,
        [projectId, card.id],
      ).rows;
      expect(exceptions.length).toBe(1);
      expect(exceptions[0]?.exception_type).toBe("skip");
      expect(toIso(exceptions[0]?.occurrence_start)).toBe(startIso);
      expect(exceptions[0]?.override_start).toBe(null);
      expect(exceptions[0]?.override_end).toBe(null);

      const rows = authorityRows("active", "in_progress");
      expect(rows.length).toBe(2);
      const detachedRow = rows.find((row) => row.id !== card.id);
      expect(Boolean(detachedRow)).toBe(true);
      expect(toIso(detachedRow?.scheduled_start)).toBe(detachedStartIso);
      expect(toIso(detachedRow?.scheduled_end)).toBe(detachedEndIso);
      expect(detachedRow?.recurrence_json).toBe("null");

      const occurrences = await listCalendarOccurrences(
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const occurrences = await listCalendarOccurrences(
        projectId,
        new Date("2026-03-01T00:00:00.000Z"),
        new Date("2026-03-04T00:00:00.000Z"),
      );

      const first = occurrences.find((occurrence) => occurrence.cardId === card.id);
      const second = occurrences.find(
        (occurrence) =>
          occurrence.cardId === card.id && occurrence.occurrenceStart.toISOString() === "2026-03-02T10:00:00.000Z",
      );

      expect(first?.occurrenceStart.toISOString()).toBe(startIso);
      expect(first?.thisAndFutureEquivalentToAll).toBe(true);
      expect(second?.thisAndFutureEquivalentToAll).toBe(false);
    });

    if (!ran) {
      expect(true).toBe(true);
    }
  });

  test("calendar occurrences return explicit all-day flag", async () => {
    const ran = await withTempDatabase(async () => {
      await createCard(projectId, "in_progress", allDayInput("2026-03-10T00:00:00.000Z", "2026-03-11T00:00:00.000Z"));

      const occurrences = await listCalendarOccurrences(
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const result = await updateCardOccurrence(projectId, {
        cardId: card.id,
        occurrenceStart: new Date(splitOccurrenceIso),
        source: "calendar",
        scope: "this-and-future",
        updates: {
          scheduledStart: new Date(splitStartIso),
          scheduledEnd: new Date(splitEndIso),
        },
      });
      expect(result.success).toBe(true);

      const master = await getCard(projectId, card.id);
      expect(master?.scheduledStart?.toISOString()).toBe(startIso);
      expect(master?.scheduledEnd?.toISOString()).toBe(endIso);
      expect(master?.recurrence?.endCondition?.type).toBe("untilDate");
      if (master?.recurrence?.endCondition?.type === "untilDate") {
        expect(master.recurrence.endCondition.untilDate).toBe("2026-03-02");
      }

      const rows = authorityRows("active", "in_progress");
      expect(rows.length).toBe(2);

      const splitRow = rows.find((row) => row.id !== card.id);
      expect(Boolean(splitRow)).toBe(true);
      expect(toIso(splitRow?.scheduled_start)).toBe(splitStartIso);
      expect(toIso(splitRow?.scheduled_end)).toBe(splitEndIso);
      const splitRecurrence =
        typeof splitRow?.recurrence_json === "string" ? JSON.parse(splitRow.recurrence_json) : null;
      expect(splitRecurrence?.frequency).toBe("daily");
      expect(splitRecurrence?.interval).toBe(1);

      const exceptions = executeReadOnlyQuery(
        `SELECT * FROM recurrence_exceptions WHERE project_id = ? AND card_id = ?`,
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const result = await updateCardOccurrence(projectId, {
        cardId: card.id,
        occurrenceStart: new Date(startIso),
        source: "calendar",
        scope: "this-and-future",
        updates: {
          scheduledStart: new Date(updatedStartIso),
          scheduledEnd: new Date(updatedEndIso),
        },
      });
      expect(result.success).toBe(true);

      const rows = authorityRows("active", "in_progress");
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const result = await updateCardOccurrence(projectId, {
        cardId: card.id,
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
        `SELECT * FROM recurrence_exceptions WHERE project_id = ? AND card_id = ?`,
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
        "in_progress",
        recurringInputWithUntilDate(startIso, endIso, "2026-03-10"),
      );

      const result = await updateCardOccurrence(projectId, {
        cardId: card.id,
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
        "in_progress",
        recurringInputWithUntilDate(startIso, endIso, "2026-03-10"),
      );

      const result = await updateCardOccurrence(projectId, {
        cardId: card.id,
        occurrenceStart: new Date(splitOccurrenceIso),
        source: "calendar",
        scope: "this-and-future",
        updates: {
          scheduledStart: new Date(shiftedSplitStartIso),
          scheduledEnd: new Date(shiftedSplitEndIso),
        },
      });
      expect(result.success).toBe(true);

      const rows = authorityRows("active", "in_progress");
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
      const card = await createCard(projectId, "in_progress", recurringInput(startIso, endIso));

      const completeResult = await completeCardOccurrence(projectId, {
        cardId: card.id,
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
      const card = await createCard(
        projectId,
        "in_progress",
        recurringInput(startIso, endIso),
      );

      const first = await completeCardOccurrence(
        projectId,
        {
          operationId,
          cardId: card.id,
          occurrenceStart: new Date(startIso),
          source: "calendar",
        },
        "first-session",
      );
      expect(first.success).toBe(true);
      expect(first.duplicate).toBe(false);
      const countAfterFirst = executeReadOnlyQuery(
        "SELECT COUNT(*) AS count FROM blocks WHERE project_id = ? AND type = 'card'",
        [projectId],
      ).rows[0]?.count;

      closeDatabase();
      await initializeDatabase();
      const retry = await completeCardOccurrence(
        projectId,
        {
          operationId,
          cardId: card.id,
          occurrenceStart: new Date(startIso),
          source: "api",
        },
        "retry-session",
      );
      expect(retry.success).toBe(true);
      expect(retry.duplicate).toBe(true);
      expect(retry.createdCardId).toBe(first.createdCardId);
      expect(retry.changeLogSeq).toBe(first.changeLogSeq);
      expect(
        executeReadOnlyQuery(
          "SELECT COUNT(*) AS count FROM blocks WHERE project_id = ? AND type = 'card'",
          [projectId],
        ).rows[0]?.count,
      ).toBe(countAfterFirst);

      const collision = await completeCardOccurrence(projectId, {
        operationId,
        cardId: card.id,
        occurrenceStart: new Date("2026-03-02T10:00:00.000Z"),
        source: "notification",
      });
      expect(collision.success).toBe(false);
      expect(collision.code).toBe("operation_id_collision");

      const history = listBlockChangeHistory(getDb(), {
        projectId,
        blockId: card.id,
      }).find((entry) => entry.operationId === operationId);
      expect(history?.mutationKind).toBe("card_occurrence_complete");
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
      const first = await completeCardOccurrence(
        projectId,
        {
          operationId,
          cardId: missingCardId,
          occurrenceStart: new Date("2026-03-01T10:00:00.000Z"),
          source: "calendar",
        },
        "rejected-first-session",
      );
      expect(first.success).toBe(false);
      expect(first.duplicate).toBe(false);
      expect(first.code).toBe("card_not_found");
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
      const retry = await completeCardOccurrence(
        projectId,
        {
          operationId,
          cardId: missingCardId,
          occurrenceStart: new Date("2026-03-01T10:00:00.000Z"),
          source: "api",
        },
        "rejected-retry-session",
      );
      expect(retry.success).toBe(false);
      expect(retry.duplicate).toBe(true);
      expect(retry.code).toBe(first.code);
      expect(retry.error).toBe(first.error);

      const collision = await skipCardOccurrence(projectId, {
        operationId,
        cardId: missingCardId,
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
});
