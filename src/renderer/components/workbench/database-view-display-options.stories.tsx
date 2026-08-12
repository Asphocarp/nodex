import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type { EffectiveDatabaseViewPresentation } from "../../../shared/database-kernel";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { DatabaseViewDisplayOptions } from "./database-view-display-options";

const timestamp = "2026-08-11T00:00:00.000Z";
const dataSourceId = parseDataSourceId("source:display-options");

const property = (
  propertyId: string,
  name: string,
  valueType: DataSourcePropertyRecordV2["valueType"],
): DataSourcePropertyRecordV2 => ({
  propertyId: parseDataSourcePropertyId(propertyId),
  dataSourceId,
  name,
  ...testPropertySemantics(valueType, valueType === "select" ? 4 : 0),
  valueType,
  config: valueType === "select"
    ? { options: ["Triage", "Plan", "Build", "Ship"].map((option) => ({ id: option.toLowerCase(), name: option })) }
    : {},
  rankKey: propertyId,
  lifecycle: "active",
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const properties = [
  property("status", "Status", "select"),
  property("priority", "Priority", "select"),
  property("estimate", "Estimate", "number"),
  property("assignee", "Assignee", "text"),
] as const;

const durable: EffectiveDatabaseViewPresentation = {
  layout: "board",
  presentation: {
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
    group: { propertyId: "status" },
    subgroup: null,
    groupDirection: "asc",
    completion: { range: "all", orderByRecency: false },
    hierarchy: { showSubPages: true, nestedSubPages: false },
    layouts: {
      board: {
        fields: [{ kind: "property", propertyId: "priority" }],
        showEmptyGroups: false,
      },
      list: {
        fields: [
          { kind: "intrinsic", field: "page_id" },
          { kind: "property", propertyId: "status" },
          { kind: "property", propertyId: "priority" },
          { kind: "property", propertyId: "assignee" },
        ],
        showEmptyGroups: false,
      },
    },
  },
};

function InteractiveDisplayOptions({
  initialLayout = "list",
  error = null,
}: {
  readonly initialLayout?: EffectiveDatabaseViewPresentation["layout"];
  readonly error?: string | null;
}) {
  const [effective, setEffective] = useState<EffectiveDatabaseViewPresentation>({
    ...durable,
    layout: initialLayout,
  });
  const [open, setOpen] = useState(true);
  return (
    <div className="flex h-[720px] items-start justify-end bg-token-main-surface-primary p-4">
      <DatabaseViewDisplayOptions
        durable={durable}
        effective={effective}
        properties={properties}
        error={error}
        open={open}
        onOpenChange={setOpen}
        onChange={setEffective}
        onReset={() => setEffective(durable)}
        onPublish={() => undefined}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Database View Display Options",
  component: InteractiveDisplayOptions,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof InteractiveDisplayOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PersonalListOverride: Story = {};

export const BoardDefaults: Story = {
  render: () => <InteractiveDisplayOptions initialLayout="board" />,
};

export const SaveFailure: Story = {
  render: () => (
    <InteractiveDisplayOptions error="Couldn’t save your display preferences." />
  ),
};
