import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { ReadOnlyDatabaseView } from "./read-only-database-view";

const model: DatabaseViewRenderModel = {
  projectId: "nodex",
  databaseViewId: "database-view:nodex:focused",
  databaseBlockId: "database:nodex:primary",
  databaseName: "Tasks",
  viewName: "Focused work",
  storeEpoch: "story",
  changeLogSeq: 1,
  primaryWriteCompatible: false,
  readOnlyReason: null,
  query: {
    database: {
      blockId: "database:nodex:primary",
      projectId: "nodex",
      name: "Tasks",
      isPrimary: false,
      schemaKey: "nodex.database",
      schemaRevision: 1,
      metadataRevision: 1,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    view: {
      id: "database-view:nodex:focused",
      databaseBlockId: "database:nodex:primary",
      projectId: "nodex",
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
      isPrimary: false,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    properties: [
      {
        id: "property-status",
        databaseBlockId: "database:nodex:primary",
        key: "status",
        name: "Status",
        valueType: "select",
        config: { options: [{ id: "in_progress", name: "In Progress" }, { id: "done", name: "Done" }] },
        rankKey: "a",
        lifecycle: "active",
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      {
        id: "property-tags",
        databaseBlockId: "database:nodex:primary",
        key: "tags",
        name: "Tags",
        valueType: "multi_select",
        config: { options: [{ id: "block-first", name: "Block first" }] },
        rankKey: "b",
        lifecycle: "active",
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    ],
    rows: [{
      membership: {
        id: "membership-1",
        databaseBlockId: "database:nodex:primary",
        cardBlockId: "card-1",
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      card: {
        blockId: "card-1",
        projectId: "nodex",
        lifecycle: "active",
        location: { kind: "space", rankKey: "a" },
        locationRevision: 1,
        metadataRevision: 1,
        documentId: "document-1",
        documentGeneration: 1,
        documentHeadSeq: 1,
        documentAuthority: "ydoc_primary",
        content: {
          projectedSeq: 1,
          title: "Unify Database View rendering",
          preview: "",
          plainText: "",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      values: {
        "property-status": { propertyId: "property-status", valueType: "select", value: "in_progress", revision: 1 },
        "property-tags": { propertyId: "property-tags", valueType: "multi_select", value: ["block-first"], revision: 1 },
      },
      position: { groupKey: "in_progress", rankKey: "a", revision: 1 },
      effectiveGroupKey: "in_progress",
    }],
  },
  columns: [
      {
        id: "in_progress",
        name: "In Progress",
        rows: [
          {
            blockId: "card-1",
            status: "in_progress",
            title: "Unify Database View rendering",
            preview: "",
            plainText: "",
            tags: ["block-first"],
            metadataRevision: 1,
            createdAt: new Date("2026-07-12T00:00:00.000Z"),
          },
        ],
      },
      { id: "done", name: "Done", rows: [] },
    ],
};

const meta = {
  title: "Workbench/Durable Database View",
  component: ReadOnlyDatabaseView,
  parameters: { layout: "fullscreen" },
  args: {
    model,
    searchQuery: "",
    openCardStage: () => undefined,
    commitOperations: async () => null,
  },
  decorators: [(Story) => <div className="h-[640px]"><Story /></div>],
} satisfies Meta<typeof ReadOnlyDatabaseView>;

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
