import { describe, expect, test } from "vitest";

import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import type {
  DatabaseViewQueryResultV2,
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../shared/database-module-v2";
import {
  DatabasePageProjectionError,
  projectBoardSummary,
  projectDatabasePage,
  projectDatabaseViewReference,
} from "./database-page-projection";

const dataSourceId = parseDataSourceId("source:test");
const databaseId = parseDatabaseId("database:test");
const viewId = parseDatabaseViewId("view:test");

const property = (
  propertyId: string,
  valueType: DataSourcePropertyRecordV2["valueType"],
  config: DataSourcePropertyRecordV2["config"] = {},
): DataSourcePropertyRecordV2 => ({
  propertyId: parseDataSourcePropertyId(propertyId),
  dataSourceId,
  name: propertyId,
  valueType,
  config,
  rankKey: propertyId,
  lifecycle: "active",
  revision: 1,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
});

const properties: readonly DataSourcePropertyRecordV2[] = [
  property("status", "select", {
    options: [
      { id: "triage", name: "Triage" },
      { id: "build", name: "Build" },
    ],
  }),
  property("priority", "select", {
    options: [{ id: "p1-high", name: "P1 - High" }],
  }),
  property("estimate", "select", {
    options: [{ id: "m", name: "M" }],
  }),
  property("tags", "multi_select", {
    options: [{ id: "tag:api", name: "API" }],
  }),
  property("due_date", "date"),
  property("scheduled_start", "datetime"),
  property("scheduled_end", "datetime"),
  property("assignee", "person"),
];

const databaseValue = (
  propertyId: string,
  valueType: DataSourcePageRowV2["values"][string]["valueType"],
  value: DataSourcePageRowV2["values"][string]["value"],
) => ({
  propertyId: parseDataSourcePropertyId(propertyId),
  valueType,
  value,
  revision: 1,
});

const makeRow = (
  pageId: string,
  status: "triage" | "build" = "build",
): DataSourcePageRowV2 => ({
  page: {
    pageId,
    libraryId: "library:test",
    parent: { kind: "data_source", dataSourceId },
    lifecycle: "active",
    parentRevision: 2,
    metadataRevision: 7,
    documentId: `document:${pageId}`,
    documentGeneration: 1,
    documentHeadSeq: 4,
    title: `Title ${pageId}`,
    richTitle: plainTextToPortableRichText(`Title ${pageId}`),
    preview: "Projection preview",
    plainText: "Projection plain text",
    createdAt: "2026-07-20T01:00:00.000Z",
    updatedAt: "2026-07-20T02:00:00.000Z",
  },
  membership: {
    membershipId: `membership:${pageId}`,
    dataSourceId,
    revision: 1,
    createdAt: "2026-07-20T00:30:00.000Z",
  },
  values: {
    status: databaseValue("status", "select", status),
    priority: databaseValue("priority", "select", "p1-high"),
    estimate: databaseValue("estimate", "select", "m"),
    tags: databaseValue("tags", "multi_select", ["tag:legacy", "tag:api"]),
    due_date: databaseValue("due_date", "date", "2026-07-25"),
    scheduled_start: databaseValue(
      "scheduled_start",
      "datetime",
      "2026-07-25T08:00:00.000Z",
    ),
    scheduled_end: databaseValue(
      "scheduled_end",
      "datetime",
      "2026-07-25T09:00:00.000Z",
    ),
    assignee: databaseValue("assignee", "person", "Ada"),
  },
  bodyNfm: "# Detail\n\nA body with **structure**.",
  intrinsicProperties: [
    { key: "run.target", valueType: "string", value: "newWorktree", revision: 1 },
    { key: "run.localPath", valueType: "string", value: "/repo/nodex", revision: 1 },
    { key: "run.baseBranch", valueType: "string", value: "main", revision: 1 },
    { key: "run.worktreePath", valueType: "string", value: null, revision: 1 },
    { key: "run.environmentPath", valueType: "string", value: null, revision: 1 },
    { key: "schedule.isAllDay", valueType: "boolean", value: false, revision: 1 },
    { key: "schedule.timezone", valueType: "string", value: "UTC", revision: 1 },
    {
      key: "recurrence.config",
      valueType: "json",
      value: { frequency: "weekly", interval: 1, byWeekdays: [1, 3] },
      revision: 1,
    },
    {
      key: "reminders.config",
      valueType: "json",
      value: [{ offsetMinutes: 30 }],
      revision: 1,
    },
  ],
  position: {
    groupKey: status,
    rankKey: `rank:${pageId}`,
    revision: 1,
  },
  effectiveGroupKey: status,
});

const makeQuery = (
  rows: readonly DataSourcePageRowV2[],
): DatabaseViewQueryResultV2 => ({
  database: {
    databaseId,
    libraryId: "library:test",
    name: "Tasks",
    lifecycle: "active",
    defaultViewId: viewId,
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  },
  dataSource: {
    dataSourceId,
    libraryId: "library:test",
    homeDatabaseId: databaseId,
    name: "Tasks",
    schemaKey: "nodex.database",
    schemaRevision: 1,
    lifecycle: "active",
    rankKey: "rank:source",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  },
  view: {
    viewId,
    databaseId,
    dataSourceId,
    name: "Kanban",
    kind: "kanban",
    config: {
      schemaKey: "nodex.database-view",
      schemaVersion: 2,
      filter: { kind: "group", operator: "and", children: [] },
      sort: [{
        field: { kind: "manual" },
        direction: "asc",
        nulls: "last",
      }],
      group: { propertyId: "status" },
      display: { propertyIds: ["status"], showTitle: true },
    },
    isDefault: true,
    revision: 1,
    rankKey: "rank:view",
    lifecycle: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  },
  properties,
  rows,
});

describe("native Database Page projections", () => {
  test("builds the complete compatibility Page from one native query row", () => {
    const page = projectDatabasePage(makeRow("page:one"), properties, 3);

    expect(page).toMatchObject({
      id: "page:one",
      status: "build",
      title: "Title page:one",
      description: "# Detail\n\nA body with **structure**.",
      priority: "p1-high",
      estimate: "m",
      tags: ["API", "tag:legacy"],
      isAllDay: false,
      recurrence: { frequency: "weekly", interval: 1, byWeekdays: [1, 3] },
      reminders: [{ offsetMinutes: 30 }],
      scheduleTimezone: "UTC",
      assignee: "Ada",
      runInTarget: "newWorktree",
      runInLocalPath: "/repo/nodex",
      runInBaseBranch: "main",
      revision: 7,
      order: 3,
    });
    expect(page.dueDate?.toISOString()).toBe("2026-07-25T00:00:00.000Z");
    expect(page.scheduledStart?.toISOString()).toBe("2026-07-25T08:00:00.000Z");
    expect(page.created.toISOString()).toBe("2026-07-20T01:00:00.000Z");
  });

  test("fails closed when native exact-head or intrinsic evidence is absent", () => {
    const row = makeRow("page:missing");
    const withoutBody = { ...row, bodyNfm: undefined };
    const withoutIntrinsic = { ...row, intrinsicProperties: undefined };

    expect(() => projectDatabasePage(withoutBody, properties)).toThrowError(
      DatabasePageProjectionError,
    );
    expect(() => projectDatabasePage(withoutIntrinsic, properties)).toThrow(
      "missing intrinsic Property evidence",
    );
  });

  test("rejects relational metadata that violates Page scheduling contracts", () => {
    const row = makeRow("page:invalid");
    const intrinsicProperties = row.intrinsicProperties?.map((propertyValue) =>
      propertyValue.key === "recurrence.config"
        ? {
            ...propertyValue,
            value: { frequency: "weekly", interval: 1 },
          }
        : propertyValue
    );

    expect(() => projectDatabasePage({ ...row, intrinsicProperties }, properties))
      .toThrow("invalid relational metadata");
  });

  test("builds canonical Board columns and stable per-column row order", () => {
    const board = projectBoardSummary(makeQuery([
      makeRow("page:build-a"),
      makeRow("page:triage", "triage"),
      makeRow("page:build-b"),
    ]));

    expect(board.columns.map((column) => column.id)).toEqual([
      "triage",
      "plan",
      "build",
      "review",
      "ship",
    ]);
    expect(board.columns.find((column) => column.id === "build")?.cards.map(
      (card) => [card.id, card.order],
    )).toEqual([
      ["page:build-a", 0],
      ["page:build-b", 1],
    ]);
    expect(board.columns.find((column) => column.id === "triage")?.cards[0])
      .toMatchObject({
        id: "page:triage",
        order: 0,
        hasDescription: true,
      });
  });

  test("projects View identity and excludes an inline host without another read", () => {
    const model = projectDatabaseViewReference(
      makeQuery([makeRow("page:host"), makeRow("page:visible")]),
      {
        requestingProjectId: "project:reader",
        databaseViewId: viewId,
        hostBlockId: "page:host",
      },
    );

    expect(model.view).toMatchObject({
      id: viewId,
      databaseBlockId: databaseId,
      projectId: "project:reader",
      isPrimary: true,
    });
    expect(model.rows.map((row) => row.page.id)).toEqual(["page:visible"]);
    expect(model.rows[0]?.rankKey).toBe("rank:page:visible");
  });
});
