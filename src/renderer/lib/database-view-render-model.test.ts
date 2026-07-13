import { describe, expect, test } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import type {
  DatabaseReadSnapshot,
  DatabaseViewSnapshot,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import { buildDatabaseViewRenderModel } from "./database-view-render-model";

const projectId = "project-alpha";
const databaseBlockId = "database-alpha";
const viewId = "view-alpha";
const statusPropertyId = "property-status";
const tagsPropertyId = "property-tags";

const wrap = <T>(value: T): DatabaseReadSnapshot<T> => ({
  version: 1,
  projectId,
  storeEpoch: "epoch-alpha",
  changeLogSeq: 7,
  value,
});

const makeSnapshot = (input: {
  readonly primary?: boolean;
  readonly groupedByStatus?: boolean;
  readonly viewId?: string;
  readonly title?: string;
} = {}): DatabaseViewSnapshot => {
  const resolvedViewId = input.viewId ?? viewId;
  const view = {
    id: resolvedViewId,
    databaseBlockId,
    projectId,
    name: input.primary === false ? "Focused work" : "Primary board",
    kind: "kanban" as const,
    config: {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 1 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: [{
        field: { kind: "manual" as const },
        direction: "asc" as const,
        nulls: "last" as const,
      }],
      group: input.groupedByStatus === false
        ? null
        : { propertyId: statusPropertyId },
      display: { propertyIds: [statusPropertyId, tagsPropertyId], showTitle: true },
    },
    isPrimary: input.primary !== false,
    revision: 3,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const properties = [
    {
      id: statusPropertyId,
      databaseBlockId,
      key: "status",
      name: "Status",
      valueType: "select" as const,
      config: {},
      rankKey: "a",
      lifecycle: "active" as const,
      revision: 1,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    {
      id: tagsPropertyId,
      databaseBlockId,
      key: "tags",
      name: "Tags",
      valueType: "multi_select" as const,
      config: {},
      rankKey: "b",
      lifecycle: "active" as const,
      revision: 1,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
  ];
  const database = {
    blockId: databaseBlockId,
    projectId,
    name: "Tasks",
    isPrimary: true,
    schemaKey: "nodex.database",
    schemaRevision: 4,
    metadataRevision: 2,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const descriptor: GeneralDatabaseDescriptor = {
    database,
    properties,
    views: [view],
  };
  const query: GeneralDatabaseViewQuery = {
    database,
    properties,
    view,
    rows: [{
      membership: {
        id: "membership-1",
        databaseBlockId,
        cardBlockId: "card-1",
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      card: {
        blockId: "card-1",
        projectId,
        lifecycle: "active",
        location: { kind: "space", rankKey: "a" },
        locationRevision: 1,
        metadataRevision: 9,
        documentId: "document-1",
        documentGeneration: 1,
        documentHeadSeq: 5,
        documentAuthority: "ydoc_primary",
        content: {
          projectedSeq: 5,
          title: input.title ?? "Canonical Card",
          richTitle: plainTextToPortableRichText(input.title ?? "Canonical Card"),
          preview: "One line",
          plainText: "One line body",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      values: {
        [statusPropertyId]: {
          propertyId: statusPropertyId,
          valueType: "select",
          value: "in_progress",
          revision: 2,
        },
        [tagsPropertyId]: {
          propertyId: tagsPropertyId,
          valueType: "multi_select",
          value: ["sync", "block-first"],
          revision: 1,
        },
      },
      position: { groupKey: "in_progress", rankKey: "a", revision: 2 },
      effectiveGroupKey: input.groupedByStatus === false ? null : "in_progress",
    }],
  };
  return { descriptor: wrap(descriptor), query: wrap(query) };
};

describe("Database View render model", () => {
  test("projects one selected durable View query into the primary Board surface", () => {
    const model = buildDatabaseViewRenderModel(makeSnapshot());
    expect(model.databaseViewId).toBe(viewId);
    expect(model.primaryWriteCompatible).toBe(true);
    expect(model.columns[2]?.rows[0]?.title).toBe("Canonical Card");
    expect(model.columns[2]?.rows[0]?.tags.join(",")).toBe(
      "sync,block-first",
    );
  });

  test("keeps secondary View identity and rows while failing writes closed", () => {
    const model = buildDatabaseViewRenderModel(makeSnapshot({
      primary: false,
      viewId: "view-focused",
      title: "Only in focused view",
    }));
    expect(model.databaseViewId).toBe("view-focused");
    expect(model.primaryWriteCompatible).toBe(false);
    expect(model.readOnlyReason?.includes("selected View identity") ?? false).toBe(true);
    expect(model.columns[2]?.rows[0]?.title).toBe(
      "Only in focused view",
    );
  });

  test("preserves ordered rows for a non-status grouped read-only View", () => {
    const model = buildDatabaseViewRenderModel(makeSnapshot({
      primary: false,
      groupedByStatus: false,
    }));
    expect(model.primaryWriteCompatible).toBe(false);
    expect(model.columns.length).toBe(1);
    expect(model.columns[0]?.rows[0]?.blockId).toBe("card-1");
  });

  test("builds generic Board columns from stable select option identities", () => {
    const snapshot = makeSnapshot({ primary: false });
    const descriptor = snapshot.descriptor.value;
    const query = snapshot.query.value;
    if (!descriptor || !query) throw new Error("Missing Database View fixture");
    const workflowProperty = {
      ...query.properties[0]!,
      key: "workflow",
      name: "Workflow",
      config: { options: [{ id: "in_progress", name: "Doing" }] },
    };
    const properties = [workflowProperty, ...query.properties.slice(1)];
    const model = buildDatabaseViewRenderModel({
      descriptor: {
        ...snapshot.descriptor,
        value: { ...descriptor, properties },
      },
      query: {
        ...snapshot.query,
        value: { ...query, properties },
      },
    });
    expect(model.primaryWriteCompatible).toBe(false);
    expect(model.columns[0]?.id).toBe("in_progress");
    expect(model.columns[0]?.name).toBe("Doing");
    expect(model.columns[0]?.rows[0]?.blockId).toBe("card-1");
  });

  test("does not route a filtered primary View through the unfiltered Board adapter", () => {
    const snapshot = makeSnapshot();
    const descriptor = snapshot.descriptor.value;
    const query = snapshot.query.value;
    if (!descriptor || !query) throw new Error("Missing Database View fixture");
    const filteredView = {
      ...query.view,
      config: {
        ...query.view.config,
        filter: {
          kind: "clause" as const,
          propertyId: statusPropertyId,
          operator: "equals" as const,
          value: "in_progress",
        },
      },
    };
    const model = buildDatabaseViewRenderModel({
      descriptor: {
        ...snapshot.descriptor,
        value: { ...descriptor, views: [filteredView] },
      },
      query: {
        ...snapshot.query,
        value: { ...query, view: filteredView },
      },
    });
    expect(model.primaryWriteCompatible).toBe(false);
  });

  test("rejects descriptor and query snapshots from different cursors", () => {
    const snapshot = makeSnapshot();
    const mismatched: DatabaseViewSnapshot = {
      ...snapshot,
      query: { ...snapshot.query, changeLogSeq: 8 },
    };
    let message = "";
    try {
      buildDatabaseViewRenderModel(mismatched);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message.includes("one authority cursor")).toBe(true);
  });
});
