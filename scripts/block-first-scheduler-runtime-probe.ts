import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { openCardDocument } from "../src/shared/block-documents";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import { getOwnedBlockDocumentDescriptor } from "../src/main/local-store/block-document-cutover";
import { createCard } from "../src/main/local-store/cards";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import {
  listAuthoritativeCalendarOccurrences,
  readAuthoritativeScheduledCards,
  readDueReminderSnoozes,
  refreshScheduledCardIndexProjection,
  ScheduledCardReadError,
} from "../src/main/local-store/scheduled-card-store";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
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
  title: string,
  body: string,
): void => {
  const database = getDb();
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    const stateVector = Y.encodeStateVector(loaded.document);
    const envelope = openCardDocument(loaded.document);
    const bodyText = findFirstXmlText(envelope.body);
    assert(bodyText, "Scheduler probe expected genesis body text");
    loaded.document.transact(() => {
      envelope.title.delete(0, envelope.title.length);
      envelope.title.insert(0, title);
      bodyText.delete(0, bodyText.length);
      bodyText.insert(0, body);
    }, "scheduler-runtime-probe");
    applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: "scheduler-runtime:update",
      clientSessionId: "scheduler-runtime:window",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(loaded.document, stateVector),
    });
  } finally {
    loaded.document.destroy();
  }
};

const main = async (): Promise<void> => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-scheduler-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;

  try {
    await initializeDatabase();
    const project = createProject({ name: "Scheduler runtime" });
    const card = await createCard(project.id, "in_progress", {
      title: "Legacy reminder title",
      description: "Legacy reminder body",
      tags: ["legacy"],
      scheduledStart: new Date("2030-01-01T10:00:00.000Z"),
      scheduledEnd: new Date("2030-01-01T11:00:00.000Z"),
      reminders: [{ offsetMinutes: 10 }],
      scheduleTimezone: "UTC",
    });
    const database = getDb();
    const descriptor = getOwnedBlockDocumentDescriptor(
      database,
      project.id,
      card.id,
    );
    assert(
      descriptor.authority === "ydoc_primary",
      "Scheduler Card was not created with Y.Doc authority",
    );
    editPrimaryDocument(
      descriptor.documentId,
      "Current reminder title",
      "Current reminder body",
    );

    database.transaction(() => {
      database
        .prepare(
          `
          UPDATE database_property_values
          SET value_json = '["relational"]', revision = revision + 1
          WHERE membership_id = 'membership:' || ?
            AND property_id = database_block_id || ':property:tags'
        `,
        )
        .run(card.id);
      database
        .prepare(
          `
          UPDATE database_property_values
          SET value_json = '"2031-02-03T10:00:00.000Z"', revision = revision + 1
          WHERE membership_id = 'membership:' || ?
            AND property_id = database_block_id || ':property:scheduled_start'
        `,
        )
        .run(card.id);
      database
        .prepare(
          `
          UPDATE database_property_values
          SET value_json = '"2031-02-03T11:00:00.000Z"', revision = revision + 1
          WHERE membership_id = 'membership:' || ?
            AND property_id = database_block_id || ':property:scheduled_end'
        `,
        )
        .run(card.id);
      database
        .prepare(
          `
          UPDATE block_properties
          SET value_json = '[{"offsetMinutes":5}]', revision = revision + 1
          WHERE block_id = ? AND property_key = 'reminders.config'
        `,
        )
        .run(card.id);
      database
        .prepare("UPDATE blocks SET metadata_revision = 9 WHERE id = ?")
        .run(card.id);
      const refreshed = refreshScheduledCardIndexProjection(
        database,
        project.id,
        [card.id],
        "2031-02-01T00:00:00.000Z",
      );
      assert(
        refreshed.refreshedCardIds.join(",") === card.id,
        "Scheduler index refresh did not report the Card",
      );
    })();

    let invalidRefreshRejected = false;
    try {
      database.transaction(() => {
        database
          .prepare(
            `
            UPDATE database_property_values
            SET value_json = 'null', revision = revision + 1
            WHERE membership_id = 'membership:' || ?
              AND property_id = database_block_id || ':property:scheduled_end'
          `,
          )
          .run(card.id);
        database
          .prepare("UPDATE blocks SET metadata_revision = 10 WHERE id = ?")
          .run(card.id);
        refreshScheduledCardIndexProjection(
          database,
          project.id,
          [card.id],
          "2031-02-01T00:01:00.000Z",
        );
      })();
    } catch (error) {
      invalidRefreshRejected =
        error instanceof ScheduledCardReadError &&
        error.code === "scheduled_value_invalid";
    }
    assert(invalidRefreshRejected, "Invalid schedule combination was accepted");
    const rollback = database
      .prepare(
        `
        SELECT
          card.metadata_revision,
          schedule.source_metadata_revision,
          scheduled_end.value_json AS scheduled_end_json
        FROM blocks card
        INNER JOIN scheduled_card_index schedule
          ON schedule.card_block_id = card.id
        INNER JOIN database_memberships membership
          ON membership.card_block_id = card.id
          AND membership.removed_at IS NULL
        INNER JOIN database_properties property
          ON property.database_block_id = membership.database_block_id
          AND property.key = 'scheduled_end'
        INNER JOIN database_property_values scheduled_end
          ON scheduled_end.membership_id = membership.id
          AND scheduled_end.property_id = property.id
        WHERE card.id = ?
      `,
      )
      .get(card.id) as {
      metadata_revision: number;
      source_metadata_revision: number;
      scheduled_end_json: string;
    };
    assert(
      rollback.metadata_revision === 9 &&
        rollback.source_metadata_revision === 9 &&
        rollback.scheduled_end_json === '"2031-02-03T11:00:00.000Z"',
      "Invalid projection refresh did not roll back its source mutation",
    );

    const query = {
      projectId: project.id,
      windowStart: new Date("2031-02-03T00:00:00.000Z"),
      windowEnd: new Date("2031-02-04T00:00:00.000Z"),
    } as const;
    const scheduled = readAuthoritativeScheduledCards(database, query);
    assert(scheduled.length === 1, "Typed schedule index returned no Card");
    assert(
      scheduled[0]?.title === "Current reminder title" &&
        scheduled[0]?.description === "Current reminder body",
      "Scheduler used legacy Card content",
    );
    assert(
      scheduled[0]?.tags.join(",") === "relational",
      "Scheduler used legacy Card properties",
    );
    assert(
      scheduled[0]?.scheduledStart?.toISOString() ===
        "2031-02-03T10:00:00.000Z" &&
        scheduled[0]?.reminders?.[0]?.offsetMinutes === 5,
      "Scheduler ignored the typed schedule index",
    );

    const current = listAuthoritativeCalendarOccurrences(database, {
      ...query,
      searchQuery: "Current reminder body relational",
    });
    const legacy = listAuthoritativeCalendarOccurrences(database, {
      ...query,
      searchQuery: "Legacy reminder body",
    });
    assert(current.length === 1, "Current Calendar occurrence was missing");
    assert(legacy.length === 0, "Calendar searched stale legacy content");

    database
      .prepare(
        `
        INSERT INTO reminder_snoozes (
          project_id, card_id, occurrence_start, due_at, created_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, NULL)
      `,
      )
      .run(
        project.id,
        card.id,
        "2031-02-03T10:00:00.000Z",
        "2031-02-03T09:00:00.000Z",
        "2031-02-03T08:00:00.000Z",
      );
    const snoozes = readDueReminderSnoozes(
      database,
      new Date("2031-02-03T09:30:00.000Z"),
    );
    assert(
      snoozes.length === 1 && snoozes[0]?.title === "Current reminder title",
      "Snooze query used stale legacy title",
    );

    database
      .prepare(
        "UPDATE scheduled_card_index SET source_metadata_revision = 8 WHERE card_block_id = ?",
      )
      .run(card.id);
    let staleRejected = false;
    try {
      readAuthoritativeScheduledCards(database, query);
    } catch (error) {
      staleRejected =
        error instanceof ScheduledCardReadError &&
        error.code === "scheduled_index_stale";
    }
    assert(staleRejected, "Stale scheduler projection was not rejected");

    console.log(
      JSON.stringify({
        scheduledIndex: true,
        atomicProjectionRefresh: true,
        invalidRefreshRollback: true,
        primaryAuthority: true,
        currentDocument: true,
        relationalProperties: true,
        calendarSearch: true,
        snoozeTitle: true,
        staleProjectionRejected: true,
      }),
    );
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
