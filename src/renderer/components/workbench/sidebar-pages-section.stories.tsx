import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltipProvider } from "@/components/ui/tooltip";

import { parseDatabaseId, parseDatabaseViewId } from "../../../shared/database-identities";
import type {
  LibraryCanvasNavigationNode,
  LibraryDatabaseNavigationNode,
  LibraryPageNavigationNode,
} from "../../../shared/library-module";
import { SidebarPagesSection, type SidebarPagesDataSource } from "./sidebar-pages-section";

const updatedAt = "2026-08-03T08:00:00.000Z";

const page = (index: number): LibraryPageNavigationNode => ({
  kind: "page",
  pageId: `page-${index}`,
  title: index === 1 ? "Today" : `Prompt snippet ${index}`,
  hasChildren: false,
  parentRevision: 1,
  metadataRevision: 1,
  documentGeneration: 1,
  documentHeadSeq: 0,
  updatedAt,
});

const database: LibraryDatabaseNavigationNode = {
  kind: "database",
  databaseId: parseDatabaseId("database-reading-list"),
  title: "Reading list",
  defaultViewId: parseDatabaseViewId("view-reading-list"),
  hasMultipleViews: true,
  metadataRevision: 1,
  locationRevision: 1,
  updatedAt,
};

const canvas: LibraryCanvasNavigationNode = {
  kind: "canvas",
  canvasId: "canvas-ideas",
  title: "Loose ideas",
  isPrimary: false,
  metadataRevision: 1,
  locationRevision: 1,
  documentGeneration: 1,
  documentHeadSeq: 0,
  updatedAt,
};

type StandaloneRoot =
  | LibraryPageNavigationNode
  | LibraryDatabaseNavigationNode
  | LibraryCanvasNavigationNode;

const makeDataSource = (items: readonly StandaloneRoot[]): SidebarPagesDataSource => ({
  useStandaloneRoots: () => ({
    data: {
      pages: [
        {
          kind: "standalone_roots",
          items,
          nextCursor: null,
          hasMore: false,
          total: items.length,
        },
      ],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
    refetch: async () => undefined,
    fetchNextPage: async () => undefined,
  }),
});

const meta = {
  title: "Workbench/Sidebar/Pages",
  component: SidebarPagesSection,
  decorators: [
    (Story) => (
      <NodexTooltipProvider>
        <div className="w-[280px] bg-token-sidebar-surface-primary p-2">
          <Story />
        </div>
      </NodexTooltipProvider>
    ),
  ],
  args: {
    collapsed: false,
    activeRoot: { kind: "page", pageId: "page-1" },
    onToggle: () => undefined,
    onOpenRoot: () => undefined,
    dataSource: makeDataSource([page(1), page(2), database, canvas]),
    mutationsEnabled: false,
  },
} satisfies Meta<typeof SidebarPagesSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedStandaloneRoots: Story = {};

export const Paginated: Story = {
  args: {
    activeRoot: null,
    dataSource: makeDataSource([page(1), page(2), page(3), page(4), page(5), page(6)]),
  },
};

export const Empty: Story = {
  args: {
    activeRoot: null,
    dataSource: makeDataSource([]),
  },
};

export const Collapsed: Story = {
  args: { collapsed: true },
};
