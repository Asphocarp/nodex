import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { ReadOnlyDatabaseView } from "./read-only-database-view";

const model: DatabaseViewRenderModel = {
  projectId: "nodex",
  databaseViewId: "database-view:nodex:focused",
  databaseBlockId: "database:nodex:primary",
  databaseName: "Tasks",
  viewName: "Focused work",
  storeEpoch: "story",
  changeLogSeq: 1,
  primaryWriteCompatible: false,
  readOnlyReason: "This durable Database View is read-only until its mutations are modeled against the selected View identity.",
  query: { view: { kind: "kanban" } } as DatabaseViewRenderModel["query"],
  columns: [
      {
        id: "in_progress",
        name: "In Progress",
        rows: [
          {
            blockId: "card-1",
            status: "in_progress",
            title: "Unify Database View rendering",
            preview: "",
            plainText: "",
            tags: ["block-first"],
            metadataRevision: 1,
            createdAt: new Date("2026-07-12T00:00:00.000Z"),
          },
        ],
      },
      { id: "done", name: "Done", rows: [] },
    ],
};

const meta = {
  title: "Workbench/Read-only durable Database View",
  component: ReadOnlyDatabaseView,
  parameters: { layout: "fullscreen" },
  args: {
    model,
    searchQuery: "",
    openCardStage: () => undefined,
  },
  decorators: [(Story) => <div className="h-[640px]"><Story /></div>],
} satisfies Meta<typeof ReadOnlyDatabaseView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SecondaryView: Story = {};
