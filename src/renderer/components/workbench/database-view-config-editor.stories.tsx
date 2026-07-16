import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DatabaseViewConfig } from "../../../shared/database-kernel";
import type { DataSourcePropertyRecord } from "../../../shared/database-module";
import { DatabaseViewConfigEditor } from "./database-view-config-editor";

const timestamp = "2026-07-12T00:00:00.000Z";
const properties: readonly DataSourcePropertyRecord[] = [
  {
    propertyId: "property-status",
    dataSourceId: "source-1",
    key: "status",
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
    propertyId: "property-owner",
    dataSourceId: "source-1",
    key: "owner",
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

const initialConfig: DatabaseViewConfig = {
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: {
    kind: "group",
    operator: "and",
    children: [{
      kind: "clause",
      propertyId: "property-status",
      operator: "not_equals",
      value: "todo",
    }],
  },
  sort: [
    { field: { kind: "property", propertyId: "property-status" }, direction: "asc", nulls: "last" },
    { field: { kind: "title" }, direction: "asc", nulls: "last" },
  ],
  group: { propertyId: "property-status" },
  display: { propertyIds: ["property-owner"], showTitle: true },
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
