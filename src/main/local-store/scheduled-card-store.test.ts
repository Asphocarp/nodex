import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { openCardDocument } from "../../shared/block-documents";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { getOwnedBlockDocumentDescriptor } from "./block-document-cutover";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import {
  listAuthoritativeCalendarOccurrences,
  readAuthoritativeScheduledCards,
  readDueReminderSnoozes,
  refreshScheduledCardIndexProjection,
  ScheduledCardReadError,
} from "./scheduled-card-store";

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("better-sqlite3") && message.includes("not yet supported")
  );
};

const withTempDatabase = async (run: () => Promise<void>): Promise<boolean> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-scheduled-card-store-"),
  );
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (!isUnsupportedSqliteError(error)) throw error;
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
    return false;
  }

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

const firstXmlText = (root: Y.XmlFragment | Y.XmlElement): Y.XmlText | null => {
  for (const child of root.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (!(child instanceof Y.XmlElement)) continue;
    const nested = firstXmlText(child);
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
    const bodyText = firstXmlText(envelope.body);
    if (!bodyText) throw new Error("Expected a genesis body text node");
    loaded.document.transact(() => {
      envelope.title.delete(0, envelope.title.length);
      envelope.title.insert(0, title);
      bodyText.delete(0, bodyText.length);
      bodyText.insert(0, body);
    }, "scheduled-card-store-test");
    applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: "scheduled-card-store:test-update",
      clientSessionId: "scheduled-card-store:test-window",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(loaded.document, stateVector),
    });
  } finally {
    loaded.document.destroy();
  }
};

describe("scheduled Card authority reads", () => {
  test("uses the typed schedule index, current Document, and relational Card properties", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Scheduled authority" });
      const card = await createCard(project.id, "in_progress", {
        title: "Legacy schedule title",
        description: "Legacy schedule body",
        tags: ["legacy-tag"],
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
      editPrimaryDocument(
        descriptor.documentId,
        "Current schedule title",
        "Current schedule body",
      );

      database.transaction(() => {
        database
          .prepare(
            `
            UPDATE database_property_values
            SET value_json = '["relational-tag"]', revision = revision + 1
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
          .prepare("UPDATE blocks SET metadata_revision = 7 WHERE id = ?")
          .run(card.id);
        const refreshed = refreshScheduledCardIndexProjection(
          database,
          project.id,
          [card.id],
          "2031-02-01T00:00:00.000Z",
        );
        expect(refreshed.refreshedCardIds.join(",")).toBe(card.id);
      })();

      const query = {
        projectId: project.id,
        windowStart: new Date("2031-02-03T00:00:00.000Z"),
        windowEnd: new Date("2031-02-04T00:00:00.000Z"),
      } as const;
      const scheduled = readAuthoritativeScheduledCards(database, query);
      expect(scheduled.length).toBe(1);
      expect(scheduled[0]?.title).toBe("Current schedule title");
      expect(scheduled[0]?.description).toBe("Current schedule body");
      expect(scheduled[0]?.tags.join(",")).toBe("relational-tag");
      expect(scheduled[0]?.scheduledStart?.toISOString()).toBe(
        "2031-02-03T10:00:00.000Z",
      );
      expect(scheduled[0]?.reminders?.[0]?.offsetMinutes).toBe(5);

      const currentOccurrences = listAuthoritativeCalendarOccurrences(
        database,
        { ...query, searchQuery: "Current schedule body relational-tag" },
      );
      const legacyOccurrences = listAuthoritativeCalendarOccurrences(database, {
        ...query,
        searchQuery: "Legacy schedule body",
      });
      expect(currentOccurrences.length).toBe(1);
      expect(currentOccurrences[0]?.cardId).toBe(card.id);
      expect(legacyOccurrences.length).toBe(0);

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
      expect(snoozes.length).toBe(1);
      expect(snoozes[0]?.title).toBe("Current schedule title");

      database
        .prepare(
          `
          UPDATE scheduled_card_index
          SET source_metadata_revision = 6
          WHERE card_block_id = ?
        `,
        )
        .run(card.id);
      let staleCode: string | null = null;
      try {
        readAuthoritativeScheduledCards(database, query);
      } catch (error) {
        staleCode =
          error instanceof ScheduledCardReadError ? error.code : "unexpected";
      }
      expect(staleCode).toBe("scheduled_index_stale");
    });

    if (!ran) expect(true).toBe(true);
  });
});
