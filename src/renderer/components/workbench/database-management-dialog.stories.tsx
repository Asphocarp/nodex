import type { Meta, StoryObj } from "@storybook/react-vite";
import type { GeneralDatabaseCatalog } from "../../../shared/database-query";
import { DatabaseManagementDialog } from "./database-management-dialog";

const timestamp = "2026-07-12T00:00:00.000Z";
const catalog: GeneralDatabaseCatalog = {
  databases: [
    {
      database: {
        blockId: "database-primary",
        projectId: "project-nodex",
        name: "Product work",
        isPrimary: true,
        schemaKey: "nodex.database",
        schemaRevision: 4,
        metadataRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      properties: [
        {
          id: "property-status",
          databaseBlockId: "database-primary",
          key: "status",
          name: "Status",
          valueType: "select",
          config: {
            options: [
              { id: "draft", name: "Draft" },
              { id: "in_progress", name: "In progress" },
              { id: "done", name: "Done" },
            ],
          },
          rankKey: "1",
          lifecycle: "active",
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "property-estimate",
          databaseBlockId: "database-primary",
          key: "estimate",
          name: "Estimate",
          valueType: "number",
          config: {},
          rankKey: "2",
          lifecycle: "active",
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      views: [
        {
          id: "view-board",
          databaseBlockId: "database-primary",
          projectId: "project-nodex",
          name: "Roadmap",
          kind: "kanban",
          config: {
            schemaKey: "nodex.database-view",
            schemaVersion: 1,
            filter: { kind: "group", operator: "and", children: [] },
            sort: [],
            group: { propertyId: "property-status" },
            display: { propertyIds: ["property-estimate"], showTitle: true },
          },
          isPrimary: true,
          revision: 1,
          rankKey: "1",
          lifecycle: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "view-calendar",
          databaseBlockId: "database-primary",
          projectId: "project-nodex",
          name: "Shipping calendar",
          kind: "calendar",
          config: {
            schemaKey: "nodex.database-view",
            schemaVersion: 1,
            filter: { kind: "group", operator: "and", children: [] },
            sort: [],
            group: null,
            display: { propertyIds: [], showTitle: true },
          },
          isPrimary: false,
          revision: 1,
          rankKey: "2",
          lifecycle: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    },
    {
      database: {
        blockId: "database-research",
        projectId: "project-nodex",
        name: "Research library",
        isPrimary: false,
        schemaKey: "nodex.database",
        schemaRevision: 1,
        metadataRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      properties: [],
      views: [],
    },
  ],
};

const meta = {
  title: "Workbench/Database manager",
  component: DatabaseManagementDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    catalog,
    selectedDatabaseBlockId: "database-primary",
    onOpenChange: () => undefined,
    onSelectDatabase: () => undefined,
    onCreateDatabase: () => undefined,
    onCreateProperty: () => undefined,
    onDeleteProperty: () => undefined,
    onCreateView: () => undefined,
    onDeleteView: () => undefined,
    onPutPropertyOption: () => undefined,
    onDeletePropertyOption: () => undefined,
  },
} satisfies Meta<typeof DatabaseManagementDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectSchema: Story = {};
