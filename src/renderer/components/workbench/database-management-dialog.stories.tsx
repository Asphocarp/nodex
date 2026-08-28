import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByLabelText, getByText, waitFor } from "@testing-library/dom";
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
import { upgradeDatabaseViewConfigV2 } from "../../../shared/database-view-presentation";
import { DatabaseManagementDialog } from "./database-management-dialog";

const timestamp = "2026-07-16T00:00:00.000Z";
const libraryId = "library:story";
const databaseId = parseDatabaseId("database:story");
const dataSourceId = parseDataSourceId("source:story");
const boardViewId = parseDatabaseViewId("view:board");
const listViewId = parseDatabaseViewId("view:list");

const databases: readonly DatabaseContainerDescriptorV2[] = [
  {
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
    dataSources: [
      {
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
      },
    ],
    views: [
      {
        viewId: boardViewId,
        databaseId,
        dataSourceId,
        name: "Board",
        defaultLayout: "board",
        config: upgradeDatabaseViewConfigV2({
          schemaKey: "nodex.database-view",
          schemaVersion: 2,
          filter: { kind: "group", operator: "and", children: [] },
          sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
          group: { propertyId: "status" },
          display: { propertyIds: ["priority", "tags"], showTitle: true },
        }),
        isDefault: true,
        revision: 3,
        rankKey: "a",
        lifecycle: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        viewId: listViewId,
        databaseId,
        dataSourceId,
        name: "Upcoming",
        defaultLayout: "list",
        config: upgradeDatabaseViewConfigV2({
          schemaKey: "nodex.database-view",
          schemaVersion: 2,
          filter: { kind: "group", operator: "and", children: [] },
          sort: [],
          group: null,
          display: { propertyIds: ["due_date"], showTitle: true },
        }),
        isDefault: false,
        revision: 1,
        rankKey: "b",
        lifecycle: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  },
];

const source: DataSourceDescriptorV2 = {
  dataSource: databases[0]!.dataSources[0]!,
  properties: [
    {
      propertyId: parseDataSourcePropertyId("status"),
      dataSourceId,
      name: "Status",
      ...testPropertySemantics("select", 2),
      valueType: "select",
      config: {
        options: [
          { id: "draft", name: "Draft", color: "gray" },
          { id: "done", name: "Done", color: "green" },
        ],
      },
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
      config: { options: [{ id: "high", name: "High", color: "red" }] },
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
      config: { options: [{ id: "o_AAAAAAAA", name: "Agent", color: "purple" }] },
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

const projectDefaultDatabases = databases.map((descriptor) => ({
  ...descriptor,
  database: { ...descriptor.database, name: "Research DB" },
  dataSources: descriptor.dataSources.map((dataSource) => ({
    ...dataSource,
    name: "Research DB",
  })),
}));

const projectDefaultSource: DataSourceDescriptorV2 = {
  ...source,
  dataSource: { ...source.dataSource, name: "Research DB" },
};

const overflowSource: DataSourceDescriptorV2 = {
  ...source,
  properties: [
    ...source.properties,
    ...Array.from({ length: 8 }, (_, index) => {
      const template = source.properties[index % source.properties.length]!;
      return {
        ...template,
        propertyId: parseDataSourcePropertyId(`p_extra00${index}`),
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
export const BoardAndListOnly: Story = {
  parameters: {
    docs: {
      description: {
        story: "View authoring exposes only Board and List as default layouts.",
      },
    },
  },
};
export const ProjectDefaultNames: Story = {
  args: {
    databases: projectDefaultDatabases,
    source: projectDefaultSource,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Project-created Database containers and their initial Data Source share the `<project-name> DB` display name.",
      },
    },
  },
};
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

export const DeleteConfirmation: Story = {
  args: { source: overflowSource },
  play: async ({ canvasElement }) => {
    fireEvent.click(getByLabelText(canvasElement, "Delete property Additional Status 1"));
    await waitFor(() =>
      getByText(canvasElement, "Delete this Property and its values from every Page?"),
    );
  },
};

export const DeleteBlockedByView: Story = {
  play: async ({ canvasElement }) => {
    fireEvent.click(getByLabelText(canvasElement, "Delete property Due date"));
    await waitFor(() =>
      getByText(canvasElement, "Used by Upcoming. Remove it from those Views first."),
    );
  },
};
