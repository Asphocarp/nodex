import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  makeBlockPropertyFieldPath,
  type BlockPropertyFieldMutation,
  type BlockPropertyMutationRequest,
} from "../../shared/block-property-mutations";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import {
  applyBlockPropertyMutation,
  type BlockPropertyMutationFaultPoint,
} from "./block-property-mutations";
import { listBlockChangeHistory } from "./document-versions";

interface PropertyFixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly cardId: string;
  readonly storeEpoch: string;
  readonly databaseBlockId: string;
  readonly propertyIds: Readonly<Record<string, string>>;
}

interface RevisionValueRow {
  readonly revision: number;
  readonly value_json: string;
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
  run: (fixture: PropertyFixture) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-property-mutation-"),
  );
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Property mutations" });
    const card = await createCard(project.id, "draft", { title: "Mutable" });
    const database = getDb();
    const store = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const membership = database
      .prepare(
        `
        SELECT database_block_id
        FROM database_memberships
        WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      `,
      )
      .get(card.id, project.id) as { readonly database_block_id: string };
    const propertyRows = database
      .prepare(
        `
        SELECT id, key
        FROM database_properties
        WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
      `,
      )
      .all(membership.database_block_id, project.id) as {
      readonly id: string;
      readonly key: string;
    }[];
    await run({
      database,
      projectId: project.id,
      cardId: card.id,
      storeEpoch: store.store_epoch,
      databaseBlockId: membership.database_block_id,
      propertyIds: Object.fromEntries(
        propertyRows.map((property) => [property.key, property.id]),
      ),
    });
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previous === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previous;
    }
  }
};

const makeRequest = (
  fixture: PropertyFixture,
  mutationId: string,
  fields: readonly BlockPropertyFieldMutation[],
): BlockPropertyMutationRequest => ({
  version: 1,
  mutationId,
  projectId: fixture.projectId,
  storeEpoch: fixture.storeEpoch,
  clientSessionId: "test-session",
  actor: { kind: "test" },
  fields,
});

const readIntrinsic = (
  fixture: PropertyFixture,
  propertyKey: string,
): RevisionValueRow =>
  fixture.database
    .prepare(
      `
      SELECT revision, value_json
      FROM block_properties
      WHERE block_id = ? AND project_id = ? AND property_key = ?
    `,
    )
    .get(fixture.cardId, fixture.projectId, propertyKey) as RevisionValueRow;

const readDatabaseValue = (
  fixture: PropertyFixture,
  propertyKey: string,
): RevisionValueRow =>
  fixture.database
    .prepare(
      `
      SELECT value.revision, value.value_json
      FROM database_memberships membership
      INNER JOIN database_properties property
        ON property.database_block_id = membership.database_block_id
        AND property.project_id = membership.project_id
        AND property.key = ?
      INNER JOIN database_property_values value
        ON value.membership_id = membership.id
        AND value.property_id = property.id
      WHERE membership.card_block_id = ?
        AND membership.project_id = ?
        AND membership.removed_at IS NULL
    `,
    )
    .get(propertyKey, fixture.cardId, fixture.projectId) as RevisionValueRow;

const readMetadataRevision = (fixture: PropertyFixture): number =>
  (
    fixture.database
      .prepare(
        "SELECT metadata_revision FROM blocks WHERE id = ? AND project_id = ?",
      )
      .get(fixture.cardId, fixture.projectId) as {
      readonly metadata_revision: number;
    }
  ).metadata_revision;

const readPrimaryViewGroup = (fixture: PropertyFixture): string | null =>
  (
    fixture.database
      .prepare(
        `
        SELECT position.group_key
        FROM database_view_positions position
        INNER JOIN database_views view
          ON view.id = position.view_id
          AND view.project_id = position.project_id
        WHERE position.block_id = ?
          AND position.project_id = ?
          AND view.database_block_id = ?
          AND view.kind = 'kanban'
          AND view.is_primary = 1
      `,
      )
      .get(fixture.cardId, fixture.projectId, fixture.databaseBlockId) as {
      readonly group_key: string | null;
    }
  ).group_key;

const readProjectionSnapshot = (fixture: PropertyFixture): string => {
  const schedule = fixture.database
    .prepare(
      `
      SELECT
        lifecycle, scheduled_start, scheduled_end, is_all_day,
        recurrence_json, reminders_json, schedule_timezone,
        source_metadata_revision
      FROM scheduled_card_index
      WHERE card_block_id = ? AND project_id = ?
    `,
    )
    .get(fixture.cardId, fixture.projectId);
  const readModel = fixture.database
    .prepare(
      `
      SELECT
        metadata_revision, database_values_json, intrinsic_properties_json,
        property_revisions_json
      FROM card_read_model
      WHERE card_block_id = ? AND project_id = ?
    `,
    )
    .get(fixture.cardId, fixture.projectId);
  return JSON.stringify({
    viewGroup: readPrimaryViewGroup(fixture),
    schedule: schedule ?? null,
    readModel: readModel ?? null,
  });
};

const requirePropertyId = (fixture: PropertyFixture, key: string): string => {
  const propertyId = fixture.propertyIds[key];
  if (propertyId) return propertyId;
  throw new Error(`Missing fixture property ${key}`);
};

describe("Block property mutation store", () => {
  sqliteTest(
    "commits a mixed field batch once and replays the immutable receipt",
    async () => {
      await withFixture((fixture) => {
        const intrinsicBefore = readIntrinsic(fixture, "agent.status");
        const priorityBefore = readDatabaseValue(fixture, "priority");
        const metadataBefore = readMetadataRevision(fixture);
        const request = makeRequest(fixture, "property-batch-1", [
          {
            scope: "database",
            cardBlockId: fixture.cardId,
            databaseBlockId: fixture.databaseBlockId,
            propertyId: requirePropertyId(fixture, "priority"),
            operation: "set",
            expectedRevision: priorityBefore.revision,
            value: "p0-critical",
          },
          {
            scope: "intrinsic",
            blockId: fixture.cardId,
            propertyKey: "agent.status",
            operation: "set",
            expectedRevision: intrinsicBefore.revision,
            value: "running",
          },
        ]);

        const first = applyBlockPropertyMutation(fixture.database, request, {
          now: () => "2026-07-11T01:00:00.000Z",
        });
        expect(first.ok).toBe(true);
        if (!first.ok) throw new Error(first.error.message);
        expect(first.value.duplicate).toBe(false);
        expect(first.value.fields.length).toBe(2);
        expect(readIntrinsic(fixture, "agent.status").value_json).toBe(
          JSON.stringify("running"),
        );
        expect(readDatabaseValue(fixture, "priority").value_json).toBe(
          JSON.stringify("p0-critical"),
        );
        expect(readMetadataRevision(fixture)).toBe(metadataBefore + 1);

        const retry = applyBlockPropertyMutation(fixture.database, request);
        expect(retry.ok).toBe(true);
        if (!retry.ok) throw new Error(retry.error.message);
        expect(retry.value.duplicate).toBe(true);
        expect(retry.value.changeLogSeq).toBe(first.value.changeLogSeq);
        expect(readIntrinsic(fixture, "agent.status").revision).toBe(
          intrinsicBefore.revision + 1,
        );
        expect(readDatabaseValue(fixture, "priority").revision).toBe(
          priorityBefore.revision + 1,
        );
        expect(readMetadataRevision(fixture)).toBe(metadataBefore + 1);
        const ledgerCount = fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
          )
          .get(request.mutationId) as { readonly count: number };
        expect(ledgerCount.count).toBe(1);

        const canonicalHistory = listBlockChangeHistory(fixture.database, {
          projectId: fixture.projectId,
          blockId: fixture.cardId,
        });
        const propertyHistory = canonicalHistory.filter(
          (entry) => entry.mutationKind === "property_batch",
        );
        expect(propertyHistory.length).toBe(1);
        expect(propertyHistory[0]?.kind).toBe("block_mutation");
        const fieldChanges = propertyHistory[0]?.payload.fieldChanges;
        expect(Array.isArray(fieldChanges)).toBe(true);
        if (!Array.isArray(fieldChanges)) {
          throw new Error("Property history is missing field changes");
        }
        const priorityChange = fieldChanges.find(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            !Array.isArray(entry) &&
            "path" in entry &&
            typeof entry.path === "string" &&
            entry.path === makeBlockPropertyFieldPath(request.fields[0]!),
        ) as
          | {
              readonly before?: {
                readonly revision?: number;
                readonly value?: unknown;
              };
              readonly after?: {
                readonly revision?: number;
                readonly value?: unknown;
              };
            }
          | undefined;
        expect(priorityChange?.before?.revision).toBe(priorityBefore.revision);
        expect(JSON.stringify(priorityChange?.before?.value)).toBe(
          priorityBefore.value_json,
        );
        expect(priorityChange?.after?.revision).toBe(
          priorityBefore.revision + 1,
        );
        expect(priorityChange?.after?.value).toBe("p0-critical");

        const collision = applyBlockPropertyMutation(fixture.database, {
          ...request,
          fields: request.fields.map((field) =>
            field.scope === "intrinsic"
              ? { ...field, value: "blocked" }
              : field,
          ),
        });
        expect(collision.ok).toBe(false);
        if (collision.ok) throw new Error("Expected a mutation ID collision");
        expect(collision.error.code).toBe("mutation_id_collision");
        expect(readIntrinsic(fixture, "agent.status").value_json).toBe(
          JSON.stringify("running"),
        );
      });
    },
  );

  sqliteTest(
    "merges different fields while rejecting a stale scalar batch atomically",
    async () => {
      await withFixture((fixture) => {
        const statusBefore = readIntrinsic(fixture, "agent.status");
        const targetBefore = readIntrinsic(fixture, "run.target");
        const localPathBefore = readIntrinsic(fixture, "run.localPath");
        const metadataBefore = readMetadataRevision(fixture);
        const status = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "field-status", [
            {
              scope: "intrinsic",
              blockId: fixture.cardId,
              propertyKey: "agent.status",
              operation: "set",
              expectedRevision: statusBefore.revision,
              value: "running",
            },
          ]),
        );
        expect(status.ok).toBe(true);

        const independent = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "field-target", [
            {
              scope: "intrinsic",
              blockId: fixture.cardId,
              propertyKey: "run.target",
              operation: "set",
              expectedRevision: targetBefore.revision,
              value: "newWorktree",
            },
          ]),
        );
        expect(independent.ok).toBe(true);
        expect(readMetadataRevision(fixture)).toBe(metadataBefore + 2);

        const staleRequest = makeRequest(fixture, "stale-batch", [
          {
            scope: "intrinsic",
            blockId: fixture.cardId,
            propertyKey: "run.localPath",
            operation: "set",
            expectedRevision: localPathBefore.revision,
            value: "/must-not-commit",
          },
          {
            scope: "intrinsic",
            blockId: fixture.cardId,
            propertyKey: "agent.status",
            operation: "set",
            expectedRevision: statusBefore.revision,
            value: "blocked",
          },
        ]);
        const stale = applyBlockPropertyMutation(
          fixture.database,
          staleRequest,
        );
        expect(stale.ok).toBe(false);
        if (stale.ok) throw new Error("Expected a property conflict");
        expect(stale.error.code).toBe("property_conflict");
        expect(stale.error.expectedRevision).toBe(statusBefore.revision);
        expect(stale.error.actualRevision).toBe(statusBefore.revision + 1);
        expect(readIntrinsic(fixture, "run.localPath").value_json).toBe(
          localPathBefore.value_json,
        );
        expect(readIntrinsic(fixture, "run.localPath").revision).toBe(
          localPathBefore.revision,
        );
        expect(readMetadataRevision(fixture)).toBe(metadataBefore + 2);
        const rejected = fixture.database
          .prepare(
            `
            SELECT outcome, change_log_seq
            FROM block_mutations
            WHERE mutation_id = ?
          `,
          )
          .get(staleRequest.mutationId) as {
          readonly outcome: string;
          readonly change_log_seq: number | null;
        };
        expect(rejected.outcome).toBe("rejected");
        expect(rejected.change_log_seq === null).toBe(true);

        const retry = applyBlockPropertyMutation(
          fixture.database,
          staleRequest,
        );
        expect(retry.ok).toBe(false);
        if (retry.ok) throw new Error("Expected a replayed property conflict");
        expect(retry.error.code).toBe("property_conflict");
      });
    },
  );

  sqliteTest(
    "applies deterministic tag add/remove intent without scalar CAS",
    async () => {
      await withFixture((fixture) => {
        const tagsBefore = readDatabaseValue(fixture, "tags");
        const add = makeRequest(fixture, "tags-add", [
          {
            scope: "database",
            cardBlockId: fixture.cardId,
            databaseBlockId: fixture.databaseBlockId,
            propertyId: requirePropertyId(fixture, "tags"),
            operation: "add_remove",
            add: ["zeta", "alpha", "alpha"],
            remove: [],
          },
        ]);
        const added = applyBlockPropertyMutation(fixture.database, add);
        expect(added.ok).toBe(true);
        expect(readDatabaseValue(fixture, "tags").value_json).toBe(
          JSON.stringify(["alpha", "zeta"]),
        );

        const exchange = makeRequest(fixture, "tags-exchange", [
          {
            scope: "database",
            cardBlockId: fixture.cardId,
            databaseBlockId: fixture.databaseBlockId,
            propertyId: requirePropertyId(fixture, "tags"),
            operation: "add_remove",
            add: ["beta"],
            remove: ["zeta", "missing"],
          },
        ]);
        const exchanged = applyBlockPropertyMutation(
          fixture.database,
          exchange,
        );
        expect(exchanged.ok).toBe(true);
        const afterExchange = readDatabaseValue(fixture, "tags");
        expect(afterExchange.value_json).toBe(
          JSON.stringify(["alpha", "beta"]),
        );
        expect(afterExchange.revision).toBe(tagsBefore.revision + 2);

        const retry = applyBlockPropertyMutation(fixture.database, exchange);
        expect(retry.ok).toBe(true);
        if (!retry.ok) throw new Error(retry.error.message);
        expect(retry.value.duplicate).toBe(true);
        expect(readDatabaseValue(fixture, "tags").revision).toBe(
          tagsBefore.revision + 2,
        );

        const wrongOperation = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "tags-scalar", [
            {
              scope: "database",
              cardBlockId: fixture.cardId,
              databaseBlockId: fixture.databaseBlockId,
              propertyId: requirePropertyId(fixture, "tags"),
              operation: "set",
              expectedRevision: tagsBefore.revision + 2,
              value: "not-a-set",
            },
          ]),
        );
        expect(wrongOperation.ok).toBe(false);
        if (wrongOperation.ok)
          throw new Error("Expected a property type error");
        expect(wrongOperation.error.code).toBe("property_type_mismatch");
      });
    },
  );

  sqliteTest(
    "validates typed values and changes status with its primary View group",
    async () => {
      await withFixture((fixture) => {
        const statusBefore = readDatabaseValue(fixture, "status");
        const committed = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "status-group", [
            {
              scope: "database",
              cardBlockId: fixture.cardId,
              databaseBlockId: fixture.databaseBlockId,
              propertyId: requirePropertyId(fixture, "status"),
              operation: "set",
              expectedRevision: statusBefore.revision,
              value: "in_progress",
            },
          ]),
        );
        expect(committed.ok).toBe(true);
        expect(readPrimaryViewGroup(fixture)).toBe("in_progress");

        const invalidStatus = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "invalid-status", [
            {
              scope: "database",
              cardBlockId: fixture.cardId,
              databaseBlockId: fixture.databaseBlockId,
              propertyId: requirePropertyId(fixture, "status"),
              operation: "set",
              expectedRevision: statusBefore.revision + 1,
              value: "not-a-defined-option",
            },
          ]),
        );
        expect(invalidStatus.ok).toBe(false);
        if (invalidStatus.ok) throw new Error("Expected invalid status");
        expect(invalidStatus.error.code).toBe("property_value_invalid");
        expect(readPrimaryViewGroup(fixture)).toBe("in_progress");

        const runTargetBefore = readIntrinsic(fixture, "run.target");
        const invalidTarget = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "invalid-run-target", [
            {
              scope: "intrinsic",
              blockId: fixture.cardId,
              propertyKey: "run.target",
              operation: "set",
              expectedRevision: runTargetBefore.revision,
              value: "somewhere",
            },
          ]),
        );
        expect(invalidTarget.ok).toBe(false);
        if (invalidTarget.ok) throw new Error("Expected invalid run target");
        expect(invalidTarget.error.code).toBe("property_value_invalid");
        expect(readIntrinsic(fixture, "run.target").revision).toBe(
          runTargetBefore.revision,
        );
      });
    },
  );

  sqliteTest(
    "preflights schedule invariants and refreshes the typed schedule index",
    async () => {
      await withFixture((fixture) => {
        const allDayBefore = readIntrinsic(fixture, "schedule.isAllDay");
        const invalid = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "all-day-without-range", [
            {
              scope: "intrinsic",
              blockId: fixture.cardId,
              propertyKey: "schedule.isAllDay",
              operation: "set",
              expectedRevision: allDayBefore.revision,
              value: true,
            },
          ]),
        );
        expect(invalid.ok).toBe(false);
        if (invalid.ok) throw new Error("Expected invalid all-day schedule");
        expect(invalid.error.code).toBe("property_value_invalid");
        expect(readIntrinsic(fixture, "schedule.isAllDay").revision).toBe(
          allDayBefore.revision,
        );

        const startBefore = readDatabaseValue(fixture, "scheduled_start");
        const endBefore = readDatabaseValue(fixture, "scheduled_end");
        const committed = applyBlockPropertyMutation(
          fixture.database,
          makeRequest(fixture, "all-day-range", [
            {
              scope: "database",
              cardBlockId: fixture.cardId,
              databaseBlockId: fixture.databaseBlockId,
              propertyId: requirePropertyId(fixture, "scheduled_start"),
              operation: "set",
              expectedRevision: startBefore.revision,
              value: "2026-07-12T00:00:00.000Z",
            },
            {
              scope: "database",
              cardBlockId: fixture.cardId,
              databaseBlockId: fixture.databaseBlockId,
              propertyId: requirePropertyId(fixture, "scheduled_end"),
              operation: "set",
              expectedRevision: endBefore.revision,
              value: "2026-07-13T00:00:00.000Z",
            },
            {
              scope: "intrinsic",
              blockId: fixture.cardId,
              propertyKey: "schedule.isAllDay",
              operation: "set",
              expectedRevision: allDayBefore.revision,
              value: true,
            },
          ]),
        );
        expect(committed.ok).toBe(true);
        const schedule = fixture.database
          .prepare(
            `
            SELECT
              scheduled_start, scheduled_end, is_all_day,
              source_metadata_revision
            FROM scheduled_card_index
            WHERE card_block_id = ? AND project_id = ?
          `,
          )
          .get(fixture.cardId, fixture.projectId) as {
          readonly scheduled_start: string;
          readonly scheduled_end: string;
          readonly is_all_day: number;
          readonly source_metadata_revision: number;
        };
        expect(schedule.scheduled_start).toBe("2026-07-12T00:00:00.000Z");
        expect(schedule.scheduled_end).toBe("2026-07-13T00:00:00.000Z");
        expect(schedule.is_all_day).toBe(1);
        expect(schedule.source_metadata_revision).toBe(
          readMetadataRevision(fixture),
        );
      });
    },
  );

  sqliteTest(
    "rolls every authoritative write back at each pre-commit fault point",
    async () => {
      await withFixture((fixture) => {
        const faultPoints: readonly BlockPropertyMutationFaultPoint[] = [
          "after_property_values",
          "after_block_metadata",
          "after_projections",
          "after_change_log",
          "after_ledger",
          "before_commit",
        ];
        const before = readDatabaseValue(fixture, "status");
        const metadataBefore = readMetadataRevision(fixture);
        const projectionsBefore = readProjectionSnapshot(fixture);
        for (const point of faultPoints) {
          const request = makeRequest(fixture, `fault-${point}`, [
            {
              scope: "database",
              cardBlockId: fixture.cardId,
              databaseBlockId: fixture.databaseBlockId,
              propertyId: requirePropertyId(fixture, "status"),
              operation: "set",
              expectedRevision: before.revision,
              value: "done",
            },
          ]);
          let failed = false;
          try {
            applyBlockPropertyMutation(fixture.database, request, {
              faultInjector: (current) => {
                if (current !== point) return;
                throw new Error(`fault:${point}`);
              },
            });
          } catch {
            failed = true;
          }
          expect(failed).toBe(true);
          expect(readDatabaseValue(fixture, "status").value_json).toBe(
            before.value_json,
          );
          expect(readDatabaseValue(fixture, "status").revision).toBe(
            before.revision,
          );
          expect(readMetadataRevision(fixture)).toBe(metadataBefore);
          expect(readProjectionSnapshot(fixture)).toBe(projectionsBefore);
          const ledger = fixture.database
            .prepare(
              "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
            )
            .get(request.mutationId) as { readonly count: number };
          const changes = fixture.database
            .prepare(
              "SELECT COUNT(*) AS count FROM change_log WHERE operation_id = ?",
            )
            .get(request.mutationId) as { readonly count: number };
          expect(ledger.count).toBe(0);
          expect(changes.count).toBe(0);
        }
      });
    },
  );
});
