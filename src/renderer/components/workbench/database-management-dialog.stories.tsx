import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  DatabaseContainerDescriptorV2,
  DataSourceDescriptorV2,
} from "../../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { DatabaseManagementDialog } from "./database-management-dialog";

const timestamp = "2026-07-16T00:00:00.000Z";
const libraryId = "library:story";
const databaseId = parseDatabaseId("database:story");
const dataSourceId = parseDataSourceId("source:story");
const boardViewId = parseDatabaseViewId("view:board");
const calendarViewId = parseDatabaseViewId("view:calendar");

const databases: readonly DatabaseContainerDescriptorV2[] = [{
  database: {
    databaseId,
    libraryId,
    name: "Product work",
    lifecycle: "active",
    defaultViewId: boardViewId,
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
      viewId: boardViewId,
      databaseId,
      dataSourceId,
      name: "Board",
      kind: "kanban",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
        group: { propertyId: "status" },
        display: { propertyIds: ["priority", "tags"], showTitle: true },
      },
      isDefault: true,
      revision: 3,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      viewId: calendarViewId,
      databaseId,
      dataSourceId,
      name: "Upcoming",
      kind: "calendar",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [],
        group: null,
        display: { propertyIds: ["due_date"], showTitle: true },
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

const source: DataSourceDescriptorV2 = {
  dataSource: databases[0]!.dataSources[0]!,
  properties: [
    {
      propertyId: parseDataSourcePropertyId("status"),
      dataSourceId,
      name: "Status",
      ...testPropertySemantics("select", 2),
      valueType: "select",
      config: { options: [{ id: "draft", name: "Draft" }, { id: "done", name: "Done" }] },
      rankKey: "a",
      lifecycle: "active",
      revision: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: parseDataSourcePropertyId("priority"),
      dataSourceId,
      name: "Priority",
      ...testPropertySemantics("select", 1),
      valueType: "select",
      config: { options: [{ id: "high", name: "High" }] },
      rankKey: "b",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: parseDataSourcePropertyId("tags"),
      dataSourceId,
      name: "Tags",
      ...testPropertySemantics("multi_select", 1),
      valueType: "multi_select",
      config: { options: [{ id: "o_AAAAAAAA", name: "Agent" }] },
      rankKey: "c",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      propertyId: parseDataSourcePropertyId("due_date"),
      dataSourceId,
      name: "Due date",
      ...testPropertySemantics("date"),
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

const overflowSource: DataSourceDescriptorV2 = {
  ...source,
  properties: [
    ...source.properties,
    ...Array.from({ length: 8 }, (_, index) => {
      const template = source.properties[index % source.properties.length]!;
      return {
        ...template,
        propertyId: parseDataSourcePropertyId(`overflow_${index}`),
        name: `Additional ${template.name} ${index + 1}`,
        rankKey: `overflow-${index}`,
      };
    }),
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
export const ScrollingContent: Story = {
  args: { source: overflowSource },
  parameters: {
    docs: {
      description: {
        story: "A long schema keeps the Database manager bounded while its detail pane scrolls.",
      },
    },
  },
};
export const Busy: Story = { args: { busy: true } };
export const ErrorState: Story = {
  args: { error: "View changed in another window. Reloaded current authority." },
};
