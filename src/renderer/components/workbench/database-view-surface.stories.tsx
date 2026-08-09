import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { DatabaseViewSurface } from "./database-view-surface";
import { DatabaseViewTabSurface } from "./workbench-db-view-panel";

const timestamp = "2026-07-12T00:00:00.000Z";
const libraryId = "library:nodex";
const databaseId = parseDatabaseId("database:nodex:primary");
const dataSourceId = parseDataSourceId("data-source:nodex:primary");
const viewId = parseDatabaseViewId("database-view:nodex:focused");
const statusPropertyId = parseDataSourcePropertyId("status");
const tagsPropertyId = parseDataSourcePropertyId("tags");

const model: DatabaseViewRenderModel = {
  libraryId,
  accessContext: { kind: "project", projectId: "nodex" },
  databaseViewId: viewId,
  databaseId,
  dataSourceId,
  databaseName: "Tasks",
  dataSourceName: "Pages",
  viewName: "Focused work",
  storeEpoch: "story",
  commitSeq: 1,
  authorization: null,
  primaryWriteCompatible: false,
  readOnlyReason: null,
  query: {
    database: {
      databaseId,
      libraryId,
      name: "Tasks",
      lifecycle: "active",
      defaultViewId: parseDatabaseViewId("database-view:nodex:default"),
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
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
        group: { propertyId: statusPropertyId },
        display: { propertyIds: [tagsPropertyId], showTitle: true },
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
        propertyId: statusPropertyId,
        dataSourceId,
        name: "Status",
        ...testPropertySemantics("select", 2),
        valueType: "select",
        config: { options: [{ id: "build", name: "Build" }, { id: "ship", name: "Ship" }] },
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
        ...testPropertySemantics("multi_select", 1),
        valueType: "multi_select",
        config: { options: [{ id: "o_AAAAAAAA", name: "Page first" }] },
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
        [statusPropertyId]: { propertyId: statusPropertyId, valueType: "select", value: "build", revision: 1 },
        [tagsPropertyId]: { propertyId: tagsPropertyId, valueType: "multi_select", value: ["o_AAAAAAAA"], revision: 1 },
      },
      position: { groupKey: "build", rankKey: "a", revision: 1 },
      effectiveGroupKey: "build",
    }],
  },
  columns: [
    {
      id: "build",
      scopeKey: "key:build",
      name: "Build",
      rows: [{
        pageId: "page-1",
        status: "build",
        title: "Unify Database View rendering",
        preview: "",
        plainText: "",
        tags: ["page-first"],
        metadataRevision: 1,
        createdAt: new Date(timestamp),
      }],
    },
    { id: "ship", name: "Ship", scopeKey: "key:ship", rows: [] },
  ],
};

const meta = {
  title: "Workbench/Database View",
  component: DatabaseViewSurface,
  parameters: { layout: "fullscreen" },
  args: {
    model,
    searchQuery: "",
    onOpenPage: () => undefined,
    commitOperations: async () => null,
  },
  decorators: [(Story) => <div className="h-[640px]"><Story /></div>],
} satisfies Meta<typeof DatabaseViewSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SecondaryView: Story = {};

const withKind = (
  kind: "list" | "calendar",
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
    scopeKey: "all",
    name: "Focused work",
    rows: model.columns.flatMap((column) => column.rows),
  }],
});

export const ListView: Story = { args: { model: withKind("list") } };
export const CalendarAgenda: Story = { args: { model: withKind("calendar") } };

function FullDatabaseViewTab({
  viewModel,
}: {
  readonly viewModel: DatabaseViewRenderModel;
}) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  return (
    <DatabaseViewTabSurface
      model={viewModel}
      activeSearchQuery={query}
      taskSearchOpen={searchOpen}
      searchShortcutLabel="Ctrl+F"
      taskSearchInputRef={searchInputRef}
      onSearchQueryChange={setQuery}
      onOpenTaskSearch={() => setSearchOpen(true)}
      onCloseTaskSearch={() => setSearchOpen(false)}
      onOpenPage={() => undefined}
    />
  );
}

export const FullTabSurface: Story = {
  render: (args) => <FullDatabaseViewTab viewModel={args.model} />,
};
