import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { GeneralDatabaseViewConfig } from "../../../shared/database-kernel";
import type { GeneralDatabasePropertyDefinition } from "../../../shared/database-query";
import { DatabaseViewConfigEditor } from "./database-view-config-editor";

const timestamp = "2026-07-12T00:00:00.000Z";
const properties: readonly GeneralDatabasePropertyDefinition[] = [
  {
    id: "property-status",
    databaseBlockId: "database-1",
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
    id: "property-owner",
    databaseBlockId: "database-1",
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

const initialConfig: GeneralDatabaseViewConfig = {
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

