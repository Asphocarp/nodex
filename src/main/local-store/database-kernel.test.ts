import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUuidV7, isUuidV7 } from "../../shared/uuid-v7";
import type {
  DatabaseMutationOperation,
  DatabaseMutationRequest,
  DatabaseViewConfig,
} from "../../shared/database-kernel";
import { createPage } from "./database-pages";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  applyDatabaseMutation,
  transitionPageDatabaseParent,
  type DatabaseMutationFaultPoint,
} from "./database-kernel";
import {
  queryDatabaseViewInDatabase,
  readDatabaseContainerDescriptorInDatabase,
} from "./database-module";
import { createProject } from "./projects";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly storeEpoch: string;
}

const readDatabaseDescriptorForTest = (
  _projectId: string,
  databaseId: string,
  database: Database.Database,
) => readDatabaseContainerDescriptorInDatabase(database, databaseId);

const queryDatabaseViewForTest = (
  _projectId: string,
  viewId: string,
  database: Database.Database,
) => queryDatabaseViewInDatabase(database, viewId);

type TransferMembershipOperation = Extract<
  DatabaseMutationOperation,
  { readonly kind: "transfer_membership" }
>;

const databaseIds = new Map<string, string>();

const testDatabaseId = (value: string): string => {
  if (isUuidV7(value) || value.startsWith("database:")) return value;
  const existing = databaseIds.get(value);
  if (existing) return existing;
  const created = createUuidV7();
  databaseIds.set(value, created);
  return created;
};

const normalizeOperationDatabaseId = (
  operation: DatabaseMutationOperation,
): DatabaseMutationOperation => {
  if ("databaseBlockId" in operation) {
    return {
      ...operation,
      databaseBlockId: testDatabaseId(operation.databaseBlockId),
    } as DatabaseMutationOperation;
  }
  if (operation.kind !== "transfer_membership" || !operation.target) {
    return operation;
  }
  return {
    ...operation,
    target: {
      ...operation.target,
      databaseBlockId: testDatabaseId(operation.target.databaseBlockId),
    },
  };
};

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
  overrides: Partial<DatabaseViewConfig> = {},
): DatabaseViewConfig => ({
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
  operations: [normalizeOperationDatabaseId(operation)],
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
  operations: operations.map(normalizeOperationDatabaseId),
});

const createDatabaseOperation = (
  databaseBlockId: string,
  viewId: string,
): Extract<
  DatabaseMutationOperation,
  { readonly kind: "create_database" }
> => ({
  kind: "create_database",
  databaseBlockId: testDatabaseId(databaseBlockId),
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
  pageId: string,
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
      WHERE page_block_id = ? AND project_id = ? AND removed_at IS NULL
    `,
    )
    .get(pageId, fixture.projectId) as {
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
        const descriptor = readDatabaseDescriptorForTest(
          fixture.projectId,
          testDatabaseId("database-research"),
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
            .prepare("SELECT 1 FROM blocks WHERE id = ?")
            .get(testDatabaseId("database-fault")) === undefined,
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
            readDatabaseDescriptorForTest(
              fixture.projectId,
              testDatabaseId("database-research"),
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
        const card = await createPage(fixture.projectId, "draft", {
          title: "No arbitrary option IDs",
        });
        const membership = readActiveMembership(fixture, card.id);
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "transfer-empty-options", {
                kind: "transfer_membership",
                pageId: card.id,
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
                pageId: card.id,
                databaseBlockId: "database-empty-options",
                propertyId: "property-empty-select",
                expectedValueRevision: 1,
                value: "unregistered-option",
              }),
            ),
          ),
        ).toBe("property_value_invalid");
      });
    },
  );


  sqliteTest(
    "reactivates dormant membership and restores its Database values",
    async () => {
      await withFixture(async (fixture) => {
        const card = await createPage(fixture.projectId, "draft", {
          title: "Return to Database",
        });
        const original = readActiveMembership(fixture, card.id);
        const primary = fixture.database
          .prepare(
            `
            SELECT capability.block_id AS database_block_id,
              view.id AS view_id,
              property.id AS priority_property_id
            FROM database_capabilities capability
            INNER JOIN database_views view
              ON view.database_block_id = capability.block_id
             AND view.project_id = capability.project_id
             AND view.is_primary = 1
            INNER JOIN database_properties property
              ON property.database_block_id = capability.block_id
             AND property.project_id = capability.project_id
             AND property.key = 'priority'
             AND property.lifecycle = 'active'
            WHERE capability.project_id = ? AND capability.is_primary = 1
          `,
          )
          .get(fixture.projectId) as {
          readonly database_block_id: string;
          readonly view_id: string;
          readonly priority_property_id: string;
        };
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "set-priority-before-leaving", {
                kind: "set_value",
                pageId: card.id,
                databaseBlockId: primary.database_block_id,
                propertyId: primary.priority_property_id,
                expectedValueRevision: 1,
                value: "p1-high",
              }),
            ),
          ),
        ).toBe("ok");

        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(
                fixture,
                "create-dormant-target",
                createDatabaseOperation(
                  "database-dormant-target",
                  "view-dormant-target",
                ),
              ),
            ),
          ),
        ).toBe("ok");
        addProperty(fixture, {
          operationId: "add-mapped-priority",
          databaseBlockId: "database-dormant-target",
          propertyId: "property-dormant-priority",
          databaseRevision: 1,
          key: "priority",
          valueType: "select",
          config: {
            options: [{ id: "custom-high", name: "P1 - High" }],
          },
        });
        const transitionMembership = (
          operationId: string,
          operation: TransferMembershipOperation,
        ) => {
          const mutation = request(fixture, operationId, operation);
          return transitionPageDatabaseParent(
            fixture.database,
            {
              ...mutation,
              operation: mutation.operations[0] as TransferMembershipOperation,
            },
            new Date().toISOString(),
          );
        };
        expect(() =>
          transitionMembership("leave-primary", {
                kind: "transfer_membership",
                pageId: card.id,
                expectedMembership: {
                  membershipId: original.id,
                  revision: original.revision,
                },
                target: {
                  databaseBlockId: "database-dormant-target",
                  membershipId: "membership-dormant-target",
                  viewId: "view-dormant-target",
                  groupKey: null,
                },
              }),
        ).not.toThrow();
        const temporary = readActiveMembership(fixture, card.id);
        expect(
          fixture.database
            .prepare(
              `
              SELECT value_json
              FROM database_property_values
              WHERE membership_id = ? AND property_id = 'property-dormant-priority'
            `,
            )
            .get(temporary.id),
        ).toEqual({ value_json: '"custom-high"' });

        expect(() =>
          transitionMembership("return-primary", {
                kind: "transfer_membership",
                pageId: card.id,
                expectedMembership: {
                  membershipId: temporary.id,
                  revision: temporary.revision,
                },
                target: {
                  databaseBlockId: primary.database_block_id,
                  membershipId: "membership-must-not-be-created",
                  viewId: primary.view_id,
                  groupKey: "draft",
                },
              }),
        ).not.toThrow();

        const restored = readActiveMembership(fixture, card.id);
        expect(restored.id).toBe(original.id);
        expect(restored.revision).toBe(original.revision + 2);
        expect(
          fixture.database
            .prepare(
              `
              SELECT value_json, revision
              FROM database_property_values
              WHERE membership_id = ? AND property_id = ?
            `,
            )
            .get(restored.id, primary.priority_property_id),
        ).toEqual({ value_json: '"p1-high"', revision: 2 });
        expect(
          fixture.database
            .prepare(
              "SELECT 1 FROM database_memberships WHERE id = 'membership-must-not-be-created'",
            )
            .get(),
        ).toBeUndefined();
        expect(
          fixture.database
            .prepare(
              "SELECT removed_at FROM database_memberships WHERE id = ?",
            )
            .get(temporary.id),
        ).toEqual({ removed_at: expect.any(String) });
        expect(
          queryDatabaseViewForTest(
            fixture.projectId,
            "view-dormant-target",
            fixture.database,
          )?.rows.some((row) => row.page.pageId === card.id),
        ).toBe(false);

        const unpositioned = transitionMembership("return-without-position", {
          kind: "transfer_membership",
          pageId: card.id,
          expectedMembership: {
            membershipId: restored.id,
            revision: restored.revision,
          },
          target: {
            databaseBlockId: "database-dormant-target",
            membershipId: "membership-must-still-not-be-created",
          },
        });
        const reactivated = readActiveMembership(fixture, card.id);
        expect(unpositioned.payload.positionRevision).toBe(null);
        expect(unpositioned.committedRevisions).toMatchObject({
          membership: reactivated.revision,
          position: 0,
        });
        expect(
          fixture.database
            .prepare(
              "SELECT COUNT(*) FROM database_view_positions WHERE block_id = ?",
            )
            .pluck()
            .get(card.id),
        ).toBe(0);
        expect(
          queryDatabaseViewForTest(
            fixture.projectId,
            "view-dormant-target",
            fixture.database,
          )?.rows.find((row) => row.page.pageId === card.id)?.position,
        ).toBe(null);
      });
    },
  );

  sqliteTest(
    "atomically transfers membership, supports typed custom values, and isolates View order",
    async () => {
      await withFixture(async (fixture) => {
        const first = await createPage(fixture.projectId, "draft", {
          title: "First",
        });
        const second = await createPage(fixture.projectId, "draft", {
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
          beforePageId?: string,
        ): void => {
          const current = readActiveMembership(fixture, cardId);
          const result = applyDatabaseMutation(
            fixture.database,
            request(fixture, operationId, {
              kind: "transfer_membership",
              pageId: cardId,
              expectedMembership: {
                membershipId: current.id,
                revision: current.revision,
              },
              target: {
                databaseBlockId: "database-custom",
                membershipId: `membership-custom-${cardId}`,
                viewId: "view-custom",
                groupKey: null,
                ...(beforePageId === undefined
                  ? {}
                  : { beforePageId }),
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
          queryDatabaseViewForTest(
            fixture.projectId,
            "view-custom",
            fixture.database,
          )
            ?.rows.map((row) => row.page.pageId)
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
                  pageId: first.id,
                  databaseBlockId: "database-custom",
                  propertyId: value.propertyId,
                  expectedValueRevision: 1,
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
                pageId: first.id,
                databaseBlockId: "database-custom",
                propertyId: "property-multi",
                expectedValueRevision: 1,
                value: ["multi-a"],
              }),
            ),
          ),
        ).toBe("property_value_invalid");
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "mutate-multi-options", {
                kind: "add_remove_value",
                pageId: first.id,
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
        const sequentialPositions = applyDatabaseMutation(
          fixture.database,
          batchRequest(fixture, "position-sequential-pages", [
            {
              kind: "position_page",
              viewId: "view-custom-second",
              pageId: first.id,
              expectedPositionRevision: 0,
              groupKey: null,
            },
            {
              kind: "position_page",
              viewId: "view-custom-second",
              pageId: second.id,
              expectedPositionRevision: 0,
              groupKey: null,
            },
          ]),
        );
        expect(resultCode(sequentialPositions)).toBe("ok");
        expect(
          queryDatabaseViewForTest(
            fixture.projectId,
            "view-custom-second",
            fixture.database,
          )
            ?.rows.map((row) => row.page.pageId)
            .join(","),
        ).toBe(`${first.id},${second.id}`);

        fixture.database
          .prepare("UPDATE blocks SET created_at = ? WHERE id = ?")
          .run("2026-07-12T02:00:00.000Z", first.id);
        fixture.database
          .prepare("UPDATE pages SET created_at = ? WHERE block_id = ?")
          .run("2026-07-12T02:00:00.000Z", first.id);
        fixture.database
          .prepare("UPDATE blocks SET created_at = ? WHERE id = ?")
          .run("2026-07-12T01:00:00.000Z", second.id);
        fixture.database
          .prepare("UPDATE pages SET created_at = ? WHERE block_id = ?")
          .run("2026-07-12T01:00:00.000Z", second.id);
        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "create-created-view", {
                kind: "put_view",
                databaseBlockId: "database-custom",
                viewId: "view-custom-created",
                expectedRevision: 0,
                name: "Newest first",
                viewKind: "list",
                config: viewConfig({
                  sort: [
                    {
                      field: { kind: "created" },
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
          queryDatabaseViewForTest(
            fixture.projectId,
            "view-custom-created",
            fixture.database,
          )
            ?.rows.map((row) => row.page.pageId)
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
          queryDatabaseViewForTest(
            fixture.projectId,
            "view-custom-desc",
            fixture.database,
          )
            ?.rows.map((row) => row.page.pageId)
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
                kind: "position_page",
                viewId: "view-custom-grouped",
                pageId: first.id,
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
                kind: "position_page",
                viewId: "view-custom-grouped",
                pageId: first.id,
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
            pageId: first.id,
            databaseBlockId: "database-custom",
            propertyId: "property-select",
            expectedValueRevision: 2,
            value: "select-b",
          }),
        );
        expect(resultCode(moveGroup)).toBe("ok");
        expect(
          queryDatabaseViewForTest(
            fixture.projectId,
            "view-custom-grouped",
            fixture.database,
          )?.rows.find((row) => row.page.pageId === first.id)
            ?.effectiveGroupKey,
        ).toBe("select-b");

        expect(
          resultCode(
            applyDatabaseMutation(
              fixture.database,
              request(fixture, "set-second-group", {
                kind: "set_value",
                pageId: second.id,
                databaseBlockId: "database-custom",
                propertyId: "property-select",
                expectedValueRevision: 1,
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
                kind: "position_page",
                viewId: "view-custom-grouped",
                pageId: second.id,
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
              pageId: first.id,
              databaseBlockId: "database-custom",
              propertyId: "property-select",
              expectedValueRevision: 3,
              value: "select-a",
            },
            {
              kind: "position_page",
              viewId: "view-custom-grouped",
              pageId: first.id,
              expectedPositionRevision: 2,
              groupKey: "select-a",
              beforePageId: second.id,
            },
          ]),
        );
        expect(resultCode(boardDrag)).toBe("ok");
        expect(
          boardDrag.ok ? boardDrag.value.operationKinds.join(",") : "rejected",
        ).toBe("set_value,position_page");
        const groupedRows = queryDatabaseViewForTest(
          fixture.projectId,
          "view-custom-grouped",
          fixture.database,
        )?.rows;
        expect(groupedRows?.map((row) => row.page.pageId).join(",")).toBe(
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
            config: { options: [{ id: "select-b", name: "B" }] },
          }),
        );
        expect(resultCode(removeUsedOption)).toBe("property_option_in_use");
      });
    },
  );

  sqliteTest(
    "materializes an unpositioned target group for one cross-group Page run",
    async () => {
      await withFixture(async (fixture) => {
        const movedFirst = await createPage(fixture.projectId, "in_progress", {
          title: "Moved first",
        });
        const movedSecond = await createPage(fixture.projectId, "in_progress", {
          title: "Moved second",
        });
        const targetFirst = await createPage(fixture.projectId, "draft", {
          title: "Target first",
        });
        const targetSecond = await createPage(fixture.projectId, "draft", {
          title: "Target second",
        });
        const primary = fixture.database.prepare(`
          SELECT project.database_block_id, view.id AS view_id
          FROM projects project
          INNER JOIN database_views view
            ON view.database_block_id = project.database_block_id
            AND view.project_id = project.id
            AND view.is_primary = 1
            AND view.lifecycle = 'active'
          WHERE project.id = ?
        `).get(fixture.projectId) as {
          readonly database_block_id: string;
          readonly view_id: string;
        };
        const initial = queryDatabaseViewForTest(
          fixture.projectId,
          primary.view_id,
          fixture.database,
        );
        const status = initial?.properties.find((property) => property.key === "status");
        if (!initial || !status) throw new Error("Missing primary View status property");
        expect(resultCode(applyDatabaseMutation(
          fixture.database,
          request(fixture, "logical-target:configure-view-order", {
            kind: "put_view",
            databaseBlockId: primary.database_block_id,
            viewId: primary.view_id,
            expectedRevision: initial.view.revision,
            name: initial.view.name,
            viewKind: initial.view.kind,
            config: viewConfig({
              group: { propertyId: status.propertyId },
              sort: [
                {
                  field: { kind: "manual" },
                  direction: "asc",
                  nulls: "first",
                },
                {
                  field: { kind: "title" },
                  direction: "desc",
                  nulls: "last",
                },
              ],
            }),
            isPrimary: true,
          }),
        ))).toBe("ok");

        const removeManualPosition = (pageId: string, prefix: string): void => {
          const membership = readActiveMembership(fixture, pageId);
          const detached = applyDatabaseMutation(
            fixture.database,
            request(fixture, `${prefix}:detach`, {
              kind: "transfer_membership",
              pageId,
              expectedMembership: {
                membershipId: membership.id,
                revision: membership.revision,
              },
              target: null,
            }),
          );
          expect(resultCode(detached)).toBe("ok");
          const restored = applyDatabaseMutation(
            fixture.database,
            request(fixture, `${prefix}:restore`, {
              kind: "transfer_membership",
              pageId,
              expectedMembership: null,
              target: {
                databaseBlockId: primary.database_block_id,
                membershipId: `${prefix}:unused-membership`,
              },
            }),
          );
          expect(resultCode(restored)).toBe("ok");
        };

        removeManualPosition(targetFirst.id, "logical-target:first");
        removeManualPosition(targetSecond.id, "logical-target:second");
        const before = queryDatabaseViewForTest(
          fixture.projectId,
          primary.view_id,
          fixture.database,
        );
        if (!before) throw new Error("Missing primary View");
        const rows = new Map(before.rows.map((row) => [row.page.pageId, row] as const));
        const targetOrder = before.rows
          .filter((row) => [targetFirst.id, targetSecond.id].includes(row.page.pageId))
          .map((row) => row.page.pageId);
        expect(targetOrder).toEqual([targetSecond.id, targetFirst.id]);
        expect(targetOrder.every((pageId) => rows.get(pageId)?.position === null)).toBe(true);

        const movedPageIds = [movedSecond.id, movedFirst.id];
        const result = applyDatabaseMutation(
          fixture.database,
          batchRequest(fixture, "logical-position-run", [
            {
              kind: "set_values",
              databaseBlockId: primary.database_block_id,
              entries: movedPageIds.map((pageId) => ({
                pageId,
                propertyId: status.propertyId,
                expectedValueRevision:
                  rows.get(pageId)?.values[status.propertyId]?.revision ?? 0,
                value: "draft",
              })),
            },
            ...movedPageIds.map((pageId) => ({
              kind: "position_page",
              viewId: primary.view_id,
              pageId,
              expectedPositionRevision: rows.get(pageId)?.position?.revision ?? 0,
              groupKey: "draft",
              beforePageId: targetOrder[1],
            } as const)),
          ]),
        );

        expect(resultCode(result)).toBe("ok");
        const after = queryDatabaseViewForTest(
          fixture.projectId,
          primary.view_id,
          fixture.database,
        );
        expect(after?.rows
          .filter((row) => [...targetOrder, ...movedPageIds].includes(row.page.pageId))
          .map((row) => row.page.pageId)).toEqual([
            targetOrder[0],
            ...movedPageIds,
            targetOrder[1],
          ]);
        expect(after?.rows
          .filter((row) => targetOrder.includes(row.page.pageId))
          .map((row) => row.position?.revision)).toEqual([1, 1]);
      });
    },
  );
});
