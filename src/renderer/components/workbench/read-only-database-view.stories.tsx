import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { DatabaseViewSurface } from "./read-only-database-view";

const timestamp = "2026-07-12T00:00:00.000Z";
const libraryId = "library:nodex";
const databaseId = "database:nodex:primary";
const dataSourceId = "data-source:nodex:primary";
const viewId = "database-view:nodex:focused";

const model: DatabaseViewRenderModel = {
  projectId: "nodex",
  databaseViewId: viewId,
  databaseId,
  dataSourceId,
  databaseName: "Tasks",
  dataSourceName: "Pages",
  viewName: "Focused work",
  storeEpoch: "story",
  changeLogSeq: 1,
  primaryWriteCompatible: false,
  readOnlyReason: null,
  query: {
    database: {
      databaseId,
      libraryId,
      name: "Tasks",
      lifecycle: "active",
      defaultViewId: "database-view:nodex:default",
      accessRevision: 1,
      metadataRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    dataSource: {
      dataSourceId,
      libraryId,
      homeDatabaseId: databaseId,
      name: "Pages",
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
      name: "Focused work",
      kind: "kanban",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
        group: { propertyId: "property-status" },
        display: { propertyIds: ["property-tags"], showTitle: true },
      },
      isDefault: false,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    properties: [
      {
        propertyId: "property-status",
        dataSourceId,
        key: "status",
        name: "Status",
        valueType: "select",
        config: { options: [{ id: "in_progress", name: "In Progress" }, { id: "done", name: "Done" }] },
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
        config: { options: [{ id: "page-first", name: "Page first" }] },
        rankKey: "b",
        lifecycle: "active",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    rows: [{
      membership: {
        membershipId: "membership-1",
        dataSourceId,
        revision: 1,
        createdAt: timestamp,
      },
      page: {
        pageId: "page-1",
        libraryId,
        parent: { kind: "data_source", dataSourceId },
        lifecycle: "active",
        parentRevision: 1,
        metadataRevision: 1,
        documentId: "document-1",
        documentGeneration: 1,
        documentHeadSeq: 1,
        title: "Unify Database View rendering",
        richTitle: plainTextToPortableRichText("Unify Database View rendering"),
        preview: "",
        plainText: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      values: {
        "property-status": { propertyId: "property-status", valueType: "select", value: "in_progress", revision: 1 },
        "property-tags": { propertyId: "property-tags", valueType: "multi_select", value: ["page-first"], revision: 1 },
      },
      position: { groupKey: "in_progress", rankKey: "a", revision: 1 },
      effectiveGroupKey: "in_progress",
    }],
  },
  columns: [
    {
      id: "in_progress",
      name: "In Progress",
      rows: [{
        pageId: "page-1",
        status: "in_progress",
        title: "Unify Database View rendering",
        preview: "",
        plainText: "",
        tags: ["page-first"],
        metadataRevision: 1,
        createdAt: new Date(timestamp),
      }],
    },
    { id: "done", name: "Done", rows: [] },
  ],
};

const meta = {
  title: "Workbench/Database View",
  component: DatabaseViewSurface,
  parameters: { layout: "fullscreen" },
  args: {
    model,
    searchQuery: "",
    openPageStage: () => undefined,
    commitOperations: async () => null,
  },
  decorators: [(Story) => <div className="h-[640px]"><Story /></div>],
} satisfies Meta<typeof DatabaseViewSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SecondaryView: Story = {};

const withKind = (
  kind: "list" | "calendar" | "canvas",
): DatabaseViewRenderModel => ({
  ...model,
  query: {
    ...model.query,
    view: {
      ...model.query.view,
      kind,
      config: { ...model.query.view.config, group: null },
    },
  },
  columns: [{
    id: "all",
    name: "Focused work",
    rows: model.columns.flatMap((column) => column.rows),
  }],
});

export const ListView: Story = { args: { model: withKind("list") } };
export const CalendarAgenda: Story = { args: { model: withKind("calendar") } };
export const OrderedCanvas: Story = { args: { model: withKind("canvas") } };
