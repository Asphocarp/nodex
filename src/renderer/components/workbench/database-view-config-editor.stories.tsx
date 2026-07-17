import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DatabaseViewConfigV2 } from "../../../shared/database-kernel";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { DatabaseViewConfigEditor } from "./database-view-config-editor";

const timestamp = "2026-07-12T00:00:00.000Z";
const properties: readonly DataSourcePropertyRecordV2[] = [
  {
    propertyId: parseDataSourcePropertyId("status"),
    dataSourceId: parseDataSourceId("source-1"),
    name: "Status",
    valueType: "select",
    config: { options: [{ id: "todo", name: "Todo" }, { id: "doing", name: "Doing" }] },
    rankKey: "a",
    lifecycle: "active",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    propertyId: parseDataSourcePropertyId("assignee"),
    dataSourceId: parseDataSourceId("source-1"),
    name: "Owner",
    valueType: "person",
    config: {},
    rankKey: "b",
    lifecycle: "active",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

const initialConfig: DatabaseViewConfigV2 = {
  schemaKey: "nodex.database-view",
  schemaVersion: 2,
  filter: {
    kind: "group",
    operator: "and",
    children: [{
      kind: "clause",
      propertyId: "status",
      operator: "not_equals",
      value: "todo",
    }],
  },
  sort: [
    { field: { kind: "property", propertyId: "status" }, direction: "asc", nulls: "last" },
    { field: { kind: "title" }, direction: "asc", nulls: "last" },
  ],
  group: { propertyId: "status" },
  display: { propertyIds: ["assignee"], showTitle: true },
};

function InteractiveEditor() {
  const [config, setConfig] = useState(initialConfig);
  return (
    <div className="mx-auto mt-8 max-w-3xl rounded-xl bg-token-main-surface-primary p-3 shadow-lg ring-[0.5px] ring-token-border">
      <DatabaseViewConfigEditor
        config={config}
        properties={properties}
        onChange={setConfig}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Database View config editor",
  component: InteractiveEditor,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof InteractiveEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DurableRules: Story = {};
