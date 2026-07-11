import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseGeneralDatabaseViewConfig,
  type DatabasePropertyValueType,
  type DatabaseMutationOperation,
  type DatabaseMutationRequest,
  type GeneralDatabaseViewConfig,
} from "../src/shared/database-kernel";
import {
  createLegacyInlineDatabaseViewConfig,
  evaluateDatabaseViewRows,
} from "../src/shared/database-views";
import { createCard } from "../src/main/local-store/cards";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { applyDatabaseMutation } from "../src/main/local-store/database-kernel";
import {
  queryGeneralDatabaseView,
  readCardContentSummary,
} from "../src/main/local-store/database-query";
import { readDatabaseView } from "../src/main/local-store/database-views";
import { createProject } from "../src/main/local-store/projects";
import { drainLegacyCardShadowJobs } from "../src/main/local-store/legacy-card-shadow-processor";

const invariant = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const config = (): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
  group: null,
  display: { propertyIds: [], showTitle: true },
});

const request = (
  projectId: string,
  storeEpoch: string,
  operationId: string,
  operation: DatabaseMutationOperation,
): DatabaseMutationRequest => ({
  version: 1,
  operationId,
  projectId,
  storeEpoch,
  clientSessionId: "runtime-probe",
  actor: { kind: "runtime_probe" },
  operation,
});

const downgradeToV66 = (database: Database.Database): void => {
  database.pragma("foreign_keys = OFF");
  database.pragma("legacy_alter_table = ON");
  try {
    database.exec(`
      DROP INDEX IF EXISTS idx_database_views_primary;
      ALTER TABLE database_capabilities DROP COLUMN name;
      ALTER TABLE database_capabilities DROP COLUMN schema_revision;
      ALTER TABLE database_memberships DROP COLUMN revision;
      ALTER TABLE database_views RENAME TO database_views_v67_fixture;
      CREATE TABLE database_views (
        id TEXT PRIMARY KEY,
        database_block_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (id, project_id),
        FOREIGN KEY (database_block_id, project_id)
          REFERENCES database_capabilities(block_id, project_id) ON DELETE CASCADE,
        CHECK (kind IN ('kanban', 'list', 'calendar', 'canvas'))
      ) WITHOUT ROWID;
      INSERT INTO database_views (
        id, database_block_id, project_id, name, kind, config_json,
        is_primary, created_at, updated_at
      )
      SELECT
        id, database_block_id, project_id, name, kind, config_json,
        is_primary, created_at, updated_at
      FROM database_views_v67_fixture;
      DROP TABLE database_views_v67_fixture;
      ALTER TABLE database_view_positions DROP COLUMN revision;
      CREATE UNIQUE INDEX idx_database_views_primary
        ON database_views(database_block_id) WHERE is_primary = 1;
      PRAGMA user_version = 66;
    `);
  } finally {
    database.pragma("legacy_alter_table = OFF");
    database.pragma("foreign_keys = ON");
  }
};

const schemaClean = (database: Database.Database): boolean =>
  database
    .prepare(
      `
      SELECT 1 FROM sqlite_schema
      WHERE lower(sql) LIKE '%database_properties_v66%'
         OR lower(sql) LIKE '%database_property_values_v66%'
      LIMIT 1
    `,
    )
    .get() === undefined;

const runRollbackProbe = async (): Promise<boolean> => {
  closeDatabase();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-kernel-rollback-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    closeDatabase();
    const legacy = new Database(getDatabasePath());
    downgradeToV66(legacy);
    const project = legacy
      .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
      .get() as { readonly id: string };
    const now = new Date().toISOString();
    legacy
      .prepare(
        `
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, location_revision, metadata_revision,
          created_at, updated_at
        ) VALUES ('invalid-database', ?, 'database', 'active', 'space',
          NULL, 1, 1, ?, ?)
      `,
      )
      .run(project.id, now, now);
    legacy
      .prepare(
        `
        INSERT INTO database_capabilities (
          block_id, project_id, is_primary, schema_key, created_at, updated_at
        ) VALUES ('invalid-database', ?, 0, 'nodex.database', ?, ?)
      `,
      )
      .run(project.id, now, now);
    legacy.close();
    let failed = false;
    try {
      await initializeDatabase();
    } catch {
      failed = true;
    }
    closeDatabase();
    const rolledBack = new Database(getDatabasePath());
    const version = rolledBack.pragma("user_version", {
      simple: true,
    }) as number;
    const hasName = (
      rolledBack
        .prepare("PRAGMA table_info(database_capabilities)")
        .all() as Array<{
        readonly name: string;
      }>
    ).some((column) => column.name === "name");
    const clean = schemaClean(rolledBack);
    rolledBack.close();
    return failed && version === 66 && !hasName && clean;
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const run = async (): Promise<void> => {
  closeDatabase();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-kernel-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Database runtime" });
    const card = await createCard(project.id, "draft", {
      title: "Runtime Card",
    });
    const database = getDb();
    while (
      drainLegacyCardShadowJobs(database, { maxJobs: 1_000 }).results.length > 0
    ) {
      // Drain the transitional genesis seam so the probe reads a current
      // Document materialization rather than a legacy Card snapshot.
    }
    const store = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const primaryView = database
      .prepare(
        `
        SELECT view.config_json, view.rank_key, placement.rank_key AS placement_rank
        FROM database_views view
        INNER JOIN database_capabilities capability
          ON capability.block_id = view.database_block_id
         AND capability.is_primary = 1
        INNER JOIN top_level_block_placements placement
          ON placement.block_id = capability.block_id
        WHERE capability.project_id = ? AND view.is_primary = 1
      `,
      )
      .get(project.id) as {
      readonly config_json: string;
      readonly rank_key: string;
      readonly placement_rank: string;
    };
    const primaryConfig = parseGeneralDatabaseViewConfig(
      JSON.parse(primaryView.config_json),
    );
    invariant(
      primaryConfig.group?.propertyId.endsWith(":property:status") === true &&
        /^[0-9a-f]{32}$/.test(primaryView.rank_key) &&
        /^[0-9a-f]{32}$/.test(primaryView.placement_rank),
      "Post-v67 Project did not receive strict primary Database authority",
    );
    const currentMembership = database
      .prepare(
        `
        SELECT id, revision FROM database_memberships
        WHERE card_block_id = ? AND removed_at IS NULL
      `,
      )
      .get(card.id) as { readonly id: string; readonly revision: number };

    const createRequest = request(
      project.id,
      store.store_epoch,
      "runtime-create",
      {
        kind: "create_database",
        databaseBlockId: "runtime-database",
        name: "Runtime",
        isPrimary: false,
        initialView: {
          viewId: "runtime-view",
          name: "All",
          viewKind: "list",
          config: config(),
        },
      },
    );
    const created = applyDatabaseMutation(database, createRequest);
    invariant(created.ok, "Database creation failed");
    const retried = applyDatabaseMutation(database, {
      ...createRequest,
      actor: { kind: "retry" },
      clientSessionId: "retry-session",
    });
    invariant(
      retried.ok && retried.value.duplicate,
      "Exact retry did not replay",
    );

    const propertyTypes: readonly DatabasePropertyValueType[] = [
      "text",
      "number",
      "checkbox",
      "select",
      "multi_select",
      "date",
      "datetime",
      "person",
    ];
    propertyTypes.forEach((valueType, index) => {
      const property = applyDatabaseMutation(
        database,
        request(
          project.id,
          store.store_epoch,
          `runtime-property-${valueType}`,
          {
            kind: "put_property",
            databaseBlockId: "runtime-database",
            propertyId: `runtime-property-${valueType}`,
            expectedDatabaseSchemaRevision: index + 1,
            expectedPropertyRevision: 0,
            key: valueType,
            name: valueType,
            valueType,
            config:
              valueType === "select" || valueType === "multi_select"
                ? { options: [{ id: `${valueType}-a`, name: "A" }] }
                : {},
          },
        ),
      );
      invariant(property.ok, `Custom ${valueType} property creation failed`);
    });
    const transferred = applyDatabaseMutation(
      database,
      request(project.id, store.store_epoch, "runtime-transfer", {
        kind: "transfer_membership",
        cardBlockId: card.id,
        expectedMembership: {
          membershipId: currentMembership.id,
          revision: currentMembership.revision,
        },
        target: {
          databaseBlockId: "runtime-database",
          membershipId: "runtime-membership",
          viewId: "runtime-view",
          groupKey: null,
        },
      }),
    );
    invariant(transferred.ok, "Membership transfer failed");
    const scalarValues = [
      ["text", "authoritative"],
      ["number", 42],
      ["checkbox", true],
      ["select", "select-a"],
      ["date", "2026-07-11"],
      ["datetime", "2026-07-11T08:00:00.000Z"],
      ["person", "person-a"],
    ] as const;
    for (const [valueType, value] of scalarValues) {
      const valued = applyDatabaseMutation(
        database,
        request(project.id, store.store_epoch, `runtime-value-${valueType}`, {
          kind: "set_value",
          cardBlockId: card.id,
          databaseBlockId: "runtime-database",
          propertyId: `runtime-property-${valueType}`,
          expectedValueRevision: 0,
          value,
        }),
      );
      invariant(valued.ok, `Custom ${valueType} value mutation failed`);
    }
    const multiValue = applyDatabaseMutation(
      database,
      request(project.id, store.store_epoch, "runtime-value-multi", {
        kind: "add_remove_value",
        cardBlockId: card.id,
        databaseBlockId: "runtime-database",
        propertyId: "runtime-property-multi_select",
        add: ["multi_select-a"],
        remove: [],
      }),
    );
    invariant(multiValue.ok, "Custom multi_select value mutation failed");
    const nestedDnfView = applyDatabaseMutation(
      database,
      request(project.id, store.store_epoch, "runtime-dnf-view", {
        kind: "put_view",
        databaseBlockId: "runtime-database",
        viewId: "runtime-dnf-view",
        expectedRevision: 0,
        name: "Nested DNF",
        viewKind: "list",
        config: {
          ...config(),
          filter: {
            kind: "group",
            operator: "or",
            children: [
              {
                kind: "group",
                operator: "and",
                children: [
                  {
                    kind: "clause",
                    propertyId: "runtime-property-text",
                    operator: "equals",
                    value: "not-a-match",
                  },
                  {
                    kind: "clause",
                    propertyId: "runtime-property-number",
                    operator: "equals",
                    value: 42,
                  },
                ],
              },
              {
                kind: "group",
                operator: "and",
                children: [
                  {
                    kind: "clause",
                    propertyId: "runtime-property-text",
                    operator: "contains",
                    value: "author",
                  },
                  {
                    kind: "clause",
                    propertyId: "runtime-property-checkbox",
                    operator: "equals",
                    value: true,
                  },
                ],
              },
            ],
          },
        },
        isPrimary: false,
      }),
    );
    invariant(nestedDnfView.ok, "Nested DNF View creation failed");
    invariant(
      queryGeneralDatabaseView(project.id, "runtime-dnf-view", database)
        ?.rows[0]?.card.blockId === card.id,
      "Nested DNF filter evaluation lost its matching Card",
    );
    const groupedView = applyDatabaseMutation(
      database,
      request(project.id, store.store_epoch, "runtime-grouped-view", {
        kind: "put_view",
        databaseBlockId: "runtime-database",
        viewId: "runtime-grouped-view",
        expectedRevision: 0,
        name: "Grouped",
        viewKind: "kanban",
        config: {
          ...config(),
          group: { propertyId: "runtime-property-select" },
        },
        isPrimary: false,
      }),
    );
    invariant(groupedView.ok, "Grouped View creation failed");
    const groupedPosition = applyDatabaseMutation(
      database,
      request(project.id, store.store_epoch, "runtime-grouped-position", {
        kind: "position_card",
        viewId: "runtime-grouped-view",
        cardBlockId: card.id,
        expectedPositionRevision: 0,
        groupKey: "select-a",
      }),
    );
    invariant(groupedPosition.ok, "Grouped View position failed");
    const regrouped = applyDatabaseMutation(
      database,
      request(project.id, store.store_epoch, "runtime-regroup", {
        kind: "set_value",
        cardBlockId: card.id,
        databaseBlockId: "runtime-database",
        propertyId: "runtime-property-select",
        expectedValueRevision: 1,
        value: null,
      }),
    );
    invariant(regrouped.ok, "Grouped property/position transaction failed");
    invariant(
      queryGeneralDatabaseView(project.id, "runtime-grouped-view", database)
        ?.rows[0]?.effectiveGroupKey === null,
      "Grouped View position diverged from its property authority",
    );
    const query = queryGeneralDatabaseView(
      project.id,
      "runtime-view",
      database,
    );
    invariant(
      query?.rows[0]?.card.blockId === card.id,
      "Database query lost Card identity",
    );
    if (!query) throw new Error("Database query unexpectedly returned null");
    invariant(
      query.rows[0]?.values["runtime-property-text"]?.value ===
        "authoritative" &&
        query.rows[0]?.values["runtime-property-number"]?.value === 42 &&
        Array.isArray(
          query.rows[0]?.values["runtime-property-multi_select"]?.value,
        ),
      "Database query lost custom value",
    );
    const summary = readCardContentSummary(project.id, card.id, database);
    invariant(
      summary?.content?.title === card.title,
      `Card content summary is not Document-backed: ${JSON.stringify({
        expected: card.title,
        actual: summary?.content?.title ?? null,
        authority: summary?.documentAuthority ?? null,
        head: summary?.documentHeadSeq ?? null,
      })}`,
    );

    let faultRolledBack = false;
    try {
      applyDatabaseMutation(
        database,
        request(project.id, store.store_epoch, "runtime-fault", {
          kind: "create_database",
          databaseBlockId: "runtime-fault-database",
          name: "Fault",
          isPrimary: false,
          initialView: {
            viewId: "runtime-fault-view",
            name: "Fault",
            viewKind: "list",
            config: config(),
          },
        }),
        {
          faultInjector: (point) => {
            if (point === "after_change_log") throw new Error("fault");
          },
        },
      );
    } catch {
      faultRolledBack =
        database
          .prepare("SELECT 1 FROM blocks WHERE id = 'runtime-fault-database'")
          .get() === undefined &&
        database
          .prepare(
            "SELECT 1 FROM block_mutations WHERE mutation_id = 'runtime-fault'",
          )
          .get() === undefined;
    }
    invariant(
      faultRolledBack,
      "Fault injection left partial Database authority",
    );

    const legacyReaderCard = await createCard(project.id, "draft", {
      title: "Legacy reader Card",
    });
    while (
      drainLegacyCardShadowJobs(database, { maxJobs: 1_000 }).results.length > 0
    ) {
      // Make the legacy reader fixture independently readable before migration.
    }
    const legacyConfigJson = JSON.stringify(
      createLegacyInlineDatabaseViewConfig({
        sourceBlockId: "runtime-legacy-inline-source",
        props: {
          sourceProjectId: project.id,
          propertyOrderCsv: "status,title",
          hiddenPropertiesCsv: "estimate",
        },
      }),
    );
    const legacyConfigFingerprint = createHash("sha256")
      .update(legacyConfigJson)
      .digest("hex");
    const legacyNow = new Date().toISOString();
    database
      .prepare(
        `
        INSERT INTO database_views (
          id, database_block_id, project_id, name, kind, config_json,
          is_primary, revision, rank_key, lifecycle, created_at, updated_at
        ) VALUES (
          'runtime-legacy-inline-view', ?, ?,
          'Legacy inline', 'list', ?, 0, 1,
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'active', ?, ?
        )
      `,
      )
      .run(
        `database:${project.id}:primary`,
        project.id,
        legacyConfigJson,
        legacyNow,
        legacyNow,
      );
    database
      .prepare(
        `
        INSERT INTO database_property_values (
          membership_id, property_id, database_block_id, project_id,
          value_type, value_json, revision, updated_at
        ) VALUES (?, ?, ?, ?, 'multi_select', '["zeta","alpha"]', 1, ?)
        ON CONFLICT(membership_id, property_id) DO UPDATE SET
          value_json = excluded.value_json,
          revision = database_property_values.revision + 1,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        currentMembership.id,
        `database:${project.id}:primary:property:tags`,
        `database:${project.id}:primary`,
        project.id,
        legacyNow,
      );

    closeDatabase();
    const legacy = new Database(getDatabasePath());
    downgradeToV66(legacy);
    legacy.close();
    await initializeDatabase();
    closeDatabase();
    const migrated = new Database(getDatabasePath());
    const migratedPrimary = migrated
      .prepare(
        `
        SELECT view.config_json, view.rank_key, placement.rank_key AS placement_rank
        FROM database_views view
        INNER JOIN database_capabilities capability
          ON capability.block_id = view.database_block_id
         AND capability.project_id = view.project_id
        INNER JOIN top_level_block_placements placement
          ON placement.block_id = capability.block_id
        WHERE capability.project_id = ?
          AND capability.is_primary = 1
          AND view.is_primary = 1
      `,
      )
      .get(project.id) as {
      readonly config_json: string;
      readonly rank_key: string;
      readonly placement_rank: string;
    };
    const migratedPrimaryConfig = parseGeneralDatabaseViewConfig(
      JSON.parse(migratedPrimary.config_json),
    );
    const preservedLegacyConfig = migrated
      .prepare(
        `SELECT config_json FROM database_views WHERE id = 'runtime-legacy-inline-view'`,
      )
      .get() as { readonly config_json: string };
    invariant(
      preservedLegacyConfig.config_json === legacyConfigJson &&
        createHash("sha256")
          .update(preservedLegacyConfig.config_json)
          .digest("hex") === legacyConfigFingerprint,
      "v67 migration rewrote a legacy inline View payload",
    );
    const legacyReadModel = readDatabaseView(
      project.id,
      "runtime-legacy-inline-view",
      migrated,
    );
    invariant(
      legacyReadModel !== null &&
        evaluateDatabaseViewRows(legacyReadModel).some(
          (row) => row.card.id === legacyReaderCard.id,
        ),
      "Legacy inline View reader stopped interpreting the preserved payload",
    );
    let genericLegacyQueryFailed = false;
    try {
      queryGeneralDatabaseView(
        project.id,
        "runtime-legacy-inline-view",
        migrated,
      );
    } catch {
      genericLegacyQueryFailed = true;
    }
    invariant(
      genericLegacyQueryFailed,
      "Generic Database query guessed at a legacy inline View schema",
    );
    const migratedTags = migrated
      .prepare(`SELECT config_json FROM database_properties WHERE id = ?`)
      .get(`database:${project.id}:primary:property:tags`) as {
      readonly config_json: string;
    };
    const migratedTagIds = (
      JSON.parse(migratedTags.config_json) as {
        readonly options: readonly { readonly id: string }[];
      }
    ).options.map((option) => option.id);
    const migratedClean =
      (migrated.pragma("user_version", { simple: true }) as number) === 67 &&
      schemaClean(migrated) &&
      JSON.stringify(migrated.pragma("foreign_key_check")) === "[]" &&
      migratedPrimaryConfig.group?.propertyId.endsWith(":property:status") ===
        true &&
      /^[0-9a-f]{32}$/.test(migratedPrimary.rank_key) &&
      /^[0-9a-f]{32}$/.test(migratedPrimary.placement_rank) &&
      migratedTagIds.join(",") === "alpha,zeta" &&
      (
        migrated.pragma("integrity_check") as Array<{ integrity_check: string }>
      )[0]?.integrity_check === "ok";
    migrated.close();
    invariant(migratedClean, "Schema v66→v67 migration evidence failed");

    const rollback = await runRollbackProbe();
    invariant(rollback, "Schema v67 rollback probe failed");
    process.stdout.write(
      `${JSON.stringify({
        fresh: true,
        strictPrimary: true,
        exactRetry: true,
        customTypes: 8,
        nestedDnf: true,
        groupedReconcile: true,
        atomicTransfer: true,
        canonicalHistory: true,
        faultRollback: true,
        migration: true,
        legacyViewPreserved: true,
        optionRegistryMigrated: true,
        rollback: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

void run();
