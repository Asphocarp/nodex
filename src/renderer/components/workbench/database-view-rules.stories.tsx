import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type {
  DatabaseViewConfigV4,
  EffectiveDatabaseViewPresentation,
} from "../../../shared/database-kernel";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { upgradeDatabaseViewConfigV2 } from "../../../shared/database-view-presentation";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { DatabaseViewFilter } from "./database-view-filter";
import { DatabaseViewRulesSummaryRow } from "./database-view-rules-summary-row";
import { DatabaseViewSort } from "./database-view-sort";

const timestamp = "2026-08-12T00:00:00.000Z";
const databaseId = parseDatabaseId("database:rules-story");
const dataSourceId = parseDataSourceId("source:rules-story");
const viewId = parseDatabaseViewId("view:rules-story");
const statusId = parseDataSourcePropertyId("status");
const priorityId = parseDataSourcePropertyId("priority");
const tagsId = parseDataSourcePropertyId("tags");

const property = (propertyId: typeof statusId, name: string): DataSourcePropertyRecordV2 => ({
  propertyId,
  dataSourceId,
  name,
  ...testPropertySemantics("select", 3),
  valueType: "select",
  config: {
    options:
      name === "Status"
        ? ["Triage", "Backlog", "In Progress"].map((label) => ({
            id: label.toLowerCase().replaceAll(" ", "-"),
            name: label,
          }))
        : ["Urgent", "High", "Normal"].map((label) => ({ id: label.toLowerCase(), name: label })),
  },
  rankKey: String(propertyId),
  lifecycle: "active",
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const properties = [
  property(statusId, "Status"),
  property(priorityId, "Priority"),
  {
    ...property(tagsId, "Tags"),
    ...testPropertySemantics("multi_select", 2),
    valueType: "multi_select" as const,
    config: {},
  },
] as const;
const optionRegistries = {
  tags: [
    { id: "o_AAAAAAAA", name: "Product", color: "blue" },
    { id: "o_BBBBBBBB", name: "Polish", color: "gray" },
  ],
} as const;

const config: DatabaseViewConfigV4 = upgradeDatabaseViewConfigV2({
  schemaKey: "nodex.database-view",
  schemaVersion: 2,
  filter: {
    kind: "group",
    operator: "and",
    children: [
      {
        kind: "clause",
        propertyId: statusId,
        operator: "not_equals",
        value: "backlog",
      },
      {
        kind: "clause",
        propertyId: tagsId,
        operator: "contains",
        value: "o_AAAAAAAA",
      },
    ],
  },
  sort: [{ field: { kind: "property", propertyId: priorityId }, direction: "desc", nulls: "last" }],
  group: { propertyId: statusId },
  display: { propertyIds: [priorityId], showTitle: true },
});

const model: DatabaseViewRenderModel = {
  accessContext: { kind: "project", projectId: "project:rules-story" },
  libraryId: "library:rules-story",
  databaseViewId: viewId,
  databaseId,
  dataSourceId,
  databaseName: "Tasks",
  dataSourceName: "Pages",
  viewName: "Focused",
  storeEpoch: "story-epoch",
  commitSeq: 1,
  authorization: null,
  columns: [],
  readOnlyReason: null,
  query: {
    database: {
      databaseId,
      libraryId: "library:rules-story",
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
      libraryId: "library:rules-story",
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
      name: "Focused",
      defaultLayout: "board",
      config,
      isDefault: true,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    properties,
    rows: [],
  },
};

const initialEffective: EffectiveDatabaseViewPresentation = {
  layout: "list",
  presentation: config.presentation,
};

function RulesReference({ panel }: { readonly panel: "filter" | "sort" | "summary" }) {
  const [effective, setEffective] = useState(initialEffective);
  return (
    <div className="min-h-[560px] bg-token-main-surface-primary p-4">
      <div className="ml-auto flex w-fit items-center gap-1">
        {panel === "filter" ? (
          <DatabaseViewFilter
            model={model}
            optionRegistries={optionRegistries}
            open
            onOpenChange={() => undefined}
          />
        ) : null}
        {panel === "sort" ? (
          <DatabaseViewSort
            effective={effective}
            properties={properties}
            open
            onOpenChange={() => undefined}
            onChange={setEffective}
          />
        ) : null}
      </div>
      {panel === "summary" ? (
        <div className="mt-10 border-y-[0.5px] border-token-border/60">
          <DatabaseViewRulesSummaryRow
            filter={config.filter}
            effective={effective}
            properties={properties}
            optionRegistries={optionRegistries}
            onOpenFilter={() => undefined}
            onOpenSort={() => undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Workbench/Database View Rules",
  component: RulesReference,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RulesReference>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FilterOpen: Story = { args: { panel: "filter" } };
export const SortOpen: Story = { args: { panel: "sort" } };
export const SummaryRow: Story = { args: { panel: "summary" } };
