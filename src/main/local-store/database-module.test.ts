import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DATABASE_MODULE_CONTRACT_VERSION,
  type DatabaseApply,
  type DatabaseModuleReadSnapshot,
  type DatabaseViewQueryResult,
  type DataSourceDescriptor,
  type SetDataSourcePageValueOperation,
} from "../../shared/database-module";
import { initialDataSourceId } from "../../shared/library";
import { createPage } from "./database-pages";
import {
  applyDatabaseModule,
  createSqliteDatabaseModule,
  readDatabaseModule,
} from "./database-module";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { readPageDetailInDatabase } from "./page-detail";
import { putProjectResourceGrant } from "./project-resource-grants";
import { createProject } from "./projects";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-module-"),
  );
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

const readQuery = (
  projectId: string,
  target: { readonly kind: "project_default" }
    | { readonly kind: "view"; readonly viewId: string },
): DatabaseModuleReadSnapshot => {
  const read = target.kind === "project_default"
    ? { target, mode: "query" as const }
    : { target, mode: "query" as const };
  const result = readDatabaseModule(getDb(), {
    version: DATABASE_MODULE_CONTRACT_VERSION,
    projectId,
    read,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const queryValue = (
  snapshot: DatabaseModuleReadSnapshot,
): DatabaseViewQueryResult => {
  if (snapshot.value.kind !== "query") {
    throw new Error(`Expected query, received ${snapshot.value.kind}`);
  }
  return snapshot.value.value;
};

describe("Database Module", () => {
  test("reads Container, Data Source, View, and Page rows without Project ownership", async () => {
    const executor = createProject({ name: "Executor" });
    const foreign = createProject({ name: "Foreign" });
    const executorPage = await createPage(executor.id, "draft", {
      title: "Executor Page",
    });
    const foreignPage = await createPage(foreign.id, "in_review", {
      title: "Foreign Page",
    });

    const ownQuery = queryValue(readQuery(executor.id, {
      kind: "project_default",
    }));
    expect(ownQuery.database.databaseId).toBe(executor.databaseId);
    expect(ownQuery.dataSource.dataSourceId).toBe(
      initialDataSourceId(executor.databaseId),
    );
    expect(ownQuery.view.dataSourceId).toBe(ownQuery.dataSource.dataSourceId);
    expect(ownQuery.rows.map((row) => row.page.pageId)).toContain(
      executorPage.id,
    );
    expect(ownQuery.rows[0]?.page.parent).toMatchObject({
      kind: "data_source",
      dataSourceId: ownQuery.dataSource.dataSourceId,
    });

    const denied = readDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      projectId: executor.id,
      read: {
        target: {
          kind: "view",
          viewId: foreign.databaseId.replace(
            /^database:/u,
            "database-view:",
          ).replace(/:primary$/u, ":primary-kanban"),
        },
        mode: "query",
      },
    });
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });

    putProjectResourceGrant({
      projectId: executor.id,
      root: { kind: "database", databaseId: foreign.databaseId },
      access: "read_write",
    });
    const foreignViewId = (
      getDb().prepare(`
        SELECT default_view_id AS viewId
        FROM database_containers WHERE block_id = ?
      `).get(foreign.databaseId) as { readonly viewId: string }
    ).viewId;
    const foreignQuery = queryValue(readQuery(executor.id, {
      kind: "view",
      viewId: foreignViewId,
    }));
    expect(foreignQuery.rows.map((row) => row.page.pageId)).toEqual([
      foreignPage.id,
    ]);
    expect(foreignQuery.rows[0]?.page.libraryId).toBe(executor.libraryId);

    const adapter = createSqliteDatabaseModule(getDb());
    const sourceRead = await adapter.read({
      version: DATABASE_MODULE_CONTRACT_VERSION,
      projectId: executor.id,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: foreignQuery.dataSource.dataSourceId,
        },
        mode: "data_source",
      },
    });
    expect(sourceRead.ok && sourceRead.value.value.kind).toBe("data_source");

    const sourceQuery = await adapter.read({
      version: DATABASE_MODULE_CONTRACT_VERSION,
      projectId: executor.id,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: foreignQuery.dataSource.dataSourceId,
        },
        mode: "query",
        filter: {
          kind: "clause",
          propertyId: foreignQuery.properties.find(
            (property) => property.key === "status",
          )?.propertyId ?? "missing-status-property",
          operator: "equals",
          value: "in_review",
        },
        sort: [{
          field: { kind: "title" },
          direction: "asc",
          nulls: "last",
        }],
      },
    });
    expect(
      sourceQuery.ok && sourceQuery.value.value.kind === "data_source_query"
        ? sourceQuery.value.value.value.rows.map((row) => row.page.pageId)
        : null,
    ).toEqual([foreignPage.id]);
  });

  test("applies revisioned values and schema through explicit Data Source authority", async () => {
    const project = createProject({ name: "Apply" });
    const page = await createPage(project.id, "draft", { title: "Page" });
    const before = queryValue(readQuery(project.id, {
      kind: "project_default",
    }));
    const statusProperty = before.properties.find(
      (property) => property.key === "status",
    );
    const row = before.rows.find((candidate) => candidate.page.pageId === page.id);
    if (!statusProperty || !row) throw new Error("Missing status authority");
    const storeEpoch = (
      getDb().prepare(`
        SELECT store_epoch AS value FROM block_store_metadata WHERE id = 1
      `).get() as { readonly value: string }
    ).value;

    const statusOperation: SetDataSourcePageValueOperation = {
      kind: "set_value",
      pageId: page.id,
      dataSourceId: before.dataSource.dataSourceId,
      propertyId: statusProperty.propertyId,
      expectedValueRevision:
        row.values[statusProperty.propertyId]?.revision ?? 0,
      value: "in_progress",
    };
    const setStatus: DatabaseApply = {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:set-status",
      projectId: project.id,
      storeEpoch,
      actor: { kind: "test" },
      operations: [statusOperation],
    };
    const applied = applyDatabaseModule(getDb(), setStatus);
    expect(applied).toMatchObject({ ok: true, value: { duplicate: false } });
    expect(applyDatabaseModule(getDb(), setStatus)).toMatchObject({
      ok: true,
      value: { duplicate: true },
    });
    expect(applyDatabaseModule(getDb(), {
      ...setStatus,
      operations: [{ ...statusOperation, value: "done" }],
    })).toMatchObject({
      ok: false,
      error: { code: "operation_id_collision" },
    });

    const afterValue = queryValue(readQuery(project.id, {
      kind: "project_default",
    }));
    const updatedRow = afterValue.rows.find(
      (candidate) => candidate.page.pageId === page.id,
    );
    expect(updatedRow?.values[statusProperty.propertyId]?.value).toBe(
      "in_progress",
    );
    expect(updatedRow?.effectiveGroupKey).toBe("in_progress");
    expect(updatedRow?.position?.groupKey).toBe("in_progress");

    const sourceRead = readDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      projectId: project.id,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: before.dataSource.dataSourceId,
        },
        mode: "data_source",
      },
    });
    if (!sourceRead.ok || sourceRead.value.value.kind !== "data_source") {
      throw new Error("Missing Data Source descriptor");
    }
    const source = sourceRead.value.value.value as DataSourceDescriptor;
    const putProperty = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:put-property",
      projectId: project.id,
      storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "put_property",
        dataSourceId: source.dataSource.dataSourceId,
        propertyId: "property:notes",
        expectedDataSourceRevision: source.dataSource.schemaRevision,
        expectedPropertyRevision: 0,
        key: "notes",
        name: "Notes",
        valueType: "text",
        config: {},
      }],
    });
    expect(putProperty).toMatchObject({
      ok: true,
      value: {
        affectedDataSourceIds: [source.dataSource.dataSourceId],
        committedRevisions: { "property:property:notes": 1 },
      },
    });
    const properties = getDb().prepare(`
      SELECT id FROM data_source_properties
      WHERE data_source_id = ? AND lifecycle = 'active'
      ORDER BY id
    `).all(source.dataSource.dataSourceId) as readonly { readonly id: string }[];
    expect(properties.map((property) => property.id)).toContain(
      "property:notes",
    );
  });

  test("merges multi-select intent without snapshot revision conflicts", async () => {
    const project = createProject({ name: "Set-like values" });
    const page = await createPage(project.id, "draft", { title: "Tagged Page" });
    const beforeSnapshot = readQuery(project.id, { kind: "project_default" });
    const before = queryValue(beforeSnapshot);
    const tags = before.properties.find((property) => property.key === "tags");
    if (!tags) throw new Error("Missing tags property");
    const configured = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:tags:configure",
      projectId: project.id,
      storeEpoch: beforeSnapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "put_property",
        dataSourceId: before.dataSource.dataSourceId,
        propertyId: tags.propertyId,
        expectedDataSourceRevision: before.dataSource.schemaRevision,
        expectedPropertyRevision: tags.revision,
        key: tags.key,
        name: tags.name,
        valueType: tags.valueType,
        config: {
          options: [
            { id: "alpha", name: "Alpha" },
            { id: "beta", name: "Beta" },
          ],
        },
      }],
    });
    if (!configured.ok) throw new Error(configured.error.message);

    const applySetIntent = (
      operationId: string,
      add: readonly string[],
      remove: readonly string[],
    ) => applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId,
      projectId: project.id,
      storeEpoch: beforeSnapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "add_remove_value",
        pageId: page.id,
        dataSourceId: before.dataSource.dataSourceId,
        propertyId: tags.propertyId,
        add,
        remove,
      }],
    });

    const firstIntent = applySetIntent(
      "database-module:tags:add",
      ["alpha"],
      [],
    );
    if (!firstIntent.ok) throw new Error(firstIntent.error.message);
    expect(firstIntent).toMatchObject({
      ok: true,
      value: { affectedPageIds: [page.id] },
    });
    expect(applySetIntent(
      "database-module:tags:replace",
      ["beta"],
      ["alpha"],
    )).toMatchObject({ ok: true });

    const afterReplace = queryValue(readQuery(project.id, {
      kind: "project_default",
    }));
    const row = afterReplace.rows.find(
      (candidate) => candidate.page.pageId === page.id,
    );
    expect(row?.values[tags.propertyId]?.value).toEqual(["beta"]);
    const revision = row?.values[tags.propertyId]?.revision;

    expect(applySetIntent(
      "database-module:tags:idempotent",
      ["beta"],
      ["alpha"],
    )).toMatchObject({
      ok: true,
      value: { affectedPageIds: [] },
    });
    const afterIdempotent = queryValue(readQuery(project.id, {
      kind: "project_default",
    }));
    expect(afterIdempotent.rows.find(
      (candidate) => candidate.page.pageId === page.id,
    )?.values[tags.propertyId]?.revision).toBe(revision);
  });

  test("preserves View placement on edits and appends only by explicit intent", () => {
    const project = createProject({ name: "View order" });
    const beforeSnapshot = readQuery(project.id, { kind: "project_default" });
    const before = queryValue(beforeSnapshot);
    const config = {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 1 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: [],
      group: null,
      display: { propertyIds: [], showTitle: true },
    };
    const applyViews = (
      operationId: string,
      operations: DatabaseApply["operations"],
    ) => applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId,
      projectId: project.id,
      storeEpoch: beforeSnapshot.storeEpoch,
      actor: { kind: "test" },
      operations,
    });
    const view = (viewId: string, name: string) => ({
      kind: "put_view" as const,
      databaseId: before.database.databaseId,
      dataSourceId: before.dataSource.dataSourceId,
      viewId,
      expectedRevision: 0,
      name,
      viewKind: "list" as const,
      config,
      isDefault: false,
    });

    expect(applyViews("database-module:views:create", [
      view("view-b", "B"),
      view("view-c", "C"),
    ])).toMatchObject({ ok: true });
    expect(applyViews("database-module:views:rename", [{
      ...view("view-b", "B renamed"),
      expectedRevision: 1,
    }])).toMatchObject({ ok: true });

    const readViewIds = (): readonly string[] => {
      const result = readDatabaseModule(getDb(), {
        version: DATABASE_MODULE_CONTRACT_VERSION,
        projectId: project.id,
        read: {
          target: {
            kind: "database",
            databaseId: before.database.databaseId,
          },
          mode: "database",
        },
      });
      if (!result.ok || result.value.value.kind !== "database") {
        throw new Error("Missing Database descriptor");
      }
      return result.value.value.value.views.map((candidate) => candidate.viewId);
    };
    expect(readViewIds()).toEqual([
      before.view.viewId,
      "view-b",
      "view-c",
    ]);

    expect(applyViews("database-module:views:append", [{
      ...view("view-b", "B renamed"),
      expectedRevision: 2,
      beforeViewId: null,
    }])).toMatchObject({ ok: true });
    expect(readViewIds()).toEqual([
      before.view.viewId,
      "view-c",
      "view-b",
    ]);
  });

  test("allows foreign content writes but rejects foreign structural changes", async () => {
    const executor = createProject({ name: "Executor" });
    const foreign = createProject({ name: "Foreign" });
    const foreignPage = await createPage(foreign.id, "draft", {
      title: "Foreign Page",
    });
    putProjectResourceGrant({
      projectId: executor.id,
      root: { kind: "database", databaseId: foreign.databaseId },
      access: "read_write",
    });
    const foreignViewId = (
      getDb().prepare(`
        SELECT default_view_id AS viewId FROM database_containers
        WHERE block_id = ?
      `).get(foreign.databaseId) as { readonly viewId: string }
    ).viewId;
    const query = queryValue(readQuery(executor.id, {
      kind: "view",
      viewId: foreignViewId,
    }));
    const status = query.properties.find((property) => property.key === "status");
    const row = query.rows[0];
    if (!status || !row) throw new Error("Missing foreign row");
    const storeEpoch = readQuery(executor.id, {
      kind: "view",
      viewId: foreignViewId,
    }).storeEpoch;

    expect(applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:foreign-value",
      projectId: executor.id,
      storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "set_value",
        pageId: foreignPage.id,
        dataSourceId: query.dataSource.dataSourceId,
        propertyId: status.propertyId,
        expectedValueRevision: row.values[status.propertyId]?.revision ?? 0,
        value: "done",
      }],
    })).toMatchObject({ ok: true });
    expect(queryValue(readQuery(executor.id, {
      kind: "view",
      viewId: foreignViewId,
    })).rows[0]?.values[status.propertyId]?.value).toBe("done");

    expect(applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:foreign-schema",
      projectId: executor.id,
      storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "put_property",
        dataSourceId: query.dataSource.dataSourceId,
        propertyId: "property:forbidden",
        expectedDataSourceRevision: query.dataSource.schemaRevision,
        expectedPropertyRevision: 0,
        key: "forbidden",
        name: "Forbidden",
        valueType: "text",
        config: {},
      }],
    })).toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });
  });

  test("lets a recursive Page grant write that Page's Source values only", async () => {
    const executor = createProject({ name: "Executor" });
    const owner = createProject({ name: "Owner" });
    const page = await createPage(owner.id, "draft", { title: "Shared Page" });
    putProjectResourceGrant({
      projectId: executor.id,
      root: { kind: "page", pageId: page.id },
      access: "read_write",
    });
    const detail = readPageDetailInDatabase(getDb(), executor.id, page.id);
    if (!detail.ok || detail.value.dataSourceContext.kind !== "member") {
      throw new Error("Missing granted Page Data Source context");
    }
    const context = detail.value.dataSourceContext;
    const status = context.properties.find(
      (property) => property.key === "status",
    );
    if (!status) throw new Error("Missing status property");

    expect(applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:page-grant-value",
      projectId: executor.id,
      storeEpoch: detail.value.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "set_value",
        pageId: page.id,
        dataSourceId: context.dataSource.dataSourceId,
        propertyId: status.propertyId,
        expectedValueRevision: context.values[status.propertyId]?.revision ?? 0,
        value: "in_progress",
      }],
    })).toMatchObject({ ok: true });
    const updated = readPageDetailInDatabase(getDb(), executor.id, page.id);
    expect(
      updated.ok &&
        updated.value.dataSourceContext.kind === "member" &&
        updated.value.dataSourceContext.values[status.propertyId]?.value,
    ).toBe("in_progress");

    expect(applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:page-grant-schema-denied",
      projectId: executor.id,
      storeEpoch: detail.value.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "put_property",
        dataSourceId: context.dataSource.dataSourceId,
        propertyId: "property:forbidden",
        expectedDataSourceRevision: context.dataSource.schemaRevision,
        expectedPropertyRevision: 0,
        key: "forbidden",
        name: "Forbidden",
        valueType: "text",
        config: {},
      }],
    })).toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });
  });

  test("transfers Pages across every exclusive parent kind and rejects cycles", async () => {
    const project = createProject({ name: "Page hierarchy" });
    const parent = await createPage(project.id, "draft", { title: "Parent" });
    const child = await createPage(project.id, "draft", { title: "Child" });
    const snapshot = readQuery(project.id, { kind: "project_default" });
    const query = queryValue(snapshot);
    const secondarySourceId = "data-source:page-hierarchy:secondary";
    getDb().prepare(`
      INSERT INTO data_sources (
        id, library_id, home_database_block_id, name, schema_key,
        schema_revision, lifecycle, rank_key, created_at, updated_at
      )
      SELECT ?, library_id, home_database_block_id, 'Secondary', schema_key,
        1, 'active', 'c0000000000000000000000000000000', created_at, updated_at
      FROM data_sources WHERE id = ?
    `).run(secondarySourceId, query.dataSource.dataSourceId);
    const parentRow = query.rows.find((row) => row.page.pageId === parent.id);
    const childRow = query.rows.find((row) => row.page.pageId === child.id);
    if (!parentRow || !childRow) throw new Error("Missing Page rows");

    const nested = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:nest-page",
      projectId: project.id,
      storeEpoch: snapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "transfer_page",
        pageId: child.id,
        expectedParentRevision: childRow.page.parentRevision,
        expectedActiveMembershipRevision: childRow.membership.revision,
        target: { kind: "page", pageId: parent.id },
      }],
    });
    expect(nested).toMatchObject({
      ok: true,
      value: { affectedPageIds: [child.id] },
    });
    const nestedDetail = readPageDetailInDatabase(getDb(), project.id, child.id);
    expect(nestedDetail).toMatchObject({
      ok: true,
      value: {
        page: { parent: { kind: "page", pageId: parent.id } },
        dataSourceContext: { kind: "standalone" },
      },
    });
    if (!nestedDetail.ok) throw new Error("Missing nested Page detail");

    expect(applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:reject-page-cycle",
      projectId: project.id,
      storeEpoch: snapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "transfer_page",
        pageId: parent.id,
        expectedParentRevision: parentRow.page.parentRevision,
        expectedActiveMembershipRevision: parentRow.membership.revision,
        target: { kind: "page", pageId: child.id },
      }],
    })).toMatchObject({
      ok: false,
      error: { code: "unsupported_operation" },
    });

    const movedToLibrary = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:page-to-library",
      projectId: project.id,
      storeEpoch: snapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "transfer_page",
        pageId: child.id,
        expectedParentRevision: nestedDetail.value.page.parentRevision,
        expectedActiveMembershipRevision: 0,
        target: { kind: "library", libraryId: project.libraryId },
      }],
    });
    if (!movedToLibrary.ok) throw new Error(movedToLibrary.error.message);
    const libraryDetail = readPageDetailInDatabase(getDb(), project.id, child.id);
    expect(libraryDetail).toMatchObject({
      ok: true,
      value: {
        page: {
          parent: { kind: "library", libraryId: project.libraryId },
        },
      },
    });
    if (!libraryDetail.ok) throw new Error("Missing Library Page detail");
    expect(applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:page-to-data-source",
      projectId: project.id,
      storeEpoch: snapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "transfer_page",
        pageId: child.id,
        expectedParentRevision: libraryDetail.value.page.parentRevision,
        expectedActiveMembershipRevision: 0,
        target: {
          kind: "data_source",
          dataSourceId: secondarySourceId,
        },
      }],
    })).toMatchObject({ ok: true });
    expect(readPageDetailInDatabase(getDb(), project.id, child.id)).toMatchObject({
      ok: true,
      value: {
        page: {
          parent: {
            kind: "data_source",
            dataSourceId: secondarySourceId,
          },
        },
        dataSourceContext: { kind: "member" },
      },
    });
    getDb().prepare(`
      UPDATE blocks
      SET metadata_revision = metadata_revision + 1
      WHERE id = ?
    `).run(child.id);
    expect(readPageDetailInDatabase(getDb(), project.id, child.id)).toMatchObject({
      ok: true,
      value: {
        page: {
          parent: { kind: "data_source", dataSourceId: secondarySourceId },
        },
      },
    });
  });

  test("moves an ordered Page run atomically in one Data Source View", async () => {
    const project = createProject({ name: "Bulk Page positions" });
    const first = await createPage(project.id, "in_progress", { title: "First" });
    const second = await createPage(project.id, "in_progress", { title: "Second" });
    const target = await createPage(project.id, "done", { title: "Target" });
    const beforeSnapshot = readQuery(project.id, { kind: "project_default" });
    const before = queryValue(beforeSnapshot);
    const status = before.properties.find((property) => property.key === "status");
    if (!status) throw new Error("Missing status property");
    const rows = new Map(
      before.rows.map((row) => [row.page.pageId, row] as const),
    );
    const selected = [second.id, first.id];

    const result = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:position-pages",
      projectId: project.id,
      storeEpoch: beforeSnapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [
        {
          kind: "set_values",
          values: selected.map((pageId) => ({
            pageId,
            dataSourceId: before.dataSource.dataSourceId,
            propertyId: status.propertyId,
            expectedValueRevision:
              rows.get(pageId)?.values[status.propertyId]?.revision ?? 0,
            value: "done",
          })),
        },
        {
          kind: "position_pages",
          viewId: before.view.viewId,
          pages: selected.map((pageId) => ({
            pageId,
            expectedPositionRevision:
              rows.get(pageId)?.position?.revision ?? 0,
          })),
          groupKey: "done",
          beforePageId: target.id,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        operationKinds: ["set_values", "position_pages"],
        affectedDatabaseIds: [before.database.databaseId],
        affectedDataSourceIds: [before.dataSource.dataSourceId],
        affectedPageIds: [...selected].sort(),
        affectedViewIds: [before.view.viewId],
      },
    });
    const after = queryValue(readQuery(project.id, { kind: "project_default" }));
    expect(after.rows
      .filter((row) => row.effectiveGroupKey === "done")
      .map((row) => row.page.pageId)).toEqual([
        second.id,
        first.id,
        target.id,
      ]);
  });

  test("inserts across groups before an unpositioned logical Page anchor", async () => {
    const project = createProject({ name: "Logical View positions" });
    const moved = await createPage(project.id, "in_progress", { title: "Moved" });
    const firstTarget = await createPage(project.id, "draft", { title: "First target" });
    const secondTarget = await createPage(project.id, "draft", { title: "Second target" });

    const removeManualPosition = (pageId: string, operationPrefix: string): void => {
      const before = readQuery(project.id, { kind: "project_default" });
      const query = queryValue(before);
      const row = query.rows.find((candidate) => candidate.page.pageId === pageId);
      if (!row) throw new Error(`Missing Page ${pageId}`);
      const detached = applyDatabaseModule(getDb(), {
        version: DATABASE_MODULE_CONTRACT_VERSION,
        operationId: `${operationPrefix}:detach`,
        projectId: project.id,
        storeEpoch: before.storeEpoch,
        actor: { kind: "test" },
        operations: [{
          kind: "transfer_page",
          pageId,
          expectedParentRevision: row.page.parentRevision,
          expectedActiveMembershipRevision: row.membership.revision,
          target: { kind: "library", libraryId: project.libraryId },
        }],
      });
      if (!detached.ok) throw new Error(detached.error.message);
      const detail = readPageDetailInDatabase(getDb(), project.id, pageId);
      if (!detail.ok) throw new Error(detail.error.message);
      const restored = applyDatabaseModule(getDb(), {
        version: DATABASE_MODULE_CONTRACT_VERSION,
        operationId: `${operationPrefix}:restore`,
        projectId: project.id,
        storeEpoch: before.storeEpoch,
        actor: { kind: "test" },
        operations: [{
          kind: "transfer_page",
          pageId,
          expectedParentRevision: detail.value.page.parentRevision,
          expectedActiveMembershipRevision: 0,
          target: {
            kind: "data_source",
            dataSourceId: query.dataSource.dataSourceId,
          },
        }],
      });
      if (!restored.ok) throw new Error(restored.error.message);
    };

    removeManualPosition(firstTarget.id, "logical-position:first");
    removeManualPosition(secondTarget.id, "logical-position:second");
    const beforeSnapshot = readQuery(project.id, { kind: "project_default" });
    const before = queryValue(beforeSnapshot);
    const status = before.properties.find((property) => property.key === "status");
    const movedRow = before.rows.find((row) => row.page.pageId === moved.id);
    if (!status || !movedRow) throw new Error("Missing status authority");
    const targetOrder = [firstTarget.id, secondTarget.id].sort();
    expect(targetOrder.every((pageId) =>
      before.rows.find((row) => row.page.pageId === pageId)?.position === null
    )).toBe(true);

    const rejected = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:missing-logical-position-anchor",
      projectId: project.id,
      storeEpoch: beforeSnapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [
        {
          kind: "set_value",
          pageId: moved.id,
          dataSourceId: before.dataSource.dataSourceId,
          propertyId: status.propertyId,
          expectedValueRevision:
            movedRow.values[status.propertyId]?.revision ?? 0,
          value: "draft",
        },
        {
          kind: "position_page",
          viewId: before.view.viewId,
          pageId: moved.id,
          expectedPositionRevision: movedRow.position?.revision ?? 0,
          groupKey: "draft",
          beforePageId: "missing-logical-anchor",
        },
      ],
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    const afterRejected = queryValue(readQuery(project.id, {
      kind: "project_default",
    }));
    expect(afterRejected.rows.find((row) => row.page.pageId === moved.id)
      ?.effectiveGroupKey).toBe("in_progress");
    expect(targetOrder.every((pageId) =>
      afterRejected.rows.find((row) => row.page.pageId === pageId)?.position === null
    )).toBe(true);

    const result = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:logical-position-anchor",
      projectId: project.id,
      storeEpoch: beforeSnapshot.storeEpoch,
      actor: { kind: "test" },
      operations: [
        {
          kind: "set_value",
          pageId: moved.id,
          dataSourceId: before.dataSource.dataSourceId,
          propertyId: status.propertyId,
          expectedValueRevision:
            movedRow.values[status.propertyId]?.revision ?? 0,
          value: "draft",
        },
        {
          kind: "position_page",
          viewId: before.view.viewId,
          pageId: moved.id,
          expectedPositionRevision: movedRow.position?.revision ?? 0,
          groupKey: "draft",
          beforePageId: targetOrder[1],
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    const after = queryValue(readQuery(project.id, { kind: "project_default" }));
    expect(after.rows
      .filter((row) => [moved.id, ...targetOrder].includes(row.page.pageId))
      .map((row) => row.page.pageId)).toEqual([
        targetOrder[0],
        moved.id,
        targetOrder[1],
      ]);
    expect(after.rows
      .filter((row) => targetOrder.includes(row.page.pageId))
      .map((row) => row.position?.revision)).toEqual([1, 1]);
  });

  test("keeps sequential explicit position intents at their captured revisions", async () => {
    const project = createProject({ name: "Sequential View positions" });
    const first = await createPage(project.id, "draft", { title: "First" });
    const second = await createPage(project.id, "draft", { title: "Second" });
    const later = await createPage(project.id, "draft", { title: "Later" });
    const initial = readQuery(project.id, { kind: "project_default" });
    const view = queryValue(initial).view;
    getDb().prepare(`
      DELETE FROM database_view_positions
      WHERE view_id = ? AND block_id IN (?, ?, ?)
    `).run(view.viewId, first.id, second.id, later.id);
    const before = readQuery(project.id, { kind: "project_default" });
    expect(queryValue(before).rows
      .filter((row) => [first.id, second.id].includes(row.page.pageId))
      .every((row) => row.position === null)).toBe(true);

    const result = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:sequential-position-pages",
      projectId: project.id,
      storeEpoch: before.storeEpoch,
      actor: { kind: "test" },
      operations: [first.id, second.id].map((pageId) => ({
        kind: "position_page" as const,
        viewId: view.viewId,
        pageId,
        expectedPositionRevision: 0,
        groupKey: "draft",
      })),
    });

    expect(result).toMatchObject({ ok: true });
    expect(queryValue(readQuery(project.id, { kind: "project_default" })).rows
      .filter((row) => [first.id, second.id].includes(row.page.pageId))
      .map((row) => [row.page.pageId, row.position?.revision])).toEqual([
        [first.id, 1],
        [second.id, 1],
      ]);
    const staleLater = applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:stale-materialized-position",
      projectId: project.id,
      storeEpoch: before.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "position_page",
        viewId: view.viewId,
        pageId: later.id,
        expectedPositionRevision: 0,
        groupKey: "draft",
      }],
    });
    expect(staleLater).toMatchObject({
      ok: false,
      error: { code: "revision_conflict", actualRevision: 1 },
    });
    const refreshed = queryValue(readQuery(project.id, {
      kind: "project_default",
    })).rows.find((row) => row.page.pageId === later.id);
    expect(refreshed?.position?.revision).toBe(1);
    expect(applyDatabaseModule(getDb(), {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-module:fresh-materialized-position",
      projectId: project.id,
      storeEpoch: before.storeEpoch,
      actor: { kind: "test" },
      operations: [{
        kind: "position_page",
        viewId: view.viewId,
        pageId: later.id,
        expectedPositionRevision: refreshed?.position?.revision ?? 0,
        groupKey: "draft",
      }],
    })).toMatchObject({ ok: true });
  });
});
