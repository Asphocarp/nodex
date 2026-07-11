import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  applyDatabaseMutation,
  readDatabaseManagementSnapshot,
} from "./database-kernel";
import { createProject } from "./projects";

const supportsBetterSqlite = (() => {
  try {
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
})();
const sqliteTest = supportsBetterSqlite ? test : test.skip;

describe("Database management authority", () => {
  sqliteTest("captures members and zero-membership Cards independently of View filters", async () => {
    closeDatabase();
    const previous = process.env.NODEX_DIR;
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-database-management-authority-"),
    );
    process.env.NODEX_DIR = directory;
    try {
      await initializeDatabase();
      const project = createProject({ name: "Management authority" });
      const member = await createCard(project.id, "draft", { title: "Member" });
      const standalone = await createCard(project.id, "draft", { title: "Standalone" });
      const database = getDb();
      const epoch = database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string };
      const standaloneMembership = database
        .prepare(
          `
          SELECT id, revision
          FROM database_memberships
          WHERE card_block_id = ? AND removed_at IS NULL
        `,
        )
        .get(standalone.id) as { readonly id: string; readonly revision: number };
      const removed = applyDatabaseMutation(database, {
        version: 1,
        operationId: "management-authority-remove",
        projectId: project.id,
        storeEpoch: epoch.store_epoch,
        actor: { kind: "test" },
        operations: [
          {
            kind: "transfer_membership",
            cardBlockId: standalone.id,
            expectedMembership: {
              membershipId: standaloneMembership.id,
              revision: standaloneMembership.revision,
            },
            target: null,
          },
        ],
      });
      expect(removed.ok).toBe(true);

      const primary = database
        .prepare(
          `
          SELECT view.id AS view_id, property.id AS property_id
          FROM database_views view
          INNER JOIN database_properties property
            ON property.database_block_id = view.database_block_id
           AND property.project_id = view.project_id
           AND property.key = 'status'
           AND property.lifecycle = 'active'
          WHERE view.project_id = ? AND view.is_primary = 1
        `,
        )
        .get(project.id) as { readonly view_id: string; readonly property_id: string };
      database
        .prepare("UPDATE database_views SET config_json = ? WHERE id = ?")
        .run(
          JSON.stringify({
            schemaKey: "nodex.database-view",
            schemaVersion: 1,
            filter: {
              kind: "clause",
              propertyId: primary.property_id,
              operator: "equals",
              value: "done",
            },
            sort: [
              {
                field: { kind: "manual" },
                direction: "asc",
                nulls: "last",
              },
            ],
            group: { propertyId: primary.property_id },
            display: { propertyIds: [], showTitle: true },
          }),
          primary.view_id,
        );

      const snapshot = readDatabaseManagementSnapshot(database, project.id);
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok || !snapshot.value.value) return;
      const byCard = new Map(
        snapshot.value.value.cards.map((state) => [state.card.blockId, state]),
      );
      expect(byCard.get(member.id)?.membership?.cardBlockId).toBe(member.id);
      expect(byCard.get(standalone.id)?.membership).toBe(null);
      expect(snapshot.value.value.catalog.databases.length).toBe(1);
      expect(snapshot.value.changeLogSeq).toBe(
        removed.ok ? removed.value.changeLogSeq : -1,
      );
    } finally {
      closeDatabase();
      fs.rmSync(directory, { recursive: true, force: true });
      if (previous === undefined) delete process.env.NODEX_DIR;
      else process.env.NODEX_DIR = previous;
    }
  });
});
