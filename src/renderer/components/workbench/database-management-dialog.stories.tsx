import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  DatabaseContainerDescriptor,
  DataSourceDescriptor,
} from "../../../shared/database-module";
import { DatabaseManagementDialog } from "./database-management-dialog";

const timestamp = "2026-07-16T00:00:00.000Z";
const libraryId = "library:story";
const databaseId = "database:story";
const dataSourceId = "source:story";

const databases: readonly DatabaseContainerDescriptor[] = [{
  database: {
    databaseId,
    libraryId,
    name: "Product work",
    lifecycle: "active",
    defaultViewId: "view:board",
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  dataSources: [{
    dataSourceId,
    libraryId,
    homeDatabaseId: databaseId,
    name: "Pages",
    schemaKey: "nodex.pages",
    schemaRevision: 4,
    lifecycle: "active",
    rankKey: "a",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  views: [
    {
      viewId: "view:board",
      databaseId,
      dataSourceId,
      name: "Board",
      kind: "kanban",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
        group: { propertyId: "property:status" },
        display: { propertyIds: ["property:priority", "property:tags"], showTitle: true },
      },
      isDefault: true,
      revision: 3,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      viewId: "view:calendar",
      databaseId,
      dataSourceId,
      name: "Upcoming",
      kind: "calendar",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [],
        group: null,
        display: { propertyIds: ["property:due"], showTitle: true },
      },
      isDefault: false,
      revision: 1,
      rankKey: "b",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
}];

const source: DataSourceDescriptor = {
  dataSource: databases[0]!.dataSources[0]!,
  properties: [
    {
      propertyId: "property:status",
      dataSourceId,
      key: "status",
      name: "Status",
      valueType: "select",
      config: { options: [{ id: "draft", name: "Draft" }, { id: "done", name: "Done" }] },
      rankKey: "a",
      lifecycle: "active",
      revision: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: "property:priority",
      dataSourceId,
      key: "priority",
      name: "Priority",
      valueType: "select",
      config: { options: [{ id: "high", name: "High" }] },
      rankKey: "b",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: "property:tags",
      dataSourceId,
      key: "tags",
      name: "Tags",
      valueType: "multi_select",
      config: { options: [{ id: "agent", name: "Agent" }] },
      rankKey: "c",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: "property:due",
      dataSourceId,
      key: "due_date",
      name: "Due date",
      valueType: "date",
      config: {},
      rankKey: "d",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
};

const meta = {
  title: "Workbench/Database Management",
  component: DatabaseManagementDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    databases,
    source,
    selectedDatabaseId: databaseId,
    onSelectDatabase: () => undefined,
    onCreateProperty: () => undefined,
    onDeleteProperty: () => undefined,
    onCreateView: () => undefined,
    onUpdateView: () => undefined,
    onDeleteView: () => undefined,
    onPutPropertyOption: () => undefined,
    onDeletePropertyOption: () => undefined,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DatabaseManagementDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSource: Story = {};
export const Busy: Story = { args: { busy: true } };
export const ErrorState: Story = {
  args: { error: "View changed in another window. Reloaded current authority." },
};
