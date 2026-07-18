import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyOperationV2,
} from "../../shared/database-module-v2";
import {
  databaseGroupKeyForValue,
  parseDatabaseViewConfigV2,
  stableStringifyDatabaseJson,
} from "../../shared/database-kernel";
import { resetAssetPathCacheForTests } from "./assets";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createPage } from "./database-pages";
import {
  applyDatabaseModuleV2,
  applyLibraryDatabaseModuleV2,
  readLibraryDatabaseModuleV2,
  readDatabaseModuleV2,
} from "./database-module-v2-runtime";
import { setProjectLifecycle } from "./projects";

const tempDirectories: string[] = [];

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-module-v2-"),
  );
  tempDirectories.push(directory);
  process.env.NODEX_HOME = directory;
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_HOME;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

interface RuntimeFixture {
  readonly database: ReturnType<typeof getDb>;
  readonly projectId: string;
  readonly databaseId: ReturnType<typeof parseDatabaseId>;
  readonly dataSourceId: ReturnType<typeof parseDataSourceId>;
  readonly viewId: ReturnType<typeof parseDatabaseViewId>;
  readonly storeEpoch: string;
  readonly pageIds: readonly string[];
}

const createV81Fixture = async (
  pageCount: number,
): Promise<RuntimeFixture> => {
  useTempStore();
  await initializeDatabase();
  const database = getDb();
  const root = database.prepare(`
    SELECT project.id AS projectId,
      project.database_block_id AS databaseId,
      source.id AS dataSourceId,
      container.default_view_id AS viewId
    FROM projects project
    INNER JOIN database_containers container
      ON container.block_id = project.database_block_id
    INNER JOIN data_sources source
      ON source.home_database_block_id = container.block_id
    ORDER BY project.created, source.rank_key
    LIMIT 1
  `).get() as {
    readonly projectId: string;
    readonly databaseId: string;
    readonly dataSourceId: string;
    readonly viewId: string;
  };
  const pageIds: string[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const page = await createPage(root.projectId, "triage", {
      title: `Database Module v2 fixture ${index + 1}`,
    });
    pageIds.push(page.id);
  }
  const metadata = database.prepare(`
    SELECT store_epoch AS storeEpoch FROM block_store_metadata WHERE id = 1
  `).get() as { readonly storeEpoch: string };
  return {
    database,
    projectId: root.projectId,
    databaseId: parseDatabaseId(root.databaseId),
    dataSourceId: parseDataSourceId(root.dataSourceId),
    viewId: parseDatabaseViewId(root.viewId),
    storeEpoch: metadata.storeEpoch,
    pageIds,
  };
};

const applyFixture = (
  fixture: RuntimeFixture,
  operationId: string,
  operations: readonly DatabaseApplyOperationV2[],
) => applyDatabaseModuleV2(
  fixture.database,
  {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    operationId,
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    actor: { kind: "test" },
    operations,
  },
  { now: () => "2026-07-18T03:00:00.000Z" },
);

describe("dormant canonical Database Module v2 runtime", () => {
  test("reads a concrete View through Library authority after Project archive", async () => {
    const fixture = await createV81Fixture(2);
    setProjectLifecycle(fixture.projectId, { lifecycle: "archived" });

    const libraryRead = readLibraryDatabaseModuleV2(
      fixture.database,
      {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        read: {
          target: { kind: "view", viewId: fixture.viewId },
          mode: "query",
        },
      },
      "app_window",
    );
    expect(libraryRead).toMatchObject({
      ok: true,
      value: {
        accessContext: { kind: "library" },
        value: {
          kind: "query",
          value: { view: { viewId: fixture.viewId } },
        },
      },
    });
    if (libraryRead.ok) expect("projectId" in libraryRead.value).toBe(false);
    if (!libraryRead.ok || libraryRead.value.value.kind !== "query") {
      throw new Error("Expected a Library View query");
    }
    const row = libraryRead.value.value.value.rows[0];
    if (!row) throw new Error("Expected a Library row");
    const currentStatus = row.values.status;
    if (typeof currentStatus?.value !== "string") {
      throw new Error("Expected a valid option-backed status value");
    }
    const applied = applyLibraryDatabaseModuleV2(
      fixture.database,
      {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId: "library-option-write",
        storeEpoch: fixture.storeEpoch,
        operations: [{
          kind: "set_value",
          pageId: row.page.pageId,
          dataSourceId: fixture.dataSourceId,
          propertyId: parseDataSourcePropertyId("status"),
          expectedValueRevision: currentStatus.revision,
          value: currentStatus.value,
        }],
      },
      { kind: "test" },
      "app_window",
    );
    expect(applied).toMatchObject({
      ok: true,
      value: {
        accessContext: { kind: "library" },
        affectedPageIds: [row.page.pageId],
      },
    });
    if (applied.ok) expect("projectId" in applied.value).toBe(false);
  });

  test("reads v81 authority and applies owner-scoped option/value intents atomically", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const root = database.prepare(`
      SELECT project.id AS projectId,
        source.id AS dataSourceId,
        container.default_view_id AS viewId
      FROM projects project
      INNER JOIN database_containers container
        ON container.block_id = project.database_block_id
      INNER JOIN data_sources source
        ON source.home_database_block_id = container.block_id
      ORDER BY project.created, source.rank_key
      LIMIT 1
    `).get() as {
      readonly projectId: string;
      readonly dataSourceId: string;
      readonly viewId: string;
    };
    const page = await createPage(root.projectId, "triage", {
      title: "Database Module v2 fixture",
    });
    const metadata = database.prepare(`
      SELECT store_epoch AS storeEpoch FROM block_store_metadata WHERE id = 1
    `).get() as { readonly storeEpoch: string };

    const dataSourceId = parseDataSourceId(root.dataSourceId);
    const propertyId = parseDataSourcePropertyId("tags");
    const optionA = parseDataSourceOptionId({
      propertyId,
      value: "o_AAAAAAAA",
    });
    const optionB = parseDataSourceOptionId({
      propertyId,
      value: "o_BBBBBBBB",
    });
    const optionC = parseDataSourceOptionId({
      propertyId,
      value: "o_CCCCCCCC",
    });
    const now = () => "2026-07-18T03:00:00.000Z";
    const apply = (
      operationId: string,
      operations: readonly DatabaseApplyOperationV2[],
    ) => applyDatabaseModuleV2(
      database,
      {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId,
        projectId: root.projectId,
        storeEpoch: metadata.storeEpoch,
        actor: { kind: "test" },
        operations,
      },
      { now },
    );

    const descriptor = readDatabaseModuleV2(database, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: root.projectId,
      read: {
        target: { kind: "data_source", dataSourceId },
        mode: "data_source",
      },
    });
    expect(descriptor.ok).toBe(true);
    if (!descriptor.ok || descriptor.value.value.kind !== "data_source") {
      throw new Error("Expected a Data Source descriptor");
    }
    expect(
      descriptor.value.value.value.properties.some(
        (property) => property.propertyId === propertyId,
      ),
    ).toBe(true);

    const propertyBefore = database.prepare(`
      SELECT schema_revision AS propertyRevision, config_json AS configJson
      FROM data_source_properties
      WHERE data_source_id = ? AND id = ?
    `).get(dataSourceId, propertyId) as {
      readonly propertyRevision: number;
      readonly configJson: string;
    };
    const putAOperations = [
      {
        kind: "put_option",
        dataSourceId,
        propertyId,
        optionId: optionA,
        name: "runtime-alpha",
        color: "blue",
        expectedPropertyRevision: propertyBefore.propertyRevision,
      },
    ] as const;
    const putA = apply("v2-put-option-a", putAOperations);
    expect(putA).toMatchObject({
      ok: true,
      value: { duplicate: false, operationKinds: ["put_option"] },
    });
    const putAReplay = apply("v2-put-option-a", putAOperations);
    expect(putAReplay).toMatchObject({
      ok: true,
      value: { duplicate: true, operationKinds: ["put_option"] },
    });
    const propertyAfterPutA = database.prepare(`
      SELECT schema_revision AS revision, config_json AS configJson
      FROM data_source_properties
      WHERE data_source_id = ? AND id = ?
    `).get(dataSourceId, propertyId) as {
      readonly revision: number;
      readonly configJson: string;
    };
    expect(propertyAfterPutA.revision).toBe(propertyBefore.propertyRevision + 1);
    expect(JSON.parse(propertyAfterPutA.configJson)).toMatchObject({
      options: expect.arrayContaining([
        { id: optionA, name: "runtime-alpha", color: "blue" },
      ]),
    });

    const collision = apply("v2-put-option-a", [
      {
        ...putAOperations[0],
        name: "different-intent",
      },
    ]);
    expect(collision).toMatchObject({
      ok: false,
      error: { code: "operation_id_collision" },
    });
    expect(
      database.prepare(`
        SELECT schema_revision AS revision FROM data_source_properties
        WHERE data_source_id = ? AND id = ?
      `).get(dataSourceId, propertyId),
    ).toEqual({ revision: propertyAfterPutA.revision });

    const currentValue = database.prepare(`
      SELECT value.revision
      FROM data_source_property_values value
      INNER JOIN data_source_page_memberships membership
        ON membership.data_source_id = value.data_source_id
        AND membership.id = value.membership_id
      WHERE membership.page_block_id = ?
        AND value.data_source_id = ? AND value.property_id = ?
    `).get(page.id, dataSourceId, propertyId) as { readonly revision: number };
    const viewConfigRow = database.prepare(`
      SELECT config_json FROM database_views WHERE id = ?
    `).get(root.viewId) as { readonly config_json: string };
    const viewConfig = parseDatabaseViewConfigV2(
      JSON.parse(viewConfigRow.config_json),
    );
    database.prepare(`
      UPDATE database_views SET config_json = ? WHERE id = ?
    `).run(
      stableStringifyDatabaseJson({
        ...viewConfig,
        group: { propertyId },
      }),
      root.viewId,
    );
    database.prepare(`
      UPDATE database_view_page_positions SET group_key = NULL
      WHERE view_id = ? AND page_block_id = ?
    `).run(root.viewId, page.id);
    database.prepare(`
      UPDATE page_read_model SET view_group_key = NULL
      WHERE page_block_id = ? AND view_id = ?
    `).run(page.id, root.viewId);

    const setA = apply("v2-set-option-a", [
      {
        kind: "set_value",
        pageId: page.id,
        dataSourceId,
        propertyId,
        expectedValueRevision: currentValue.revision,
        value: [optionA],
      },
    ]);
    expect(setA).toMatchObject({
      ok: true,
      value: {
        affectedDataSourceIds: [dataSourceId],
        affectedPageIds: [page.id],
      },
    });
    const canonicalAfterSet = database.prepare(`
      SELECT value.value_json AS valueJson, value.revision
      FROM data_source_property_values value
      INNER JOIN data_source_page_memberships membership
        ON membership.data_source_id = value.data_source_id
        AND membership.id = value.membership_id
      WHERE membership.page_block_id = ?
        AND value.data_source_id = ? AND value.property_id = ?
    `).get(page.id, dataSourceId, propertyId) as {
      readonly valueJson: string;
      readonly revision: number;
    };
    expect(JSON.parse(canonicalAfterSet.valueJson)).toEqual([optionA]);
    expect(
      database.prepare(`
        SELECT group_key AS groupKey FROM database_view_page_positions
        WHERE view_id = ? AND page_block_id = ?
      `).get(root.viewId, page.id),
    ).toEqual({ groupKey: databaseGroupKeyForValue([optionA]) });
    const pageProjection = database.prepare(`
      SELECT database_values_json AS valuesJson, view_group_key AS groupKey
      FROM page_read_model WHERE page_block_id = ?
    `).get(page.id) as {
      readonly valuesJson: string;
      readonly groupKey: string;
    };
    expect(JSON.parse(pageProjection.valuesJson)).toMatchObject({
      tags: ["runtime-alpha"],
    });
    expect(pageProjection.groupKey).toBe(databaseGroupKeyForValue([optionA]));

    const query = readDatabaseModuleV2(database, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: root.projectId,
      read: {
        target: { kind: "data_source", dataSourceId },
        mode: "query",
      },
    });
    expect(query.ok).toBe(true);
    if (!query.ok || query.value.value.kind !== "data_source_query") {
      throw new Error("Expected a Data Source query");
    }
    expect(
      query.value.value.value.rows.find((row) => row.page.pageId === page.id)
        ?.values.tags?.value,
    ).toEqual([optionA]);

    const putB = apply("v2-put-option-b", [
      {
        kind: "put_option",
        dataSourceId,
        propertyId,
        optionId: optionB,
        name: "runtime-beta",
        expectedPropertyRevision: propertyAfterPutA.revision,
      },
    ]);
    expect(putB.ok).toBe(true);
    const propertyAfterPutB = database.prepare(`
      SELECT schema_revision AS revision FROM data_source_properties
      WHERE data_source_id = ? AND id = ?
    `).get(dataSourceId, propertyId) as { readonly revision: number };
    const addRemove = apply("v2-add-remove", [
      {
        kind: "add_remove_value",
        pageId: page.id,
        dataSourceId,
        propertyId,
        add: [optionB],
        remove: [optionA],
      },
    ]);
    expect(addRemove.ok).toBe(true);
    const afterAddRemove = database.prepare(`
      SELECT value.value_json AS valueJson
      FROM data_source_property_values value
      INNER JOIN data_source_page_memberships membership
        ON membership.data_source_id = value.data_source_id
        AND membership.id = value.membership_id
      WHERE membership.page_block_id = ?
        AND value.data_source_id = ? AND value.property_id = ?
    `).get(page.id, dataSourceId, propertyId) as {
      readonly valueJson: string;
    };
    expect(JSON.parse(afterAddRemove.valueJson)).toEqual([optionB]);

    const deleteInUse = apply("v2-delete-option-b", [
      {
        kind: "delete_option",
        dataSourceId,
        propertyId,
        optionId: optionB,
        expectedPropertyRevision: propertyAfterPutB.revision,
      },
    ]);
    expect(deleteInUse).toMatchObject({
      ok: false,
      error: { code: "unsupported_operation" },
    });
    expect(apply("v2-delete-option-b", [
      {
        kind: "delete_option",
        dataSourceId,
        propertyId,
        optionId: optionB,
        expectedPropertyRevision: propertyAfterPutB.revision,
      },
    ])).toEqual(deleteInUse);

    const deleteUnused = apply("v2-delete-option-a", [
      {
        kind: "delete_option",
        dataSourceId,
        propertyId,
        optionId: optionA,
        expectedPropertyRevision: propertyAfterPutB.revision,
      },
    ]);
    expect(deleteUnused.ok).toBe(true);
    const propertyBeforeRollbackProbe = database.prepare(`
      SELECT schema_revision AS propertyRevision, config_json AS configJson
      FROM data_source_properties
      WHERE data_source_id = ? AND id = ?
    `).get(dataSourceId, propertyId) as {
      readonly propertyRevision: number;
      readonly configJson: string;
    };
    const sourceBeforeRollbackProbe = database.prepare(`
      SELECT schema_revision AS revision FROM data_sources WHERE id = ?
    `).get(dataSourceId) as { readonly revision: number };
    const rolledBackBatch = apply("v2-atomic-rejection", [
      {
        kind: "put_option",
        dataSourceId,
        propertyId,
        optionId: optionC,
        name: "must-roll-back",
        expectedPropertyRevision: propertyBeforeRollbackProbe.propertyRevision,
      },
      {
        kind: "delete_property",
        dataSourceId,
        propertyId: parseDataSourcePropertyId("p_AAAAAAAA"),
        expectedDataSourceRevision: sourceBeforeRollbackProbe.revision,
        expectedPropertyRevision: 1,
      },
    ]);
    expect(rolledBackBatch).toMatchObject({
      ok: false,
      error: { code: "resource_not_found" },
    });
    expect(
      database.prepare(`
        SELECT schema_revision AS propertyRevision, config_json AS configJson
        FROM data_source_properties
        WHERE data_source_id = ? AND id = ?
      `).get(dataSourceId, propertyId),
    ).toEqual(propertyBeforeRollbackProbe);
    expect(propertyBeforeRollbackProbe.configJson).not.toContain(optionC);
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("creates, renames, tombstones, and restores compact Properties without replacing options", async () => {
    const fixture = await createV81Fixture(0);
    const propertyId = parseDataSourcePropertyId("p_AAAAAAAA");
    const optionId = parseDataSourceOptionId({
      propertyId,
      value: "o_AAAAAAAA",
    });
    const initialSource = fixture.database.prepare(`
      SELECT schema_revision AS revision FROM data_sources WHERE id = ?
    `).get(fixture.dataSourceId) as { readonly revision: number };

    const created = applyFixture(fixture, "v2-property-create", [
      {
        kind: "put_property",
        dataSourceId: fixture.dataSourceId,
        propertyId,
        expectedDataSourceRevision: initialSource.revision,
        expectedPropertyRevision: 0,
        name: "Team",
        valueType: "select",
        config: {},
      },
    ]);
    expect(created).toMatchObject({
      ok: true,
      value: {
        committedRevisions: {
          [`property:${fixture.dataSourceId}:${propertyId}`]: 1,
        },
      },
    });
    const createdProperty = fixture.database.prepare(`
      SELECT schema_revision AS revision, created_at AS createdAt
      FROM data_source_properties
      WHERE data_source_id = ? AND id = ?
    `).get(fixture.dataSourceId, propertyId) as {
      readonly revision: number;
      readonly createdAt: string;
    };

    expect(applyFixture(fixture, "v2-property-option", [
      {
        kind: "put_option",
        dataSourceId: fixture.dataSourceId,
        propertyId,
        optionId,
        name: "Platform",
        expectedPropertyRevision: createdProperty.revision,
      },
    ]).ok).toBe(true);
    const afterOption = fixture.database.prepare(`
      SELECT property.schema_revision AS propertyRevision,
        source.schema_revision AS sourceRevision
      FROM data_source_properties property
      INNER JOIN data_sources source ON source.id = property.data_source_id
      WHERE property.data_source_id = ? AND property.id = ?
    `).get(fixture.dataSourceId, propertyId) as {
      readonly propertyRevision: number;
      readonly sourceRevision: number;
    };
    const renamed = applyFixture(fixture, "v2-property-rename", [
      {
        kind: "put_property",
        dataSourceId: fixture.dataSourceId,
        propertyId,
        expectedDataSourceRevision: afterOption.sourceRevision,
        expectedPropertyRevision: afterOption.propertyRevision,
        name: "Owning team",
        valueType: "select",
        config: {},
      },
    ]);
    expect(renamed.ok).toBe(true);
    const afterRename = fixture.database.prepare(`
      SELECT property.name, property.config_json AS configJson,
        property.schema_revision AS propertyRevision,
        source.schema_revision AS sourceRevision
      FROM data_source_properties property
      INNER JOIN data_sources source ON source.id = property.data_source_id
      WHERE property.data_source_id = ? AND property.id = ?
    `).get(fixture.dataSourceId, propertyId) as {
      readonly name: string;
      readonly configJson: string;
      readonly propertyRevision: number;
      readonly sourceRevision: number;
    };
    expect(afterRename.name).toBe("Owning team");
    expect(JSON.parse(afterRename.configJson)).toEqual({
      options: [{ id: optionId, name: "Platform" }],
    });

    expect(applyFixture(fixture, "v2-property-delete", [
      {
        kind: "delete_property",
        dataSourceId: fixture.dataSourceId,
        propertyId,
        expectedDataSourceRevision: afterRename.sourceRevision,
        expectedPropertyRevision: afterRename.propertyRevision,
      },
    ]).ok).toBe(true);
    const tombstone = fixture.database.prepare(`
      SELECT property.lifecycle, property.config_json AS configJson,
        property.schema_revision AS propertyRevision,
        source.schema_revision AS sourceRevision
      FROM data_source_properties property
      INNER JOIN data_sources source ON source.id = property.data_source_id
      WHERE property.data_source_id = ? AND property.id = ?
    `).get(fixture.dataSourceId, propertyId) as {
      readonly lifecycle: string;
      readonly configJson: string;
      readonly propertyRevision: number;
      readonly sourceRevision: number;
    };
    expect(tombstone.lifecycle).toBe("deleted");

    const restored = applyFixture(fixture, "v2-property-restore", [
      {
        kind: "put_property",
        dataSourceId: fixture.dataSourceId,
        propertyId,
        expectedDataSourceRevision: tombstone.sourceRevision,
        expectedPropertyRevision: tombstone.propertyRevision,
        name: "Restored team",
        valueType: "select",
        config: {},
      },
    ]);
    expect(restored.ok).toBe(true);
    expect(
      fixture.database.prepare(`
        SELECT lifecycle, name, config_json AS configJson, created_at AS createdAt
        FROM data_source_properties
        WHERE data_source_id = ? AND id = ?
      `).get(fixture.dataSourceId, propertyId),
    ).toEqual({
      lifecycle: "active",
      name: "Restored team",
      configJson: tombstone.configJson,
      createdAt: createdProperty.createdAt,
    });
  });

  test("creates, defaults, deletes, and restores Views through Container-owned default authority", async () => {
    const fixture = await createV81Fixture(0);
    const viewId = parseDatabaseViewId("v2-secondary-view");
    const defaultConfigRow = fixture.database.prepare(`
      SELECT config_json FROM database_views WHERE id = ?
    `).get(fixture.viewId) as { readonly config_json: string };
    const config = parseDatabaseViewConfigV2(
      JSON.parse(defaultConfigRow.config_json),
    );
    expect(applyFixture(fixture, "v2-view-create", [
      {
        kind: "put_view",
        databaseId: fixture.databaseId,
        dataSourceId: fixture.dataSourceId,
        viewId,
        expectedRevision: 0,
        name: "Secondary",
        viewKind: "list",
        config,
        isDefault: false,
      },
    ]).ok).toBe(true);
    expect(
      fixture.database.prepare(`
        SELECT default_view_id AS defaultViewId FROM database_containers
        WHERE block_id = ?
      `).get(fixture.databaseId),
    ).toEqual({ defaultViewId: fixture.viewId });

    expect(applyFixture(fixture, "v2-view-default", [
      {
        kind: "put_view",
        databaseId: fixture.databaseId,
        dataSourceId: fixture.dataSourceId,
        viewId,
        expectedRevision: 1,
        name: "Primary list",
        viewKind: "list",
        config,
        isDefault: true,
      },
    ]).ok).toBe(true);
    expect(
      fixture.database.prepare(`
        SELECT default_view_id AS defaultViewId FROM database_containers
        WHERE block_id = ?
      `).get(fixture.databaseId),
    ).toEqual({ defaultViewId: viewId });

    const oldDefault = fixture.database.prepare(`
      SELECT revision FROM database_views WHERE id = ?
    `).get(fixture.viewId) as { readonly revision: number };
    expect(applyFixture(fixture, "v2-view-delete-old-default", [
      {
        kind: "delete_view",
        databaseId: fixture.databaseId,
        viewId: fixture.viewId,
        expectedRevision: oldDefault.revision,
      },
    ]).ok).toBe(true);
    expect(applyFixture(fixture, "v2-view-delete-current-default", [
      {
        kind: "delete_view",
        databaseId: fixture.databaseId,
        viewId,
        expectedRevision: 2,
      },
    ]).ok).toBe(true);
    expect(
      fixture.database.prepare(`
        SELECT default_view_id AS defaultViewId FROM database_containers
        WHERE block_id = ?
      `).get(fixture.databaseId),
    ).toEqual({ defaultViewId: null });

    const restored = applyFixture(fixture, "v2-view-restore", [
      {
        kind: "put_view",
        databaseId: fixture.databaseId,
        dataSourceId: fixture.dataSourceId,
        viewId,
        expectedRevision: 3,
        name: "Restored list",
        viewKind: "list",
        config,
        isDefault: true,
      },
    ]);
    expect(restored.ok).toBe(true);
    expect(
      fixture.database.prepare(`
        SELECT view.lifecycle, view.revision,
          container.default_view_id AS defaultViewId
        FROM database_views view
        INNER JOIN database_containers container
          ON container.block_id = view.database_block_id
        WHERE view.id = ?
      `).get(viewId),
    ).toEqual({ lifecycle: "active", revision: 4, defaultViewId: viewId });
  });

  test("materializes and reorders complete logical View groups for single and bulk positioning", async () => {
    const fixture = await createV81Fixture(3);
    fixture.database.prepare(`
      DELETE FROM database_view_page_positions WHERE view_id = ?
    `).run(fixture.viewId);
    fixture.database.prepare(`
      UPDATE page_read_model SET view_group_key = NULL, view_rank_key = NULL
      WHERE view_id = ?
    `).run(fixture.viewId);
    const [firstPageId, secondPageId, anchorPageId] = fixture.pageIds;
    if (!firstPageId || !secondPageId || !anchorPageId) {
      throw new Error("Position fixture is incomplete");
    }
    const group = fixture.database.prepare(`
      SELECT value.value_json AS valueJson
      FROM data_source_property_values value
      INNER JOIN data_source_page_memberships membership
        ON membership.data_source_id = value.data_source_id
        AND membership.id = value.membership_id
      WHERE membership.page_block_id = ?
        AND value.data_source_id = ? AND value.property_id = 'status'
    `).get(firstPageId, fixture.dataSourceId) as {
      readonly valueJson: string;
    };
    const groupKey = databaseGroupKeyForValue(JSON.parse(group.valueJson));
    const bulk = applyFixture(fixture, "v2-position-bulk", [
      {
        kind: "position_pages",
        viewId: fixture.viewId,
        pages: [
          { pageId: firstPageId, expectedPositionRevision: 0 },
          { pageId: secondPageId, expectedPositionRevision: 0 },
        ],
        groupKey,
        beforePageId: anchorPageId,
      },
    ]);
    expect(bulk.ok).toBe(true);
    expect(
      fixture.database.prepare(`
        SELECT COUNT(*) AS count FROM database_view_page_positions
        WHERE view_id = ?
      `).get(fixture.viewId),
    ).toEqual({ count: 3 });

    const readOrder = (): readonly string[] => {
      const result = readDatabaseModuleV2(fixture.database, {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: fixture.projectId,
        read: {
          target: { kind: "view", viewId: fixture.viewId },
          mode: "query",
        },
      });
      if (!result.ok || result.value.value.kind !== "query") {
        throw new Error("Expected a View query result");
      }
      return result.value.value.value.rows.map((row) => row.page.pageId);
    };
    expect(readOrder()).toEqual([firstPageId, secondPageId, anchorPageId]);

    const anchorPosition = fixture.database.prepare(`
      SELECT revision FROM database_view_page_positions
      WHERE view_id = ? AND page_block_id = ?
    `).get(fixture.viewId, anchorPageId) as { readonly revision: number };
    expect(applyFixture(fixture, "v2-position-single", [
      {
        kind: "position_page",
        viewId: fixture.viewId,
        pageId: anchorPageId,
        expectedPositionRevision: anchorPosition.revision,
        groupKey,
        beforePageId: firstPageId,
      },
    ]).ok).toBe(true);
    expect(readOrder()).toEqual([anchorPageId, firstPageId, secondPageId]);
  });

  test("transfers Pages across Sources, Library roots, and Page parents without leaking Source-local values", async () => {
    const fixture = await createV81Fixture(2);
    const [movingPageId, parentPageId] = fixture.pageIds;
    if (!movingPageId || !parentPageId) {
      throw new Error("Transfer fixture is incomplete");
    }
    const targetDataSourceId = parseDataSourceId("v2-target-source");
    fixture.database.prepare(`
      INSERT INTO data_sources (
        id, library_id, home_database_block_id, name, schema_key,
        schema_revision, lifecycle, rank_key, created_at, updated_at
      )
      SELECT ?, library_id, home_database_block_id, 'Target Source', schema_key,
        schema_revision, 'active', 'zz-target', created_at, updated_at
      FROM data_sources WHERE id = ?
    `).run(targetDataSourceId, fixture.dataSourceId);
    fixture.database.prepare(`
      INSERT INTO data_source_properties (
        data_source_id, id, name, value_type, config_json, rank_key,
        lifecycle, schema_revision, created_at, updated_at
      )
      SELECT ?, id, name, value_type, config_json, rank_key,
        lifecycle, schema_revision, created_at, updated_at
      FROM data_source_properties WHERE data_source_id = ?
    `).run(targetDataSourceId, fixture.dataSourceId);

    const tagsPropertyId = parseDataSourcePropertyId("tags");
    const sourceTagId = parseDataSourceOptionId({
      propertyId: tagsPropertyId,
      value: "o_AAAAAAAA",
    });
    const targetTagId = parseDataSourceOptionId({
      propertyId: tagsPropertyId,
      value: "o_BBBBBBBB",
    });
    const sourceTags = fixture.database.prepare(`
      SELECT schema_revision AS revision FROM data_source_properties
      WHERE data_source_id = ? AND id = 'tags'
    `).get(fixture.dataSourceId) as { readonly revision: number };
    const targetTags = fixture.database.prepare(`
      SELECT schema_revision AS revision FROM data_source_properties
      WHERE data_source_id = ? AND id = 'tags'
    `).get(targetDataSourceId) as { readonly revision: number };
    expect(applyFixture(fixture, "v2-transfer-source-tag", [
      {
        kind: "put_option",
        dataSourceId: fixture.dataSourceId,
        propertyId: tagsPropertyId,
        optionId: sourceTagId,
        name: "shared tag",
        expectedPropertyRevision: sourceTags.revision,
      },
    ]).ok).toBe(true);
    expect(applyFixture(fixture, "v2-transfer-target-tag", [
      {
        kind: "put_option",
        dataSourceId: targetDataSourceId,
        propertyId: tagsPropertyId,
        optionId: targetTagId,
        name: "shared tag",
        expectedPropertyRevision: targetTags.revision,
      },
    ]).ok).toBe(true);
    const sourceValue = fixture.database.prepare(`
      SELECT value.revision
      FROM data_source_property_values value
      INNER JOIN data_source_page_memberships membership
        ON membership.data_source_id = value.data_source_id
        AND membership.id = value.membership_id
      WHERE membership.page_block_id = ?
        AND value.data_source_id = ? AND value.property_id = 'tags'
    `).get(movingPageId, fixture.dataSourceId) as {
      readonly revision: number;
    };
    expect(applyFixture(fixture, "v2-transfer-set-tag", [
      {
        kind: "set_value",
        pageId: movingPageId,
        dataSourceId: fixture.dataSourceId,
        propertyId: tagsPropertyId,
        expectedValueRevision: sourceValue.revision,
        value: [sourceTagId],
      },
    ]).ok).toBe(true);
    const pageBefore = fixture.database.prepare(`
      SELECT parent_revision AS parentRevision FROM pages WHERE block_id = ?
    `).get(movingPageId) as { readonly parentRevision: number };
    const membershipBefore = fixture.database.prepare(`
      SELECT revision FROM data_source_page_memberships
      WHERE page_block_id = ? AND removed_at IS NULL
    `).get(movingPageId) as { readonly revision: number };
    const movedToSource = applyFixture(fixture, "v2-transfer-source", [
      {
        kind: "transfer_page",
        pageId: movingPageId,
        expectedParentRevision: pageBefore.parentRevision,
        expectedActiveMembershipRevision: membershipBefore.revision,
        target: { kind: "data_source", dataSourceId: targetDataSourceId },
      },
    ]);
    expect(movedToSource.ok).toBe(true);
    const targetMembership = fixture.database.prepare(`
      SELECT id, revision FROM data_source_page_memberships
      WHERE data_source_id = ? AND page_block_id = ? AND removed_at IS NULL
    `).get(targetDataSourceId, movingPageId) as {
      readonly id: string;
      readonly revision: number;
    };
    expect(
      fixture.database.prepare(`
        SELECT parent_kind AS parentKind, parent_id AS parentId
        FROM pages WHERE block_id = ?
      `).get(movingPageId),
    ).toEqual({ parentKind: "data_source", parentId: targetDataSourceId });
    expect(
      fixture.database.prepare(`
        SELECT value_json AS valueJson FROM data_source_property_values
        WHERE data_source_id = ? AND membership_id = ? AND property_id = 'tags'
      `).get(targetDataSourceId, targetMembership.id),
    ).toEqual({ valueJson: stableStringifyDatabaseJson([targetTagId]) });
    const targetProjection = fixture.database.prepare(`
      SELECT membership_id AS membershipId,
        database_values_json AS valuesJson
      FROM page_read_model WHERE page_block_id = ?
    `).get(movingPageId) as {
      readonly membershipId: string;
      readonly valuesJson: string;
    };
    expect(targetProjection.membershipId).toBe(targetMembership.id);
    expect(JSON.parse(targetProjection.valuesJson)).toMatchObject({
      tags: ["shared tag"],
    });

    const afterSourceMove = fixture.database.prepare(`
      SELECT parent_revision AS parentRevision FROM pages WHERE block_id = ?
    `).get(movingPageId) as { readonly parentRevision: number };
    expect(applyFixture(fixture, "v2-transfer-library", [
      {
        kind: "transfer_page",
        pageId: movingPageId,
        expectedParentRevision: afterSourceMove.parentRevision,
        expectedActiveMembershipRevision: targetMembership.revision,
        target: {
          kind: "library",
          libraryId: (fixture.database.prepare(`
            SELECT library_id AS libraryId FROM pages WHERE block_id = ?
          `).get(movingPageId) as { readonly libraryId: string }).libraryId,
        },
      },
    ]).ok).toBe(true);
    expect(
      fixture.database.prepare(`
        SELECT parent_kind AS parentKind, membership_id AS membershipId,
          database_block_id AS databaseId, database_values_json AS valuesJson
        FROM pages page
        INNER JOIN page_read_model projection
          ON projection.page_block_id = page.block_id
        WHERE page.block_id = ?
      `).get(movingPageId),
    ).toEqual({
      parentKind: "library",
      membershipId: null,
      databaseId: null,
      valuesJson: "{}",
    });

    const afterLibraryMove = fixture.database.prepare(`
      SELECT parent_revision AS parentRevision FROM pages WHERE block_id = ?
    `).get(movingPageId) as { readonly parentRevision: number };
    const publicPageTarget = applyFixture(fixture, "v2-transfer-page-parent", [
      {
        kind: "transfer_page",
        pageId: movingPageId,
        expectedParentRevision: afterLibraryMove.parentRevision,
        expectedActiveMembershipRevision: 0,
        target: { kind: "page", pageId: parentPageId },
      },
    ]);
    expect(publicPageTarget).toMatchObject({
      ok: false,
      error: { code: "unsupported_operation" },
    });
    expect(
      fixture.database.prepare(`
        SELECT parent_kind AS parentKind, parent_id AS parentId
        FROM pages WHERE block_id = ?
      `).get(movingPageId),
    ).toEqual({
      parentKind: "library",
      parentId: (fixture.database.prepare(`
        SELECT library_id FROM pages WHERE block_id = ?
      `).get(movingPageId) as { readonly library_id: string }).library_id,
    });

    fixture.database.prepare(`
      UPDATE pages SET parent_kind = 'page', parent_id = ?
      WHERE block_id = ?
    `).run(parentPageId, movingPageId);
    const publicPageSource = applyFixture(fixture, "v2-transfer-page-source", [
      {
        kind: "transfer_page",
        pageId: movingPageId,
        expectedParentRevision: afterLibraryMove.parentRevision,
        expectedActiveMembershipRevision: 0,
        target: { kind: "data_source", dataSourceId: targetDataSourceId },
      },
    ]);
    expect(publicPageSource).toMatchObject({
      ok: false,
      error: { code: "unsupported_operation" },
    });
    expect(fixture.database.pragma("foreign_key_check")).toEqual([]);
  });
});
