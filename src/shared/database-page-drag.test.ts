import { describe, expect, test } from "vitest";

import type {
  DatabaseModuleReadSnapshot,
  DatabaseViewQueryResult,
} from "./database-module";
import {
  compileDatabasePageDrag,
  compileDatabasePagesDrag,
  DatabasePageDragError,
} from "./database-page-drag";

const timestamp = "2026-07-16T00:00:00.000Z";

const querySnapshot = (input: {
  readonly status?: string;
  readonly manual?: boolean;
} = {}): DatabaseModuleReadSnapshot => {
  const database = {
    databaseId: "database-1",
    libraryId: "library-1",
    name: "Work",
    lifecycle: "active" as const,
    defaultViewId: "view-1",
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const dataSource = {
    dataSourceId: "source-1",
    libraryId: "library-1",
    homeDatabaseId: database.databaseId,
    name: "Pages",
    schemaKey: "nodex.pages",
    schemaRevision: 2,
    lifecycle: "active" as const,
    rankKey: "a",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const properties = [
    {
      propertyId: "property-status",
      dataSourceId: dataSource.dataSourceId,
      key: "status",
      name: "Status",
      valueType: "select" as const,
      config: {},
      rankKey: "a",
      lifecycle: "active" as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: "property-priority",
      dataSourceId: dataSource.dataSourceId,
      key: "priority",
      name: "Priority",
      valueType: "select" as const,
      config: {},
      rankKey: "b",
      lifecycle: "active" as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  const view = {
    viewId: "view-1",
    databaseId: database.databaseId,
    dataSourceId: dataSource.dataSourceId,
    name: "Board",
    kind: "kanban" as const,
    config: {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 1 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: input.manual === false
        ? [{
            field: { kind: "property" as const, propertyId: "property-priority" },
            direction: "asc" as const,
            nulls: "last" as const,
          }]
        : [{
            field: { kind: "manual" as const },
            direction: "asc" as const,
            nulls: "last" as const,
          }],
      group: { propertyId: "property-status" },
      display: { propertyIds: [], showTitle: true },
    },
    isDefault: true,
    revision: 2,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const row = (
    pageId: string,
    status: string,
    priority: string,
    rankKey: string,
    revision: number,
  ): DatabaseViewQueryResult["rows"][number] => ({
    page: {
      pageId,
      libraryId: "library-1",
      parent: { kind: "data_source", dataSourceId: dataSource.dataSourceId },
      lifecycle: "active",
      parentRevision: 1,
      metadataRevision: 1,
      documentId: `document:${pageId}`,
      documentGeneration: 1,
      documentHeadSeq: 1,
      title: pageId,
      richTitle: [],
      preview: "",
      plainText: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    membership: {
      membershipId: `membership:${pageId}`,
      dataSourceId: dataSource.dataSourceId,
      revision: 1,
      createdAt: timestamp,
    },
    values: {
      "property-status": {
        propertyId: "property-status",
        valueType: "select",
        value: status,
        revision,
      },
      "property-priority": {
        propertyId: "property-priority",
        valueType: "select",
        value: priority,
        revision: revision + 10,
      },
    },
    position: { groupKey: status, rankKey, revision: revision + 20 },
    effectiveGroupKey: status,
  });
  const query: DatabaseViewQueryResult = {
    database,
    dataSource,
    view,
    properties,
    rows: [
      row("page-a", input.status ?? "in_progress", "p1-high", "a", 2),
      row("page-b", "in_progress", "p1-high", "b", 3),
      row("page-target", "done", "p2-medium", "c", 4),
    ],
  };
  return {
    version: 1,
    projectId: "project-1",
    libraryId: "library-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 8,
    value: { kind: "query", value: query },
  };
};

describe("Database Page drag compiler", () => {
  test("uses Page coordinates for a same-group manual position", () => {
    const compiled = compileDatabasePageDrag({
      move: {
        pageId: "page-b",
        fromStatus: "in_progress",
        toStatus: "in_progress",
        newOrder: 0,
      },
      snapshot: querySnapshot(),
    });

    expect(compiled).toMatchObject({
      databaseId: "database-1",
      dataSourceId: "source-1",
      viewId: "view-1",
    });
    expect(compiled.operations).toEqual([{
      kind: "position_page",
      viewId: "view-1",
      pageId: "page-b",
      expectedPositionRevision: 23,
      groupKey: "in_progress",
      beforePageId: "page-a",
    }]);
  });

  test("writes Data Source values before the Page View position", () => {
    const compiled = compileDatabasePageDrag({
      move: {
        pageId: "page-a",
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 0,
        fieldPatch: { priority: "p2-medium" },
      },
      snapshot: querySnapshot(),
    });

    expect(compiled.operations.map((operation) => operation.kind)).toEqual([
      "set_values",
      "position_page",
    ]);
    const values = compiled.operations[0];
    if (values?.kind !== "set_values") throw new Error("Missing value run");
    expect(values.values.map((value) => ({
      pageId: value.pageId,
      dataSourceId: value.dataSourceId,
      propertyId: value.propertyId,
    }))).toEqual([
      {
        pageId: "page-a",
        dataSourceId: "source-1",
        propertyId: "property-status",
      },
      {
        pageId: "page-a",
        dataSourceId: "source-1",
        propertyId: "property-priority",
      },
    ]);
  });

  test("keeps a multi-Page run ordered behind one external anchor", () => {
    const compiled = compileDatabasePagesDrag({
      move: {
        pageIds: ["page-b", "page-a"],
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 0,
      },
      snapshot: querySnapshot(),
    });

    const position = compiled.operations.at(-1);
    if (position?.kind !== "position_pages") {
      throw new Error("Missing Page position run");
    }
    expect(position.pages.map((page) => page.pageId)).toEqual([
      "page-b",
      "page-a",
    ]);
    expect(position.beforePageId).toBe("page-target");
  });

  test("rejects a stale source status", () => {
    let code = "";
    try {
      compileDatabasePageDrag({
        move: {
          pageId: "page-a",
          fromStatus: "in_progress",
          toStatus: "done",
        },
        snapshot: querySnapshot({ status: "in_review" }),
      });
    } catch (error) {
      if (error instanceof DatabasePageDragError) code = error.code;
    }
    expect(code).toBe("source_status_conflict");
  });
});
