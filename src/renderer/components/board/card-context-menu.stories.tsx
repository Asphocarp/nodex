import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { CardContextMenu } from "./card-context-menu";
import type { DataSourcePropertyEditorBinding } from "@/components/database/data-source-property-editor-binding";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";

const statusProperty = {
  propertyId: parseDataSourcePropertyId("status"),
  dataSourceId: parseDataSourceId("source-story"),
  name: "Status",
  schema: { kind: "select" },
  capabilities: {
    filterOperators: ["equals", "not_equals", "is_empty", "is_not_empty"],
    sortable: true,
    groupable: true,
  },
  valueType: "select",
  config: {},
  optionCount: 3,
  rankKey: "a",
  lifecycle: "active",
  revision: 1,
  createdAt: "2026-03-21T14:20:00.000Z",
  updatedAt: "2026-03-21T14:20:00.000Z",
} satisfies DataSourcePropertyRecordV2;

const propertyBindings: readonly DataSourcePropertyEditorBinding[] = [{
  property: statusProperty,
  value: "in_progress",
  revision: 3,
  disabled: false,
  options: [
    { id: "todo", name: "Todo", color: "gray" },
    { id: "in_progress", name: "In progress", color: "blue" },
    { id: "done", name: "Done", color: "green" },
  ],
  optionRegistryState: "ready",
  onChange: () => undefined,
}];

function dispatchContextMenu(target: HTMLElement | null) {
  if (!target) {
    return;
  }

  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + 16,
    clientY: rect.top + 16,
    button: 2,
  }));
}

function CardContextMenuStory() {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dispatchContextMenu(triggerRef.current);

  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-token-main-surface-primary p-8">
      <CardContextMenu
        card={{
          id: "card-1",
          pageKey: "LAB-13",
          created: new Date("2026-03-21T14:20:00.000Z"),
          title: "Release plan",
        }}
        currentColumnId="inbox"
        currentProjectId="project-a"
        currentProjectName="Alpha workspace"
        onDelete={() => {}}
        onCopyPageKey={() => {}}
        onCopyLink={() => {}}
        onOpenPage={() => {}}
        onOpenPageInNewChat={() => {}}
        onSendPageToChat={() => Promise.resolve()}
        propertyBindings={propertyBindings}
        groupingPropertyId="status"
        showMockActions
      >
        <button
          ref={triggerRef}
          type="button"
          data-testid="card-context-menu-trigger"
          className="rounded-xl bg-token-main-surface-secondary px-4 py-3 text-sm text-token-foreground shadow-sm ring-1 ring-token-border"
        >
          Card context menu harness
        </button>
      </CardContextMenu>
    </div>
  );
}

const meta = {
  title: "Board/Card Context Menu",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Story-only harnesses that render the menu already open instead of requiring manual right-click.",
      },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActionsOpen: Story = {
  render: () => <CardContextMenuStory />,
};
