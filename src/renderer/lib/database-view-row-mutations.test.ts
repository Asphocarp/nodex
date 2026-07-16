import { describe, expect, test } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import type {
  DatabaseApplyResult,
  DatabaseViewQueryResult,
  DataSourcePageRow,
  DataSourcePropertyRecord,
} from "../../shared/database-module";
import type { DatabaseViewRenderModel } from "./database-view-render-model";
import {
  buildDatabaseViewMoveOperations,
  buildDatabaseViewPropertyValueOperations,
  commitDatabaseViewOperations,
} from "./database-view-row-mutations";

const timestamp = "2026-07-12T00:00:00.000Z";
const libraryId = "library-1";
const dataSourceId = "source-1";

const model = (): DatabaseViewRenderModel => {
  const properties: readonly DataSourcePropertyRecord[] = [
    {
      propertyId: "property-score",
      dataSourceId,
      key: "score",
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
      propertyId: "property-tags",
      dataSourceId,
      key: "tags",
      name: "Tags",
      valueType: "multi_select",
      config: { options: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] },
      rankKey: "b",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  const view = {
    viewId: "view-1",
    databaseId: "database-1",
    dataSourceId,
    name: "All",
    kind: "list" as const,
    config: {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 1 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: [{ field: { kind: "manual" as const }, direction: "asc" as const, nulls: "last" as const }],
      group: null,
      display: { propertyIds: ["property-score", "property-tags"], showTitle: true },
    },
    isDefault: false,
    revision: 1,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const database = {
    databaseId: "database-1",
    libraryId,
    name: "Tasks",
    lifecycle: "active" as const,
    defaultViewId: "view-default",
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
  const rows: DatabaseViewQueryResult["rows"] = ["page-a", "page-b", "page-c"].map(
    (pageId, index): DataSourcePageRow => ({
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
            "property-score": { propertyId: "property-score", valueType: "number" as const, value: 1, revision: 3 },
            "property-tags": { propertyId: "property-tags", valueType: "multi_select" as const, value: ["one"], revision: 2 },
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
      propertyId: "property-score",
      value: 2,
    });
    const setLike = buildDatabaseViewPropertyValueOperations({
      model: authority,
      pageId: "page-a",
      propertyId: "property-tags",
      value: ["two"],
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
      propertyId: "property-tags",
      add: ["two"],
      remove: ["one"],
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
      propertyId: "property-score",
      value: 2,
    });
    const result: DatabaseApplyResult = {
      ok: true,
      value: {
        version: 1,
        operationId: "operation-1",
        projectId: "project-1",
        libraryId,
        storeEpoch: "epoch-1",
        duplicate: false,
        operationKinds: ["set_value"],
        affectedDatabaseIds: ["database-1"],
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
    expect(receipt?.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
