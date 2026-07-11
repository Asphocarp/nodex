import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseMutationRequest } from "../../shared/database-kernel";
import { compileDatabaseCardDragMany } from "../../shared/database-card-drag-many";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  applyDatabaseMutation,
  queryDatabaseViewSnapshot,
  readPrimaryDatabaseDescriptorSnapshot,
  type DatabaseMutationFaultPoint,
} from "./database-kernel";
import { createProject } from "./projects";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly storeEpoch: string;
}

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("better-sqlite3") && message.includes("not yet supported")
  );
};

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

const withFixture = async (
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-bulk-kernel-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Bulk Database kernel" });
    const database = getDb();
    const metadata = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    await run({
      database,
      projectId: project.id,
      storeEpoch: metadata.store_epoch,
    });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previous;
    }
  }
};

const readSnapshot = (fixture: Fixture) => {
  const descriptorResult = readPrimaryDatabaseDescriptorSnapshot(
    fixture.database,
    fixture.projectId,
  );
  if (!descriptorResult.ok || !descriptorResult.value.value) {
    throw new Error("Primary Database descriptor unavailable");
  }
  const view = descriptorResult.value.value.views.find(
    (candidate) => candidate.lifecycle === "active" && candidate.isPrimary,
  );
  if (!view) throw new Error("Primary View unavailable");
  const queryResult = queryDatabaseViewSnapshot(
    fixture.database,
    fixture.projectId,
    view.id,
  );
  if (!queryResult.ok || !queryResult.value.value) {
    throw new Error("Primary View query unavailable");
  }
  if (
    descriptorResult.value.changeLogSeq !== queryResult.value.changeLogSeq
  ) {
    throw new Error("Database changed between descriptor and query reads");
  }
  return {
    descriptor: descriptorResult.value,
    query: queryResult.value,
  };
};

const compileRequest = (
  fixture: Fixture,
  operationId: string,
  cardIds: readonly string[],
): DatabaseMutationRequest => {
  const snapshot = readSnapshot(fixture);
  const compiled = compileDatabaseCardDragMany({
    move: {
      cardIds: [...cardIds],
      fromStatus: "in_progress",
      toStatus: "done",
      newOrder: 1,
      fieldPatch: { priority: "p2-medium" },
    },
    snapshot,
  });
  return {
    version: 1,
    operationId,
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    clientSessionId: "bulk-test-session",
    actor: { kind: "database_bulk_test" },
    operations: compiled.operations,
  };
};

const authorityDigest = (fixture: Fixture): string => {
  const values = fixture.database
    .prepare(
      `
      SELECT membership.card_block_id, property.key, value.value_json, value.revision
      FROM database_property_values value
      INNER JOIN database_memberships membership ON membership.id = value.membership_id
      INNER JOIN database_properties property ON property.id = value.property_id
      WHERE membership.project_id = ? AND property.key IN ('status', 'priority')
      ORDER BY membership.card_block_id, property.key
    `,
    )
    .all(fixture.projectId);
  const positions = fixture.database
    .prepare(
      `
      SELECT block_id, group_key, rank_key, revision
      FROM database_view_positions
      WHERE project_id = ?
      ORDER BY view_id, group_key, rank_key, block_id
    `,
    )
    .all(fixture.projectId);
  const changes = fixture.database
    .prepare(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log WHERE project_id = ?",
    )
    .get(fixture.projectId);
  return JSON.stringify({ values, positions, changes });
};

describe("Database bulk mutation authority", () => {
  sqliteTest(
    "commits more than sixty-four ordered field/position intents as one receipt",
    async () => {
      await withFixture(async (fixture) => {
        const selected = [];
        for (let index = 0; index < 40; index += 1) {
          const card = await createCard(fixture.projectId, "in_progress", {
            title: `Selected ${index}`,
            priority: "p1-high",
          });
          selected.push(card.id);
        }
        const before = await createCard(fixture.projectId, "done", {
          title: "Before",
          priority: "p3-low",
        });
        const after = await createCard(fixture.projectId, "done", {
          title: "After",
          priority: "p3-low",
        });
        const inputOrder = [...selected].reverse();
        const snapshot = readSnapshot(fixture);
        const beforeRows = new Map(
          snapshot.query.value?.rows.map((row) => [row.card.blockId, row]) ?? [],
        );
        const request = compileRequest(
          fixture,
          "bulk-drag-commit",
          inputOrder,
        );
        expect(request.operations.length).toBe(2);

        const result = applyDatabaseMutation(fixture.database, request);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.operationKinds.join(",")).toBe(
          "set_values,position_cards",
        );
        expect(result.value.affectedDatabaseBlockIds.length).toBe(1);
        expect(result.value.duplicate).toBe(false);

        const afterSnapshot = readSnapshot(fixture);
        const rows = afterSnapshot.query.value?.rows ?? [];
        const doneOrder = rows
          .filter((row) => row.effectiveGroupKey === "done")
          .map((row) => row.card.blockId);
        expect(doneOrder.join(",")).toBe(
          [before.id, ...inputOrder, after.id].join(","),
        );
        for (const cardBlockId of inputOrder) {
          const previous = beforeRows.get(cardBlockId);
          const current = rows.find(
            (row) => row.card.blockId === cardBlockId,
          );
          if (!previous || !current) throw new Error("Selected Card missing");
          const statusProperty = afterSnapshot.descriptor.value?.properties.find(
            (property) => property.key === "status",
          );
          const priorityProperty =
            afterSnapshot.descriptor.value?.properties.find(
              (property) => property.key === "priority",
            );
          if (!statusProperty || !priorityProperty) {
            throw new Error("Seeded properties unavailable");
          }
          expect(current.values[statusProperty.id]?.value).toBe("done");
          expect(current.values[statusProperty.id]?.revision).toBe(
            (previous.values[statusProperty.id]?.revision ?? 0) + 1,
          );
          expect(current.values[priorityProperty.id]?.value).toBe("p2-medium");
          expect(current.values[priorityProperty.id]?.revision).toBe(
            (previous.values[priorityProperty.id]?.revision ?? 0) + 1,
          );
          expect(current.position?.revision).toBe(
            (previous.position?.revision ?? 0) + 1,
          );
        }

        const committedDigest = authorityDigest(fixture);
        const retry = applyDatabaseMutation(fixture.database, request);
        expect(retry.ok ? retry.value.duplicate : false).toBe(true);
        expect(authorityDigest(fixture)).toBe(committedDigest);
        const ledger = fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
          )
          .get(request.operationId) as { readonly count: number };
        expect(ledger.count).toBe(1);
      });
    },
  );

  sqliteTest(
    "fails one stale entry and rolls every bulk fault boundary back",
    async () => {
      await withFixture(async (fixture) => {
        const selected = [];
        for (let index = 0; index < 4; index += 1) {
          const card = await createCard(fixture.projectId, "in_progress", {
            title: `Selected ${index}`,
            priority: "p1-high",
          });
          selected.push(card.id);
        }
        await createCard(fixture.projectId, "done", {
          title: "Anchor",
          priority: "p3-low",
        });
        const baseline = authorityDigest(fixture);
        const canonical = compileRequest(
          fixture,
          "bulk-drag-canonical",
          selected,
        );
        const values = canonical.operations[0];
        if (values?.kind !== "set_values") {
          throw new Error("Expected set_values");
        }
        const staleRequest: DatabaseMutationRequest = {
          ...canonical,
          operationId: "bulk-drag-stale",
          operations: [
            {
              ...values,
              entries: values.entries.map((entry, index) =>
                index === values.entries.length - 1
                  ? {
                      ...entry,
                      expectedValueRevision:
                        entry.expectedValueRevision + 1,
                    }
                  : entry,
              ),
            },
            ...canonical.operations.slice(1),
          ],
        };
        const stale = applyDatabaseMutation(fixture.database, staleRequest);
        expect(stale.ok ? "ok" : stale.error.code).toBe(
          "property_value_conflict",
        );
        expect(authorityDigest(fixture)).toBe(baseline);

        const faultPoints: readonly DatabaseMutationFaultPoint[] = [
          "bulk_after_validation",
          "bulk_after_values",
          "bulk_after_rank_plan",
          "bulk_after_positions",
        ];
        for (const point of faultPoints) {
          const request: DatabaseMutationRequest = {
            ...canonical,
            operationId: `bulk-fault-${point}`,
          };
          let threw = false;
          try {
            applyDatabaseMutation(fixture.database, request, {
              faultInjector: (candidate) => {
                if (candidate === point) throw new Error(point);
              },
            });
          } catch {
            threw = true;
          }
          expect(threw).toBe(true);
          expect(authorityDigest(fixture)).toBe(baseline);
          const ledger = fixture.database
            .prepare(
              "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
            )
            .get(request.operationId) as { readonly count: number };
          expect(ledger.count).toBe(0);
        }
      });
    },
  );
});
