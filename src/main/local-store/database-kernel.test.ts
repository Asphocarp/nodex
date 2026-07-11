import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DatabaseMutationOperation,
  DatabaseMutationRequest,
  GeneralDatabaseViewConfig,
} from "../../shared/database-kernel";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  applyDatabaseMutation,
  readDatabaseViewSnapshot,
  readPrimaryDatabaseDescriptorSnapshot,
  readPrimaryDatabaseViewSnapshot,
  type DatabaseMutationFaultPoint,
} from "./database-kernel";
import {
  queryGeneralDatabaseView,
  readCardContentSummary,
  readGeneralDatabaseDescriptor,
} from "./database-query";
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

const viewConfig = (
  overrides: Partial<GeneralDatabaseViewConfig> = {},
): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
  group: null,
  display: { propertyIds: [], showTitle: true },
  ...overrides,
});

const withFixture = async (
  run: (fixture: Fixture) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-kernel-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "General Database kernel" });
    const database = getDb();
    const store = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    await run({
      database,
      projectId: project.id,
      storeEpoch: store.store_epoch,
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

const request = (
  fixture: Fixture,
  operationId: string,
  operation: DatabaseMutationOperation,
  audit: { readonly actor?: string; readonly session?: string } = {},
): DatabaseMutationRequest => ({
  version: 1,
  operationId,
  projectId: fixture.projectId,
  storeEpoch: fixture.storeEpoch,
  clientSessionId: audit.session ?? "test-session",
  actor: { kind: audit.actor ?? "test" },
  operations: [operation],
});

const batchRequest = (
  fixture: Fixture,
  operationId: string,
  operations: readonly DatabaseMutationOperation[],
): DatabaseMutationRequest => ({
  version: 1,
  operationId,
  projectId: fixture.projectId,
  storeEpoch: fixture.storeEpoch,
  clientSessionId: "test-session",
  actor: { kind: "test" },
  operations,
});

const createDatabaseOperation = (
  databaseBlockId: string,
  viewId: string,
): Extract<
  DatabaseMutationOperation,
  { readonly kind: "create_database" }
> => ({
  kind: "create_database",
  databaseBlockId,
  name: "Research",
  isPrimary: false,
  initialView: {
    viewId,
    name: "All",
    viewKind: "list",
    config: viewConfig(),
  },
});

const resultCode = (
  result: ReturnType<typeof applyDatabaseMutation>,
): string => (result.ok ? "ok" : result.error.code);

const operationThrows = (operation: () => void): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

const readActiveMembership = (
  fixture: Fixture,
  cardBlockId: string,
): {
  readonly id: string;
  readonly database_block_id: string;
  readonly revision: number;
} =>
  fixture.database
    .prepare(
      `
      SELECT id, database_block_id, revision
      FROM database_memberships
      WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
    `,
    )
    .get(cardBlockId, fixture.projectId) as {
    readonly id: string;
    readonly database_block_id: string;
    readonly revision: number;
  };

const addProperty = (
  fixture: Fixture,
  input: {
    readonly operationId: string;
    readonly databaseBlockId: string;
    readonly propertyId: string;
    readonly databaseRevision: number;
    readonly key: string;
    readonly valueType:
      | "text"
      | "number"
      | "checkbox"
      | "select"
      | "multi_select"
      | "date"
      | "datetime"
      | "person";
    readonly config?:
      | Readonly<Record<string, never>>
      | {
          readonly options: readonly {
            readonly id: string;
            readonly name: string;
          }[];
        };
  },
): void => {
  const result = applyDatabaseMutation(
    fixture.database,
    request(fixture, input.operationId, {
      kind: "put_property",
      databaseBlockId: input.databaseBlockId,
      propertyId: input.propertyId,
      expectedDatabaseSchemaRevision: input.databaseRevision,
      expectedPropertyRevision: 0,
      key: input.key,
      name: input.key,
      valueType: input.valueType,
      config: input.config ?? {},
    }),
  );
  expect(resultCode(result)).toBe("ok");
};

describe("general Database kernel", () => {
  sqliteTest("reads the current primary Database without assuming its ID", async () => {
    await withFixture((fixture) => {
      const secondary = applyDatabaseMutation(
        fixture.database,
        request(
          fixture,
          "create-secondary",
          createDatabaseOperation("database-secondary", "view-secondary"),
        ),
      );
      expect(resultCode(secondary)).toBe("ok");
      const primary = readPrimaryDatabaseDescriptorSnapshot(
        fixture.database,
        fixture.projectId,
      );
      expect(primary.ok).toBe(true);
      if (!primary.ok || !primary.value.value) return;
      expect(primary.value.value.database.isPrimary).toBe(true);
      expect(primary.value.value.database.blockId === "database-secondary").toBe(false);
      expect(primary.value.storeEpoch).toBe(fixture.storeEpoch);
    });
  });

  sqliteTest("captures the primary descriptor and View under one cursor", async () => {
    await withFixture((fixture) => {
      const snapshot = readPrimaryDatabaseViewSnapshot(
        fixture.database,
        fixture.projectId,
      );
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      expect(snapshot.value.descriptor.storeEpoch).toBe(fixture.storeEpoch);
      expect(snapshot.value.query.storeEpoch).toBe(fixture.storeEpoch);
      expect(snapshot.value.descriptor.changeLogSeq).toBe(
        snapshot.value.query.changeLogSeq,
      );
      expect(snapshot.value.descriptor.value?.database.blockId).toBe(
        snapshot.value.query.value?.database.blockId,
      );
      expect(snapshot.value.query.value?.view.id).toBe(
        snapshot.value.descriptor.value?.views.find((view) => view.isPrimary)
          ?.id,
      );
    });
  });

  sqliteTest("captures an arbitrary durable View with its owning Database under one cursor", async () => {
    await withFixture((fixture) => {
      const created = applyDatabaseMutation(
        fixture.database,
        request(
          fixture,
          "create-secondary-snapshot",
          createDatabaseOperation("database-secondary", "view-secondary"),
        ),
      );
      expect(resultCode(created)).toBe("ok");

      const snapshot = readDatabaseViewSnapshot(
        fixture.database,
        fixture.projectId,
        "view-secondary",
      );
      expect(snapshot.ok).toBeTrue();
      if (!snapshot.ok) return;
      expect(snapshot.value.descriptor.changeLogSeq).toBe(
        snapshot.value.query.changeLogSeq,
      );
      expect(snapshot.value.query.value?.view.id).toBe("view-secondary");
      expect(snapshot.value.descriptor.value?.database.blockId).toBe(
        "database-secondary",
      );
      expect(snapshot.value.query.value?.database.blockId).toBe(
        "database-secondary",
      );
    });
  });

  sqliteTest("keeps the Database cursor and View value on one cross-connection read snapshot", async () => {
    await withFixture((fixture) => {
      const created = applyDatabaseMutation(
        fixture.database,
        request(
          fixture,
          "create-isolated-snapshot",
          createDatabaseOperation("database-isolated", "view-isolated"),
        ),
      );
      expect(resultCode(created)).toBe("ok");
      const concurrent = new Database(fixture.database.name);
      try {
        concurrent.pragma("busy_timeout = 2000");
        const snapshot = readDatabaseViewSnapshot(
          fixture.database,
          fixture.projectId,
          "view-isolated",
          {
            afterCursorRead: () => {
              concurrent.transaction(() => {
                concurrent.prepare(`
                  UPDATE database_views
                  SET name = 'Concurrent name', updated_at = ?
                  WHERE id = 'view-isolated' AND project_id = ?
                `).run("2026-07-12T01:00:00.000Z", fixture.projectId);
                concurrent.prepare(`
                  INSERT INTO change_log (
                    project_id, store_epoch, kind, operation_id,
                    block_ids_json, document_ids_json,
                    database_block_ids_json, payload_json, committed_at
                  ) VALUES (?, ?, 'database_snapshot_test', ?, '[]', '[]', ?, '{}', ?)
                `).run(
                  fixture.projectId,
                  fixture.storeEpoch,
                  "concurrent-snapshot-write",
                  JSON.stringify(["database-isolated"]),
                  "2026-07-12T01:00:00.000Z",
                );
              }).immediate();
            },
          },
        );
        expect(snapshot.ok).toBeTrue();
        if (!snapshot.ok) return;
        expect(snapshot.value.query.value?.view.name).toBe("All");

        const current = fixture.database.prepare(`
          SELECT name FROM database_views
          WHERE id = 'view-isolated' AND project_id = ?
        `).get(fixture.projectId) as { readonly name: string };
        const currentCursor = fixture.database.prepare(`
          SELECT MAX(seq) AS seq FROM change_log WHERE project_id = ?
        `).get(fixture.projectId) as { readonly seq: number };
        expect(current.name).toBe("Concurrent name");
        expect(currentCursor.seq > snapshot.value.query.changeLogSeq).toBeTrue();
      } finally {
        concurrent.close();
      }
    });
  });

  sqliteTest(
    "commits creation, canonical replay, rejection, and fault boundaries",
    async () => {
      await withFixture((fixture) => {
        const create = request(
          fixture,
          "create-research",
          createDatabaseOperation("database-research", "view-research"),
        );
        const first = applyDatabaseMutation(fixture.database, create);
        expect(resultCode(first)).toBe("ok");
        const descriptor = readGeneralDatabaseDescriptor(
          fixture.projectId,
          "database-research",
          fixture.database,
        );
        expect(descriptor?.database.name).toBe("Research");
        expect(descriptor?.views.length).toBe(1);
        expect(descriptor?.views[0]?.config.schemaVersion).toBe(1);

        const retry = applyDatabaseMutation(fixture.database, {
          ...create,
          actor: { kind: "cli" },
          clientSessionId: "other-session",
        });
        expect(retry.ok ? retry.value.duplicate : false).toBe(true);
        expect(
          resultCode(
            applyDatabaseMutation(fixture.database, {
              ...create,
              operations: [
                {
                  ...createDatabaseOperation(
                    "database-research",
                    "view-research",
                  ),
                  name: "Collision",
                },
              ],
            }),
          ),
        ).toBe("operation_id_collision");

        const stale = request(fixture, "stale-schema", {
          kind: "put_property",
          databaseBlockId: "database-research",
          propertyId: "property-stale",
          expectedDatabaseSchemaRevision: 99,
          expectedPropertyRevision: 0,
          key: "stale",
          name: "Stale",
          valueType: "text",
          config: {},
        });
        expect(resultCode(applyDatabaseMutation(fixture.database, stale))).toBe(
          "database_schema_conflict",
        );
        const rejection = fixture.database
          .prepare(
            `SELECT outcome, change_log_seq FROM block_mutations WHERE mutation_id = ?`,
          )
          .get("stale-schema") as {
          readonly outcome: string;
          readonly change_log_seq: number | null;
        };
        expect(rejection.outcome).toBe("rejected");
        expect(rejection.change_log_seq === null).toBe(true);
        expect(
          resultCode(
            applyDatabaseMutation(fixture.database, {
              ...stale,
              actor: { kind: "retry" },
              clientSessionId: "retry-session",
            }),
          ),
        ).toBe("database_schema_conflict");

        const faultRequest = request(
          fixture,
          "fault-create",
          createDatabaseOperation("database-fault", "view-fault"),
        );
        expect(
          operationThrows(() =>
            applyDatabaseMutation(fixture.database, faultRequest, {
              faultInjector: (point: DatabaseMutationFaultPoint) => {
                if (point === "after_authority") throw new Error("fault");
              },
            }),
          ),
        ).toBe(true);
        expect(
          fixture.database
            .prepare("SELECT 1 FROM blocks WHERE id = 'database-fault'")
            .get() === undefined,
        ).toBe(true);
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM block_mutations WHERE mutation_id = 'fault-create'",
            )
            .get() === undefined,
        ).toBe(true);

        const lostResponse = request(
          fixture,
          "lost-response",
          createDatabaseOperation("database-lost", "view-lost"),
        );
        expect(
          operationThrows(() =>
            applyDatabaseMutation(fixture.database, lostResponse, {
              faultInjector: (point) => {
                if (point === "after_commit") throw new Error("lost response");
              },
            }),
          ),
        ).toBe(true);
        const recovered = applyDatabaseMutation(fixture.database, lostResponse);
        expect(recovered.ok ? recovered.value.duplicate : false).toBe(true);
        const history = fixture.database
          .prepare(
            `
          SELECT change.kind, json_extract(change.payload_json, '$.requestHash') AS request_hash
          FROM block_mutations mutation
          INNER JOIN change_log change ON change.seq = mutation.change_log_seq
          WHERE mutation.mutation_id = 'lost-response'
        `,
          )
          .get() as { readonly kind: string; readonly request_hash: string };
        expect(history.kind).toBe("block_mutation");
        expect(history.request_hash.length).toBe(64);

        fixture.database
          .prepare(
            "UPDATE database_views SET config_json = '{}' WHERE id = 'view-research'",
          )
          .run();
        expect(
          operationThrows(() =>
            readGeneralDatabaseDescriptor(
              fixture.projectId,
              "database-research",
              fixture.database,
            ),
          ),
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "treats an empty select option registry as authoritative",
    async () => {
      await withFixture(async (fixture) => {
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(
                fixture,
                "create-empty-options",
                createDatabaseOperation(
                  "database-empty-options",
                  "view-empty-options",
                ),
              ),
            ),
          ),
        ).toBe("ok");
        addProperty(fixture, {
          operationId: "add-empty-select",
          databaseBlockId: "database-empty-options",
          propertyId: "property-empty-select",
          databaseRevision: 1,
          key: "empty_select",
          valueType: "select",
          config: { options: [] },
        });
        const card = await createCard(fixture.projectId, "draft", {
          title: "No arbitrary option IDs",
        });
        const membership = readActiveMembership(fixture, card.id);
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "transfer-empty-options", {
                kind: "transfer_membership",
                cardBlockId: card.id,
                expectedMembership: {
                  membershipId: membership.id,
                  revision: membership.revision,
                },
                target: {
                  databaseBlockId: "database-empty-options",
                  membershipId: "membership-empty-options",
                  viewId: "view-empty-options",
                  groupKey: null,
                },
              }),
            ),
          ),
        ).toBe("ok");
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "reject-unknown-option", {
                kind: "set_value",
                cardBlockId: card.id,
                databaseBlockId: "database-empty-options",
                propertyId: "property-empty-select",
                expectedValueRevision: 0,
                value: "unregistered-option",
              }),
            ),
          ),
        ).toBe("property_value_invalid");
      });
    },
  );

  sqliteTest(
    "reads a membership-independent Card without a legacy cards row and fails closed",
    async () => {
      await withFixture((fixture) => {
        const now = new Date().toISOString();
        fixture.database
          .prepare(
            `
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind,
            containing_document_id, location_revision, metadata_revision,
            created_at, updated_at
          ) VALUES ('card-block-only', ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
        `,
          )
          .run(fixture.projectId, now, now);
        fixture.database
          .prepare(
            `
          INSERT INTO top_level_block_placements (
            block_id, project_id, rank_key, created_at, updated_at
          ) VALUES ('card-block-only', ?, 'standalone', ?, ?)
        `,
          )
          .run(fixture.projectId, now, now);
        fixture.database
          .prepare(
            `
          INSERT INTO documents (
            id, project_id, generation, head_seq, schema_key, schema_version,
            state_vector, state_hash, readiness, authority,
            genesis_source_revision, created_at, updated_at
          ) VALUES ('document-block-only', ?, 1, 0, 'nodex.card', 1,
            X'', 'state', 'ready', 'ydoc_primary', NULL, ?, ?)
        `,
          )
          .run(fixture.projectId, now, now);
        fixture.database
          .prepare(
            `
          INSERT INTO block_documents (block_id, document_id, project_id, created_at)
          VALUES ('card-block-only', 'document-block-only', ?, ?)
        `,
          )
          .run(fixture.projectId, now);
        fixture.database
          .prepare(
            `
          INSERT INTO document_materializations (
            document_id, generation, projected_seq, schema_version,
            title, nfm, plain_text, preview, block_tree_json,
            references_json, asset_refs_json, updated_at
          ) VALUES ('document-block-only', 1, 0, 1,
            'Block-only title', '', 'Body', 'Body', '[]', '[]', '[]', ?)
        `,
          )
          .run(now);

        const summary = readCardContentSummary(
          fixture.projectId,
          "card-block-only",
          fixture.database,
        );
        expect(summary?.content?.title).toBe("Block-only title");
        expect(
          fixture.database
            .prepare("SELECT 1 FROM cards WHERE id = 'card-block-only'")
            .get() === undefined,
        ).toBe(true);
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM database_memberships WHERE card_block_id = 'card-block-only' AND removed_at IS NULL",
            )
            .get() === undefined,
        ).toBe(true);

        fixture.database
          .prepare(
            "UPDATE documents SET head_seq = 1 WHERE id = 'document-block-only'",
          )
          .run();
        expect(
          operationThrows(() =>
            readCardContentSummary(
              fixture.projectId,
              "card-block-only",
              fixture.database,
            ),
          ),
        ).toBe(true);
      });
    },
  );

  sqliteTest(
    "atomically transfers membership, supports typed custom values, and isolates View order",
    async () => {
      await withFixture(async (fixture) => {
        const first = await createCard(fixture.projectId, "draft", {
          title: "First",
        });
        const second = await createCard(fixture.projectId, "draft", {
          title: "Second",
        });
        const create = applyDatabaseMutation(
          fixture.database,
          request(
            fixture,
            "create-custom",
            createDatabaseOperation("database-custom", "view-custom"),
          ),
        );
        expect(resultCode(create)).toBe("ok");

        const properties = [
          ["text", "text"],
          ["number", "number"],
          ["checkbox", "checkbox"],
          ["select", "select"],
          ["multi", "multi_select"],
          ["date", "date"],
          ["datetime", "datetime"],
          ["person", "person"],
        ] as const;
        properties.forEach(([key, valueType], index) => {
          addProperty(fixture, {
            operationId: `add-${key}`,
            databaseBlockId: "database-custom",
            propertyId: `property-${key}`,
            databaseRevision: index + 1,
            key,
            valueType,
            ...(valueType === "select" || valueType === "multi_select"
              ? {
                  config: {
                    options: [
                      { id: `${key}-a`, name: "A" },
                      { id: `${key}-b`, name: "B" },
                    ],
                  },
                }
              : {}),
          });
        });

        const transfer = (
          cardId: string,
          operationId: string,
          beforeCardBlockId?: string,
        ): void => {
          const current = readActiveMembership(fixture, cardId);
          const result = applyDatabaseMutation(
            fixture.database,
            request(fixture, operationId, {
              kind: "transfer_membership",
              cardBlockId: cardId,
              expectedMembership: {
                membershipId: current.id,
                revision: current.revision,
              },
              target: {
                databaseBlockId: "database-custom",
                membershipId: `membership-custom-${cardId}`,
                viewId: "view-custom",
                groupKey: null,
                ...(beforeCardBlockId === undefined
                  ? {}
                  : { beforeCardBlockId }),
              },
            }),
          );
          expect(resultCode(result)).toBe("ok");
        };
        transfer(first.id, "transfer-first");
        transfer(second.id, "transfer-second", first.id);
        const oldPositions = fixture.database
          .prepare(
            `
          SELECT COUNT(*) AS count FROM database_view_positions position
          INNER JOIN database_views view ON view.id = position.view_id
          WHERE position.block_id IN (?, ?)
            AND view.database_block_id = ?
        `,
          )
          .get(
            first.id,
            second.id,
            `database:${fixture.projectId}:primary`,
          ) as {
          readonly count: number;
        };
        expect(oldPositions.count).toBe(0);
        expect(
          queryGeneralDatabaseView(
            fixture.projectId,
            "view-custom",
            fixture.database,
          )
            ?.rows.map((row) => row.card.blockId)
            .join(","),
        ).toBe(`${second.id},${first.id}`);

        const scalarValues: Array<{
          readonly propertyId: string;
          readonly value: string | number | boolean;
        }> = [
          { propertyId: "property-text", value: "hello" },
          { propertyId: "property-number", value: 42 },
          { propertyId: "property-checkbox", value: true },
          { propertyId: "property-select", value: "select-a" },
          { propertyId: "property-date", value: "2026-07-11" },
          {
            propertyId: "property-datetime",
            value: "2026-07-11T08:00:00.000Z",
          },
          { propertyId: "property-person", value: "person-1" },
        ];
        for (const value of scalarValues) {
          expect(
            resultCode(
              applyDatabaseMutation(
                fixture.database,
                request(fixture, `set-${value.propertyId}`, {
                  kind: "set_value",
                  cardBlockId: first.id,
                  databaseBlockId: "database-custom",
                  propertyId: value.propertyId,
                  expectedValueRevision: 0,
                  value: value.value,
                }),
              ),
            ),
          ).toBe("ok");
        }
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "set-multi-invalid", {
                kind: "set_value",
                cardBlockId: first.id,
                databaseBlockId: "database-custom",
                propertyId: "property-multi",
                expectedValueRevision: 0,
                value: ["multi-a"],
              }),
            ),
          ),
        ).toBe("property_value_invalid");
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "add-multi", {
                kind: "add_remove_value",
                cardBlockId: first.id,
                databaseBlockId: "database-custom",
                propertyId: "property-multi",
                add: ["multi-b", "multi-a"],
                remove: [],
              }),
            ),
          ),
        ).toBe("ok");
        const secondView = applyDatabaseMutation(
          fixture.database,
          request(fixture, "create-second-view", {
            kind: "put_view",
            databaseBlockId: "database-custom",
            viewId: "view-custom-second",
            expectedRevision: 0,
            name: "Second order",
            viewKind: "list",
            config: viewConfig(),
            isPrimary: false,
          }),
        );
        expect(resultCode(secondView)).toBe("ok");
        for (const [cardId, beforeCardBlockId] of [
          [first.id, undefined],
          [second.id, undefined],
        ] as const) {
          const result = applyDatabaseMutation(
            fixture.database,
            request(fixture, `position-${cardId}`, {
              kind: "position_card",
              viewId: "view-custom-second",
              cardBlockId: cardId,
              expectedPositionRevision: 0,
              groupKey: null,
              ...(beforeCardBlockId === undefined ? {} : { beforeCardBlockId }),
            }),
          );
          expect(resultCode(result)).toBe("ok");
        }
        expect(
          queryGeneralDatabaseView(
            fixture.projectId,
            "view-custom-second",
            fixture.database,
          )
            ?.rows.map((row) => row.card.blockId)
            .join(","),
        ).toBe(`${first.id},${second.id}`);

        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "create-desc-view", {
                kind: "put_view",
                databaseBlockId: "database-custom",
                viewId: "view-custom-desc",
                expectedRevision: 0,
                name: "Numbers descending",
                viewKind: "list",
                config: viewConfig({
                  sort: [
                    {
                      field: {
                        kind: "property",
                        propertyId: "property-number",
                      },
                      direction: "desc",
                      nulls: "last",
                    },
                  ],
                }),
                isPrimary: false,
              }),
            ),
          ),
        ).toBe("ok");
        expect(
          queryGeneralDatabaseView(
            fixture.projectId,
            "view-custom-desc",
            fixture.database,
          )
            ?.rows.map((row) => row.card.blockId)
            .join(","),
        ).toBe(`${first.id},${second.id}`);

        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "create-grouped-view", {
                kind: "put_view",
                databaseBlockId: "database-custom",
                viewId: "view-custom-grouped",
                expectedRevision: 0,
                name: "Grouped",
                viewKind: "kanban",
                config: viewConfig({
                  group: { propertyId: "property-select" },
                }),
                isPrimary: false,
              }),
            ),
          ),
        ).toBe("ok");
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "wrong-derived-group", {
                kind: "position_card",
                viewId: "view-custom-grouped",
                cardBlockId: first.id,
                expectedPositionRevision: 0,
                groupKey: "select-b",
              }),
            ),
          ),
        ).toBe("position_group_mismatch");
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "correct-derived-group", {
                kind: "position_card",
                viewId: "view-custom-grouped",
                cardBlockId: first.id,
                expectedPositionRevision: 0,
                groupKey: "select-a",
              }),
            ),
          ),
        ).toBe("ok");
        const moveGroup = applyDatabaseMutation(
          fixture.database,
          request(fixture, "move-derived-group", {
            kind: "set_value",
            cardBlockId: first.id,
            databaseBlockId: "database-custom",
            propertyId: "property-select",
            expectedValueRevision: 1,
            value: "select-b",
          }),
        );
        expect(resultCode(moveGroup)).toBe("ok");
        expect(
          queryGeneralDatabaseView(
            fixture.projectId,
            "view-custom-grouped",
            fixture.database,
          )?.rows.find((row) => row.card.blockId === first.id)
            ?.effectiveGroupKey,
        ).toBe("select-b");

        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "set-second-group", {
                kind: "set_value",
                cardBlockId: second.id,
                databaseBlockId: "database-custom",
                propertyId: "property-select",
                expectedValueRevision: 0,
                value: "select-a",
              }),
            ),
          ),
        ).toBe("ok");
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "position-second-group", {
                kind: "position_card",
                viewId: "view-custom-grouped",
                cardBlockId: second.id,
                expectedPositionRevision: 0,
                groupKey: "select-a",
              }),
            ),
          ),
        ).toBe("ok");
        const boardDrag = applyDatabaseMutation(
          fixture.database,
          batchRequest(fixture, "board-drag", [
            {
              kind: "set_value",
              cardBlockId: first.id,
              databaseBlockId: "database-custom",
              propertyId: "property-select",
              expectedValueRevision: 2,
              value: "select-a",
            },
            {
              kind: "position_card",
              viewId: "view-custom-grouped",
              cardBlockId: first.id,
              expectedPositionRevision: 2,
              groupKey: "select-a",
              beforeCardBlockId: second.id,
            },
          ]),
        );
        expect(resultCode(boardDrag)).toBe("ok");
        expect(
          boardDrag.ok ? boardDrag.value.operationKinds.join(",") : "rejected",
        ).toBe("set_value,position_card");
        const groupedRows = queryGeneralDatabaseView(
          fixture.projectId,
          "view-custom-grouped",
          fixture.database,
        )?.rows;
        expect(groupedRows?.map((row) => row.card.blockId).join(",")).toBe(
          `${first.id},${second.id}`,
        );
        expect(groupedRows?.[0]?.position?.revision).toBe(3);

        const invalidFilter = applyDatabaseMutation(
          fixture.database,
          request(fixture, "invalid-filter", {
            kind: "put_view",
            databaseBlockId: "database-custom",
            viewId: "view-invalid",
            expectedRevision: 0,
            name: "Invalid",
            viewKind: "list",
            config: viewConfig({
              filter: {
                kind: "group",
                operator: "and",
                children: [
                  {
                    kind: "clause",
                    propertyId: "property-number",
                    operator: "contains",
                    value: 4,
                  },
                ],
              },
            }),
            isPrimary: false,
          }),
        );
        expect(resultCode(invalidFilter)).toBe("property_value_invalid");

        const updatedSelect = applyDatabaseMutation(
          fixture.database,
          request(fixture, "rename-select-options", {
            kind: "put_property",
            databaseBlockId: "database-custom",
            propertyId: "property-select",
            expectedDatabaseSchemaRevision: 9,
            expectedPropertyRevision: 1,
            key: "select",
            name: "Renamed select",
            valueType: "select",
            config: {
              options: [
                { id: "select-a", name: "Renamed A" },
                { id: "select-b", name: "B" },
              ],
            },
          }),
        );
        expect(resultCode(updatedSelect)).toBe("ok");
        const removeUsedOption = applyDatabaseMutation(
          fixture.database,
          request(fixture, "remove-used-option", {
            kind: "put_property",
            databaseBlockId: "database-custom",
            propertyId: "property-select",
            expectedDatabaseSchemaRevision: 10,
            expectedPropertyRevision: 2,
            key: "select",
            name: "Select",
            valueType: "select",
            config: { options: [{ id: "select-a", name: "A" }] },
          }),
        );
        expect(resultCode(removeUsedOption)).toBe("property_option_in_use");
      });
    },
  );
});
