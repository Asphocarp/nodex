import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  makeBlockPropertyFieldPathV2,
  parseBlockPropertyMutationRequestV2,
  type BlockPropertyMutationCommandResultV2,
} from "../../shared/block-property-mutations-v2";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import { WORKFLOW_STATUS_ORDER } from "../../shared/workflow-status";
import {
  applyLibrarySourceBlockPropertyMutationV2,
  applySourceBlockPropertyMutationV2,
} from "./block-property-mutations-v2-store";

const NOW = "2026-07-18T02:00:00.000Z";
const SOURCE_ID = "source-1";
const DATABASE_ID = "database-1";
const PAGE_ID = "page-1";
const MEMBERSHIP_ID = "membership-1";
const CUSTOM_SELECT_ID = "p_AAAAAAAA";
const CUSTOM_MULTI_ID = "p_BBBBBBBB";
const MIXED_CASE_MULTI_ID = "p_DDDDDDDD";
const OPTION_A = "o_AAAAAAAA";
const OPTION_B = "o_BBBBBBBB";
const OPTION_LOWER = "o_aAAAAAAA";
const OPTION_UNKNOWN = "o_ZZZZZZZZ";

interface Fixture {
  readonly database: Database.Database;
  readonly storeEpoch: string;
}

const createFixture = (): Fixture => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE block_store_metadata (
      id INTEGER PRIMARY KEY,
      store_epoch TEXT NOT NULL
    );
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE libraries (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      database_block_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      created TEXT NOT NULL
    );
    CREATE TABLE blocks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      location_kind TEXT NOT NULL,
      containing_document_id TEXT,
      metadata_revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE pages (
      block_id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      parent_kind TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL
    );
    CREATE TABLE block_documents (
      block_id TEXT NOT NULL,
      document_id TEXT NOT NULL
    );
    CREATE TABLE database_containers (
      block_id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL
    );
    CREATE TABLE data_sources (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      home_database_block_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL
    );
    CREATE TABLE project_resource_grants (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      library_id TEXT NOT NULL,
      root_kind TEXT NOT NULL,
      root_id TEXT NOT NULL,
      access TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE data_source_page_memberships (
      id TEXT NOT NULL,
      data_source_id TEXT NOT NULL,
      page_block_id TEXT NOT NULL,
      removed_at TEXT,
      PRIMARY KEY (id, data_source_id)
    );
    CREATE TABLE data_source_properties (
      data_source_id TEXT NOT NULL,
      id TEXT NOT NULL,
      value_type TEXT NOT NULL,
      config_json TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      PRIMARY KEY (data_source_id, id)
    );
    CREATE TABLE data_source_property_values (
      data_source_id TEXT NOT NULL,
      membership_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (data_source_id, membership_id, property_id)
    );
    CREATE TABLE block_properties (
      block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      property_key TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (block_id, project_id, property_key)
    );
    CREATE TABLE database_views (
      id TEXT PRIMARY KEY,
      data_source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL,
      lifecycle TEXT NOT NULL
    );
    CREATE TABLE database_view_page_positions (
      view_id TEXT NOT NULL,
      page_block_id TEXT NOT NULL,
      group_key TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (view_id, page_block_id)
    );
    CREATE TABLE change_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      store_epoch TEXT NOT NULL,
      kind TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      block_ids_json TEXT NOT NULL,
      document_ids_json TEXT NOT NULL,
      database_block_ids_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      committed_at TEXT NOT NULL
    );
    CREATE TABLE block_mutations (
      mutation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      store_epoch TEXT NOT NULL,
      mutation_kind TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      client_session_id TEXT,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      target_block_ids_json TEXT NOT NULL,
      affected_document_ids_json TEXT NOT NULL,
      affected_database_block_ids_json TEXT NOT NULL,
      field_intents_json TEXT NOT NULL,
      expected_revisions_json TEXT NOT NULL,
      outcome TEXT NOT NULL,
      result_json TEXT NOT NULL,
      committed_revisions_json TEXT NOT NULL,
      document_heads_json TEXT NOT NULL,
      change_log_seq INTEGER,
      recorded_at TEXT NOT NULL
    );
  `);
  const storeEpoch = "epoch-v81";
  database.prepare(
    "INSERT INTO block_store_metadata (id, store_epoch) VALUES (1, ?)",
  ).run(storeEpoch);
  database.prepare(`
    INSERT INTO profiles (id, created_at) VALUES ('profile-1', ?)
  `).run(NOW);
  database.prepare(`
    INSERT INTO libraries (id, profile_id) VALUES ('library-1', 'profile-1')
  `).run();
  database.prepare(`
    INSERT INTO projects (
      id, library_id, database_block_id, lifecycle, created
    ) VALUES
      ('project-1', 'library-1', 'database-1', 'active', ?),
      ('project-2', 'library-1', 'database-2', 'active', ?)
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, metadata_revision, updated_at
    ) VALUES
      ('database-1', 'project-1', 'database', 'active', 'space', NULL, 1, ?),
      ('page-1', 'project-1', 'page', 'active', 'database', NULL, 4, ?)
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO pages (
      block_id, library_id, document_id, parent_kind, parent_id, lifecycle
    ) VALUES ('page-1', 'library-1', 'document-1', 'data_source', 'source-1', 'active')
  `).run();
  database.prepare(`
    INSERT INTO database_containers (block_id, library_id, lifecycle)
    VALUES ('database-1', 'library-1', 'active')
  `).run();
  database.prepare(`
    INSERT INTO data_sources (
      id, library_id, home_database_block_id, lifecycle
    ) VALUES
      ('source-1', 'library-1', 'database-1', 'active'),
      ('source-2', 'library-1', 'database-1', 'active')
  `).run();
  database.prepare(`
    INSERT INTO data_source_page_memberships (
      id, data_source_id, page_block_id, removed_at
    ) VALUES ('membership-1', 'source-1', 'page-1', NULL)
  `).run();
  const statusConfig = JSON.stringify({
    options: WORKFLOW_STATUS_ORDER.map((id) => ({ id, name: id })),
  });
  const optionsConfig = JSON.stringify({
    options: [
      { id: OPTION_A, name: "Alpha" },
      { id: OPTION_B, name: "Beta" },
    ],
  });
  const mixedCaseOptionsConfig = JSON.stringify({
    options: [
      { id: OPTION_LOWER, name: "Lower" },
      { id: OPTION_B, name: "Upper" },
    ],
  });
  const insertProperty = database.prepare(`
    INSERT INTO data_source_properties (
      data_source_id, id, value_type, config_json, lifecycle
    ) VALUES (?, ?, ?, ?, 'active')
  `);
  insertProperty.run(SOURCE_ID, "status", "select", statusConfig);
  insertProperty.run(SOURCE_ID, "tags", "multi_select", optionsConfig);
  insertProperty.run(SOURCE_ID, CUSTOM_SELECT_ID, "select", optionsConfig);
  insertProperty.run(SOURCE_ID, CUSTOM_MULTI_ID, "multi_select", optionsConfig);
  insertProperty.run(
    SOURCE_ID,
    MIXED_CASE_MULTI_ID,
    "multi_select",
    mixedCaseOptionsConfig,
  );
  insertProperty.run(SOURCE_ID, "scheduled_start", "datetime", "{}");
  insertProperty.run(SOURCE_ID, "scheduled_end", "datetime", "{}");
  insertProperty.run("source-2", "p_CCCCCCCC", "multi_select", optionsConfig);
  const insertValue = database.prepare(`
    INSERT INTO data_source_property_values (
      data_source_id, membership_id, property_id, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertValue.run(SOURCE_ID, MEMBERSHIP_ID, "status", "select", '"triage"', 1, NOW);
  insertValue.run(
    SOURCE_ID,
    MEMBERSHIP_ID,
    "tags",
    "multi_select",
    JSON.stringify([OPTION_A]),
    1,
    NOW,
  );
  database.prepare(`
    INSERT INTO database_views (id, data_source_id, kind, config_json, lifecycle)
    VALUES (
      'view-1', 'source-1', 'kanban',
      '{"group":{"propertyId":"status"}}', 'active'
    )
  `).run();
  database.prepare(`
    INSERT INTO database_view_page_positions (
      view_id, page_block_id, group_key, updated_at
    ) VALUES ('view-1', 'page-1', 'triage', ?)
  `).run(NOW);
  return { database, storeEpoch };
};

const withFixture = (
  run: (fixture: Fixture) => void,
): void => {
  const fixture = createFixture();
  try {
    run(fixture);
  } finally {
    fixture.database.close();
  }
};

const request = (
  fixture: Fixture,
  mutationId: string,
  fields: readonly unknown[],
  projectId = "project-1",
): unknown => ({
  version: 2,
  mutationId,
  projectId,
  storeEpoch: fixture.storeEpoch,
  clientSessionId: "test-session",
  actor: { kind: "test" },
  fields,
});

const apply = (
  fixture: Fixture,
  mutationId: string,
  fields: readonly unknown[],
  projectId = "project-1",
): BlockPropertyMutationCommandResultV2 =>
  applySourceBlockPropertyMutationV2(
    fixture.database,
    request(fixture, mutationId, fields, projectId),
    { now: () => NOW },
  );

const scalarField = (
  propertyId: string,
  value: string | null,
  expectedRevision: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  scope: "data_source",
  pageId: PAGE_ID,
  dataSourceId: SOURCE_ID,
  propertyId,
  operation: "set",
  expectedRevision,
  value,
  ...overrides,
});

const setField = (
  propertyId: string,
  add: readonly string[],
  remove: readonly string[],
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  scope: "data_source",
  pageId: PAGE_ID,
  dataSourceId: SOURCE_ID,
  propertyId,
  operation: "add_remove",
  add,
  remove,
  ...overrides,
});

const intrinsicField = (
  propertyKey: string,
  value: unknown,
  expectedRevision: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  scope: "intrinsic",
  blockId: PAGE_ID,
  propertyKey,
  operation: "set",
  expectedRevision,
  value,
  ...overrides,
});

const requireOk = (
  result: BlockPropertyMutationCommandResultV2,
): Extract<BlockPropertyMutationCommandResultV2, { readonly ok: true }> => {
  expect(result.ok).toBe(true);
  if (result.ok) return result;
  throw new Error(`Expected success, got ${result.error.code}`);
};

const requireError = (
  result: BlockPropertyMutationCommandResultV2,
): Extract<BlockPropertyMutationCommandResultV2, { readonly ok: false }> => {
  expect(result.ok).toBe(false);
  if (!result.ok) return result;
  throw new Error("Expected a rejected mutation");
};

describe("dormant Source Block Property v2 store", () => {
  test("commits Page properties through Library authority after its compatibility Project is archived", () => {
    withFixture((fixture) => {
      fixture.database.prepare(`
        UPDATE projects SET lifecycle = 'archived' WHERE id = 'project-1'
      `).run();
      const committed = requireOk(
        applyLibrarySourceBlockPropertyMutationV2(
          fixture.database,
          {
            version: 2,
            mutationId: "library-page-properties",
            storeEpoch: fixture.storeEpoch,
            clientSessionId: "library-test",
            fields: [
              {
                scope: "data_source",
                pageId: PAGE_ID,
                dataSourceId: parseDataSourceId(SOURCE_ID),
                propertyId: parseDataSourcePropertyId("status"),
                operation: "set",
                expectedRevision: 1,
                value: "build",
              },
              {
                scope: "intrinsic",
                blockId: PAGE_ID,
                propertyKey: "run.target",
                operation: "set",
                expectedRevision: 0,
                value: "localProject",
              },
            ],
          },
          { kind: "test" },
          "app_window",
          { now: () => NOW },
        ),
      );
      expect(committed.value).toMatchObject({
        projectId: "project-1",
        blockMetadataRevisions: { [PAGE_ID]: 5 },
      });
      expect(committed.value.fields.map((field) => field.path)).toEqual([
        "data_source/source-1/page-1/status",
        "intrinsic/page-1/run.target",
      ]);
    });
  });

  test("commits Source paths with CAS, status grouping, exact retry, and coupled evidence", () => {
    withFixture((fixture) => {
      const raw = request(
        fixture,
        "status-1",
        [scalarField("status", "build", 1)],
      );
      const committed = requireOk(
        applySourceBlockPropertyMutationV2(fixture.database, raw, {
          now: () => NOW,
        }),
      );
      const parsedRequest = parseBlockPropertyMutationRequestV2(raw);
      const path = makeBlockPropertyFieldPathV2(parsedRequest.fields[0]!);
      expect(committed.value.fields).toEqual([
        {
          path,
          scope: "data_source",
          blockId: PAGE_ID,
          dataSourceId: SOURCE_ID,
          propertyId: "status",
          operation: "set",
          revision: 2,
          value: "build",
        },
      ]);
      expect(committed.value.blockMetadataRevisions).toEqual({ [PAGE_ID]: 5 });
      expect(
        fixture.database.prepare(`
          SELECT group_key FROM database_view_page_positions
          WHERE view_id = 'view-1' AND page_block_id = 'page-1'
        `).pluck().get(),
      ).toBe("build");

      const retry = requireOk(
        applySourceBlockPropertyMutationV2(fixture.database, raw, {
          now: () => "2026-07-18T03:00:00.000Z",
        }),
      );
      expect(retry.value).toMatchObject({ duplicate: true, changeLogSeq: 1 });
      expect(
        fixture.database.prepare("SELECT COUNT(*) FROM change_log").pluck().get(),
      ).toBe(1);

      const ledger = fixture.database.prepare(`
        SELECT request_json, request_hash, field_intents_json,
          affected_database_block_ids_json, result_json,
          committed_revisions_json, change_log_seq
        FROM block_mutations WHERE mutation_id = 'status-1'
      `).get() as Readonly<Record<string, string | number>>;
      expect(
        createHash("sha256")
          .update(ledger.request_json as string)
          .digest("hex"),
      ).toBe(ledger.request_hash);
      expect(JSON.parse(ledger.request_json as string)).toMatchObject({ version: 2 });
      expect(JSON.parse(ledger.field_intents_json as string)).toEqual([
        { path, operation: "set", scope: "data_source" },
      ]);
      expect(JSON.parse(ledger.affected_database_block_ids_json as string))
        .toEqual([DATABASE_ID]);
      const payload = JSON.parse(
        fixture.database.prepare(
          "SELECT payload_json FROM change_log WHERE seq = 1",
        ).pluck().get() as string,
      ) as Readonly<Record<string, unknown>>;
      expect(payload).toMatchObject({
        version: 2,
        requestHash: ledger.request_hash,
        fieldPaths: [path],
      });
    });
  });

  test("commits intrinsic CAS evidence and exact retries without the legacy kernel", () => {
    withFixture((fixture) => {
      const raw = request(fixture, "intrinsic-run-target", [
        intrinsicField("run.target", "localProject", 0),
      ]);
      const committed = requireOk(
        applySourceBlockPropertyMutationV2(fixture.database, raw, {
          now: () => NOW,
        }),
      );
      expect(committed.value.fields).toEqual([
        {
          path: "intrinsic/page-1/run.target",
          scope: "intrinsic",
          blockId: PAGE_ID,
          propertyKey: "run.target",
          operation: "set",
          revision: 1,
          value: "localProject",
        },
      ]);
      expect(
        fixture.database.prepare(`
          SELECT project_id, value_type, value_json, revision
          FROM block_properties
          WHERE block_id = 'page-1' AND property_key = 'run.target'
        `).get(),
      ).toEqual({
        project_id: "project-1",
        value_type: "string",
        value_json: '"localProject"',
        revision: 1,
      });
      expect(
        requireOk(
          applySourceBlockPropertyMutationV2(fixture.database, raw, {
            now: () => "2026-07-18T04:00:00.000Z",
          }),
        ).value.duplicate,
      ).toBe(true);

      const stale = requireError(
        apply(fixture, "intrinsic-stale", [
          intrinsicField("run.target", "localProject", 0),
        ]),
      );
      expect(stale.error).toMatchObject({
        code: "property_conflict",
        expectedRevision: 0,
        actualRevision: 1,
      });
      expect(
        requireError(
          apply(fixture, "intrinsic-retired", [
            intrinsicField("agent.status", "running", 0),
          ]),
        ).error.code,
      ).toBe("property_not_found");
    });
  });

  test("commits mixed Source and intrinsic schedule fields atomically with one projection input", () => {
    withFixture((fixture) => {
      const projectionInputs: unknown[] = [];
      const raw = request(fixture, "mixed-schedule", [
        scalarField("scheduled_start", "2026-07-20T10:00:00.000Z", 0),
        scalarField("scheduled_end", "2026-07-20T11:00:00.000Z", 0),
        intrinsicField("schedule.isAllDay", false, 0),
        intrinsicField("schedule.timezone", "UTC", 0),
      ]);
      const committed = requireOk(
        applySourceBlockPropertyMutationV2(fixture.database, raw, {
          now: () => NOW,
          refreshProjections: (_database, input) => {
            projectionInputs.push(input);
          },
        }),
      );
      expect(committed.value.fields.map((field) => field.scope)).toEqual([
        "data_source",
        "data_source",
        "intrinsic",
        "intrinsic",
      ]);
      expect(committed.value.blockMetadataRevisions).toEqual({ [PAGE_ID]: 5 });
      expect(projectionInputs).toEqual([
        {
          projectId: "project-1",
          pageIds: [PAGE_ID],
          dataSourceIds: [SOURCE_ID],
          databaseIds: [DATABASE_ID],
          updatedAt: NOW,
        },
      ]);
      expect(
        fixture.database.prepare(`
          SELECT COUNT(*) FROM block_properties
          WHERE block_id = 'page-1'
            AND property_key IN ('schedule.isAllDay', 'schedule.timezone')
        `).pluck().get(),
      ).toBe(2);
      expect(
        fixture.database.prepare(`
          SELECT COUNT(*) FROM data_source_property_values
          WHERE membership_id = 'membership-1'
            AND property_id IN ('scheduled_start', 'scheduled_end')
        `).pluck().get(),
      ).toBe(2);
      const retry = requireOk(
        applySourceBlockPropertyMutationV2(fixture.database, raw, {
          now: () => NOW,
          refreshProjections: () => {
            throw new Error("exact retry must not refresh projections");
          },
        }),
      );
      expect(retry.value.duplicate).toBe(true);
    });
  });

  test("rejects a mixed batch before any write when one intrinsic CAS is stale", () => {
    withFixture((fixture) => {
      fixture.database.prepare(`
        INSERT INTO block_properties (
          block_id, project_id, property_key, value_type, value_json,
          revision, updated_at
        ) VALUES (
          'page-1', 'project-1', 'run.target', 'string',
          '"localProject"', 1, ?
        )
      `).run(NOW);
      const rejected = requireError(
        apply(fixture, "mixed-stale", [
          scalarField("status", "build", 1),
          intrinsicField("run.target", "localProject", 0),
        ]),
      );
      expect(rejected.error.code).toBe("property_conflict");
      expect(
        fixture.database.prepare(`
          SELECT value_json || ':' || revision
          FROM data_source_property_values
          WHERE data_source_id = 'source-1'
            AND membership_id = 'membership-1' AND property_id = 'status'
        `).pluck().get(),
      ).toBe('"triage":1');
      expect(
        fixture.database.prepare("SELECT COUNT(*) FROM change_log").pluck().get(),
      ).toBe(0);
    });
  });

  test("enforces Project authority, Page parent, active membership, and Property scope independently", () => {
    withFixture((fixture) => {
      expect(
        requireError(
          apply(
            fixture,
            "unauthorized",
            [scalarField("status", "build", 1)],
            "project-2",
          ),
        ).error.code,
      ).toBe("data_source_not_found");

      fixture.database.prepare(`
        INSERT INTO project_resource_grants (
          id, project_id, library_id, root_kind, root_id,
          access, lifecycle, created_at
        ) VALUES (
          'grant-1', 'project-2', 'library-1', 'database', 'database-1',
          'read_write', 'active', ?
        )
      `).run(NOW);
      expect(
        apply(
          fixture,
          "authorized-grant",
          [scalarField("status", "build", 1)],
          "project-2",
        ).ok,
      ).toBe(true);

      fixture.database.prepare(`
        UPDATE pages SET parent_kind = 'library', parent_id = 'library-1'
        WHERE block_id = 'page-1'
      `).run();
      expect(
        requireError(
          apply(fixture, "wrong-parent", [setField("tags", [OPTION_B], [])]),
        ).error.code,
      ).toBe("membership_not_found");

      fixture.database.prepare(`
        UPDATE pages SET parent_kind = 'data_source', parent_id = 'source-1'
        WHERE block_id = 'page-1'
      `).run();
      fixture.database.prepare(`
        UPDATE data_source_page_memberships SET removed_at = ?
        WHERE id = 'membership-1' AND data_source_id = 'source-1'
      `).run(NOW);
      expect(
        requireError(
          apply(fixture, "removed-membership", [setField("tags", [OPTION_B], [])]),
        ).error.code,
      ).toBe("membership_not_found");

      fixture.database.prepare(`
        UPDATE data_source_page_memberships SET removed_at = NULL
        WHERE id = 'membership-1' AND data_source_id = 'source-1'
      `).run();
      expect(
        requireError(
          apply(
            fixture,
            "wrong-property-scope",
            [setField("p_CCCCCCCC", [OPTION_B], [])],
          ),
        ).error.code,
      ).toBe("property_not_found");
    });
  });

  test("rejects unregistered select and multi-select options and applies latest-set add/remove", () => {
    withFixture((fixture) => {
      expect(
        requireError(
          apply(
            fixture,
            "bad-select-option",
            [scalarField(CUSTOM_SELECT_ID, OPTION_UNKNOWN, 0)],
          ),
        ).error.code,
      ).toBe("property_value_invalid");
      expect(
        requireError(
          apply(
            fixture,
            "bad-multi-option",
            [setField(CUSTOM_MULTI_ID, [OPTION_UNKNOWN], [])],
          ),
        ).error.code,
      ).toBe("property_value_invalid");

      const committed = requireOk(
        apply(
          fixture,
          "tags-exchange",
          [setField("tags", [OPTION_B], [OPTION_A])],
        ),
      );
      expect(committed.value.fields[0]).toMatchObject({
        operation: "add_remove",
        revision: 2,
        value: [OPTION_B],
      });
      const stored = fixture.database.prepare(`
        SELECT value_json, revision FROM data_source_property_values
        WHERE data_source_id = ? AND membership_id = ? AND property_id = 'tags'
      `).get(SOURCE_ID, MEMBERSHIP_ID) as {
        readonly value_json: string;
        readonly revision: number;
      };
      expect(JSON.parse(stored.value_json)).toEqual([OPTION_B]);
      expect(stored.revision).toBe(2);

      const mixedCaseRequest = request(fixture, "mixed-case-options", [
        setField(
          MIXED_CASE_MULTI_ID,
          [OPTION_LOWER, OPTION_B],
          [],
        ),
      ]);
      const mixedCase = requireOk(
        applySourceBlockPropertyMutationV2(
          fixture.database,
          mixedCaseRequest,
          { now: () => NOW },
        ),
      );
      expect(mixedCase.value.fields[0]).toMatchObject({
        value: [OPTION_B, OPTION_LOWER],
      });
      expect(
        requireOk(
          applySourceBlockPropertyMutationV2(
            fixture.database,
            mixedCaseRequest,
            { now: () => NOW },
          ),
        ).value.duplicate,
      ).toBe(true);
    });
  });

  test("validates schedule pairs before writes and commits a two-field batch atomically", () => {
    withFixture((fixture) => {
      const start = "2026-07-20T10:00:00.000Z";
      const end = "2026-07-20T11:00:00.000Z";
      const rejected = requireError(
        apply(
          fixture,
          "schedule-half",
          [scalarField("scheduled_start", start, 0)],
        ),
      );
      expect(rejected.error.code).toBe("property_value_invalid");
      expect(
        fixture.database.prepare(`
          SELECT COUNT(*) FROM data_source_property_values
          WHERE property_id IN ('scheduled_start', 'scheduled_end')
        `).pluck().get(),
      ).toBe(0);

      const committed = requireOk(
        apply(fixture, "schedule-pair", [
          scalarField("scheduled_start", start, 0),
          scalarField("scheduled_end", end, 0),
        ]),
      );
      expect(committed.value.fields).toHaveLength(2);
      expect(committed.value.blockMetadataRevisions).toEqual({ [PAGE_ID]: 5 });
      expect(
        fixture.database.prepare(`
          SELECT COUNT(*) FROM data_source_property_values
          WHERE property_id IN ('scheduled_start', 'scheduled_end')
        `).pluck().get(),
      ).toBe(2);
    });
  });

  test("returns precise scalar CAS conflicts without changing authority", () => {
    withFixture((fixture) => {
      const rejected = requireError(
        apply(
          fixture,
          "stale-status",
          [scalarField("status", "build", 0)],
        ),
      );
      expect(rejected.error).toMatchObject({
        code: "property_conflict",
        expectedRevision: 0,
        actualRevision: 1,
      });
      expect(
        fixture.database.prepare(`
          SELECT value_json FROM data_source_property_values
          WHERE data_source_id = 'source-1'
            AND membership_id = 'membership-1' AND property_id = 'status'
        `).pluck().get(),
      ).toBe('"triage"');
      expect(
        fixture.database.prepare(`
          SELECT metadata_revision FROM blocks WHERE id = 'page-1'
        `).pluck().get(),
      ).toBe(4);
      expect(
        fixture.database.prepare("SELECT COUNT(*) FROM change_log").pluck().get(),
      ).toBe(0);
    });
  });

  test("rolls back values, projections, evidence, and metadata on an injected fault", () => {
    withFixture((fixture) => {
      expect(() =>
        applySourceBlockPropertyMutationV2(
          fixture.database,
          request(
            fixture,
            "rollback-status",
            [
              scalarField("status", "build", 1),
              intrinsicField("run.target", "localProject", 0),
            ],
          ),
          {
            now: () => NOW,
            faultInjector: (point) => {
              if (point === "after_change_log") throw new Error("fault");
            },
          },
        ),
      ).toThrow("fault");
      expect(
        fixture.database.prepare(`
          SELECT value_json || ':' || revision
          FROM data_source_property_values
          WHERE data_source_id = 'source-1'
            AND membership_id = 'membership-1' AND property_id = 'status'
        `).pluck().get(),
      ).toBe('"triage":1');
      expect(
        fixture.database.prepare(`
          SELECT group_key FROM database_view_page_positions
          WHERE view_id = 'view-1' AND page_block_id = 'page-1'
        `).pluck().get(),
      ).toBe("triage");
      expect(
        fixture.database.prepare(`
          SELECT metadata_revision FROM blocks WHERE id = 'page-1'
        `).pluck().get(),
      ).toBe(4);
      expect(
        fixture.database.prepare("SELECT COUNT(*) FROM change_log").pluck().get(),
      ).toBe(0);
      expect(
        fixture.database.prepare("SELECT COUNT(*) FROM block_mutations").pluck().get(),
      ).toBe(0);
      expect(
        fixture.database.prepare("SELECT COUNT(*) FROM block_properties").pluck().get(),
      ).toBe(0);
    });
  });
});
