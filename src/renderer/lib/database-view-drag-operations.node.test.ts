import { describe, expect, test } from "vitest";
import type { DatabaseViewRenderModel } from "./database-view-render-model";
import { buildDatabaseViewBoardDropOperations } from "./database-view-drag-operations";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import { testPropertySemantics } from "../../shared/testing/database-property-record";

const timestamp = "2026-08-11T00:00:00.000Z";
const databaseId = parseDatabaseId("database-1");
const dataSourceId = parseDataSourceId("source-1");
const viewId = parseDatabaseViewId("view-1");
const statusId = parseDataSourcePropertyId("p_STATUS01");
const priorityId = parseDataSourcePropertyId("p_PRIOR001");

const row = (pageId: string, status: string, priority: string, rankKey: string) => ({
  membership: {
    membershipId: `membership-${pageId}`,
    dataSourceId,
    revision: 1,
    createdAt: timestamp,
  },
  page: {
    pageId,
    libraryId: "library-1",
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
  values: {
    [statusId]: { propertyId: statusId, valueType: "select" as const, value: status, revision: 2 },
    [priorityId]: { propertyId: priorityId, valueType: "select" as const, value: priority, revision: 3 },
  },
  position: { rankKey, revision: 4 },
  effectiveGroupKey: status,
  effectiveSubgroupKey: priority,
});

const model: DatabaseViewRenderModel = {
  accessContext: { kind: "project", projectId: "project-1" },
  libraryId: "library-1",
  databaseViewId: viewId,
  databaseId,
  dataSourceId,
  databaseName: "Tasks",
  dataSourceName: "Tasks",
  viewName: "Work",
  storeEpoch: "epoch-1",
  commitSeq: 1,
  authorization: null,
  readOnlyReason: null,
  columns: [],
  query: {
    database: {
      databaseId,
      libraryId: "library-1",
      name: "Tasks",
      lifecycle: "active",
      defaultViewId: viewId,
      accessRevision: 1,
      metadataRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    dataSource: {
      dataSourceId,
      libraryId: "library-1",
      homeDatabaseId: databaseId,
      name: "Tasks",
      schemaKey: "nodex.pages",
      schemaRevision: 1,
      lifecycle: "active",
      rankKey: "a",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    view: {
      viewId,
      databaseId,
      dataSourceId,
      name: "Work",
      defaultLayout: "board",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 4,
        filter: { kind: "group", operator: "and", children: [] },
        presentation: {
          sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
          group: { propertyId: statusId },
          subgroup: { propertyId: priorityId },
          groupDirection: "asc",
          completion: { range: "all", orderByRecency: false },
          hierarchy: { showSubPages: true, nestedSubPages: false },
          layouts: {
            board: { fields: [], showEmptyGroups: true },
            list: { fields: [], showEmptyGroups: true },
          },
        },
      },
      isDefault: true,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    properties: [
      {
        propertyId: statusId,
        dataSourceId,
        name: "Status",
        ...testPropertySemantics("select", 1),
        valueType: "select",
        config: { options: [{ id: "o_DOING001", name: "Doing" }, { id: "o_DONE0001", name: "Done" }] },
        rankKey: "a",
        lifecycle: "active",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        propertyId: priorityId,
        dataSourceId,
        name: "Priority",
        ...testPropertySemantics("select", 1),
        valueType: "select",
        config: { options: [{ id: "o_HIGH0001", name: "High" }, { id: "o_LOW00001", name: "Low" }] },
        rankKey: "b",
        lifecycle: "active",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    rows: [
      row("page-1", "o_DOING001", "o_HIGH0001", "a"),
      row("page-2", "o_DONE0001", "o_LOW00001", "b"),
      row("page-3", "o_DONE0001", "o_LOW00001", "c"),
    ],
  },
};

describe("buildDatabaseViewBoardDropOperations", () => {
  test("moves group, subgroup, and global manual rank in one operation list", () => {
    expect(buildDatabaseViewBoardDropOperations({
      model,
      pageIds: ["page-1"],
      target: {
        groupKey: "o_DONE0001",
        subgroupKey: "o_LOW00001",
        beforePageId: "page-3",
      },
    })).toEqual([
      {
        kind: "edit_property_values",
        edits: [
          {
            pageId: "page-1",
            dataSourceId,
            propertyId: statusId,
            edit: {
              kind: "replace",
              expectedValueRevision: 2,
              value: { kind: "select", optionId: "o_DONE0001" },
            },
          },
          {
            pageId: "page-1",
            dataSourceId,
            propertyId: priorityId,
            edit: {
              kind: "replace",
              expectedValueRevision: 3,
              value: { kind: "select", optionId: "o_LOW00001" },
            },
          },
        ],
      },
      {
        kind: "position_pages",
        viewId,
        pages: [{ pageId: "page-1", expectedPositionRevision: 4 }],
        beforePageId: "page-3",
      },
    ]);
  });

  test("rejects a self anchor without emitting a partial property write", () => {
    expect(buildDatabaseViewBoardDropOperations({
      model,
      pageIds: ["page-1", "page-2"],
      target: {
        groupKey: "o_DONE0001",
        subgroupKey: "o_LOW00001",
        beforePageId: "page-2",
      },
    })).toEqual([]);
  });

  test("reorders inside one Board cell without rewriting grouping values", () => {
    expect(buildDatabaseViewBoardDropOperations({
      model,
      pageIds: ["page-2"],
      target: {
        groupKey: "o_DONE0001",
        subgroupKey: "o_LOW00001",
        beforePageId: "page-3",
      },
    })).toEqual([{
      kind: "position_pages",
      viewId,
      pages: [{ pageId: "page-2", expectedPositionRevision: 4 }],
      beforePageId: "page-3",
    }]);
  });
});
