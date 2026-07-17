import { describe, expect, test } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import type {
  DatabaseApplyResultV2,
  DatabaseViewQueryResultV2,
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import type { DatabaseViewRenderModel } from "./database-view-render-model";
import {
  buildDatabaseViewMoveOperations,
  buildDatabaseViewPropertyValueOperations,
  commitDatabaseViewOperations,
} from "./database-view-row-mutations";

const timestamp = "2026-07-12T00:00:00.000Z";
const libraryId = "library-1";
const databaseId = parseDatabaseId("database-1");
const dataSourceId = parseDataSourceId("source-1");
const viewId = parseDatabaseViewId("view-1");
const scorePropertyId = parseDataSourcePropertyId("p_AAAAAAAA");
const tagsPropertyId = parseDataSourcePropertyId("tags");

const model = (): DatabaseViewRenderModel => {
  const properties: readonly DataSourcePropertyRecordV2[] = [
    {
      propertyId: scorePropertyId,
      dataSourceId,
      name: "Score",
      valueType: "number",
      config: {},
      rankKey: "a",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: tagsPropertyId,
      dataSourceId,
      name: "Tags",
      valueType: "multi_select",
      config: {
        options: [
          { id: "o_AAAAAAAA", name: "One" },
          { id: "o_BBBBBBBB", name: "Two" },
        ],
      },
      rankKey: "b",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  const view = {
    viewId,
    databaseId,
    dataSourceId,
    name: "All",
    kind: "list" as const,
    config: {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 2 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: [{ field: { kind: "manual" as const }, direction: "asc" as const, nulls: "last" as const }],
      group: null,
      display: { propertyIds: [scorePropertyId, tagsPropertyId], showTitle: true },
    },
    isDefault: false,
    revision: 1,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const database = {
    databaseId,
    libraryId,
    name: "Tasks",
    lifecycle: "active" as const,
    defaultViewId: parseDatabaseViewId("view-default"),
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const dataSource = {
    dataSourceId,
    libraryId,
    homeDatabaseId: database.databaseId,
    name: "Pages",
    schemaKey: "nodex.pages",
    schemaRevision: 2,
    lifecycle: "active" as const,
    rankKey: "a",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const rows: DatabaseViewQueryResultV2["rows"] = ["page-a", "page-b", "page-c"].map(
    (pageId, index): DataSourcePageRowV2 => ({
      membership: {
        membershipId: `membership-${pageId}`,
        dataSourceId,
        revision: 1,
        createdAt: timestamp,
      },
      page: {
        pageId,
        libraryId,
        parent: { kind: "data_source" as const, dataSourceId },
        lifecycle: "active" as const,
        parentRevision: 1,
        metadataRevision: 1,
        documentId: `document-${pageId}`,
        documentGeneration: 1,
        documentHeadSeq: 1,
        title: pageId,
        richTitle: plainTextToPortableRichText(pageId),
        preview: "",
        plainText: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      values: index === 0
        ? {
            [scorePropertyId]: { propertyId: scorePropertyId, valueType: "number" as const, value: 1, revision: 3 },
            [tagsPropertyId]: { propertyId: tagsPropertyId, valueType: "multi_select" as const, value: ["o_AAAAAAAA"], revision: 2 },
          }
        : {},
      position: index === 2
        ? null
        : { groupKey: null, rankKey: String(index), revision: index + 1 },
      effectiveGroupKey: null,
    }),
  );
  return {
    projectId: "project-1",
    databaseViewId: view.viewId,
    databaseId: database.databaseId,
    dataSourceId,
    databaseName: database.name,
    dataSourceName: dataSource.name,
    viewName: view.name,
    storeEpoch: "epoch-1",
    changeLogSeq: 4,
    query: { database, dataSource, view, properties, rows },
    columns: [{
      id: "all",
      name: "All",
      rows: rows.map((row) => ({
        pageId: row.page.pageId,
        title: row.page.title,
        preview: "",
        plainText: "",
        tags: [],
        metadataRevision: 1,
        createdAt: new Date(timestamp),
      })),
    }],
    primaryWriteCompatible: false,
    readOnlyReason: null,
  };
};

describe("selected Database View Page mutations", () => {
  test("uses scalar CAS and set-like multi-select intent from one query snapshot", () => {
    const authority = model();
    const scalar = buildDatabaseViewPropertyValueOperations({
      model: authority,
      pageId: "page-a",
      propertyId: scorePropertyId,
      value: 2,
    });
    const setLike = buildDatabaseViewPropertyValueOperations({
      model: authority,
      pageId: "page-a",
      propertyId: tagsPropertyId,
      value: ["o_BBBBBBBB"],
    });
    expect(scalar[0]).toMatchObject({
      kind: "set_value",
      pageId: "page-a",
      dataSourceId,
      expectedValueRevision: 3,
    });
    expect(setLike[0]).toEqual({
      kind: "add_remove_value",
      pageId: "page-a",
      dataSourceId,
      propertyId: tagsPropertyId,
      add: ["o_BBBBBBBB"],
      remove: ["o_AAAAAAAA"],
    });
  });

  test("initializes an unfiltered group's complete manual order atomically", () => {
    const operations = buildDatabaseViewMoveOperations({
      model: model(),
      pageId: "page-a",
      direction: "down",
    });
    expect(operations[0]).toEqual({
      kind: "position_pages",
      viewId: "view-1",
      pages: [
        { pageId: "page-b", expectedPositionRevision: 2 },
        { pageId: "page-a", expectedPositionRevision: 1 },
        { pageId: "page-c", expectedPositionRevision: 0 },
      ],
      groupKey: null,
    });
  });

  test("retains the exact request identity across one transport retry", async () => {
    const requests: string[] = [];
    let calls = 0;
    const operations = buildDatabaseViewPropertyValueOperations({
      model: model(),
      pageId: "page-a",
      propertyId: scorePropertyId,
      value: 2,
    });
    const result: DatabaseApplyResultV2 = {
      ok: true,
      value: {
        version: 2,
        operationId: "operation-1",
        projectId: "project-1",
        libraryId,
        storeEpoch: "epoch-1",
        duplicate: false,
        operationKinds: ["set_value"],
        affectedDatabaseIds: [databaseId],
        affectedDataSourceIds: [dataSourceId],
        affectedPageIds: ["page-a"],
        affectedViewIds: [],
        committedRevisions: {},
        changeLogSeq: 5,
        committedAt: timestamp,
      },
    };
    const receipt = await commitDatabaseViewOperations({
      model: model(),
      operations,
      dependencies: {
        apply: async (_projectId, request) => {
          requests.push(JSON.stringify(request));
          calls += 1;
          if (calls === 1) throw new Error("transport lost ACK");
          return {
            ...result,
            value: { ...result.value, operationId: request.operationId },
          };
        },
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
    expect(receipt?.operationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
