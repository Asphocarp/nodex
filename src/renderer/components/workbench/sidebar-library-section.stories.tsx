import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltipProvider } from "@/components/ui/tooltip";

import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../../shared/database-identities";
import type {
  LibraryNavigationNode,
  LibraryNavigationParent,
} from "../../../shared/library-module";
import {
  SidebarLibrarySection,
  type SidebarLibraryDataSource,
} from "./sidebar-library-section";

const updatedAt = "2026-07-18T08:00:00.000Z";
const page = (
  pageId: string,
  title: string,
  hasChildren = false,
): LibraryNavigationNode => ({
  kind: "page",
  pageId,
  title,
  hasChildren,
  parentRevision: 1,
  metadataRevision: 1,
  documentGeneration: 1,
  documentHeadSeq: 1,
  updatedAt,
});
const database = (
  databaseId: string,
  title: string,
  hasMultipleViews = false,
): LibraryNavigationNode => ({
  kind: "database",
  databaseId: parseDatabaseId(databaseId),
  title,
  defaultViewId: parseDatabaseViewId(`${databaseId}-default-view`),
  hasMultipleViews,
  metadataRevision: 1,
  locationRevision: 1,
  updatedAt,
});
const view = (
  viewId: string,
  databaseId: string,
  title: string,
  isDefault: boolean,
): LibraryNavigationNode => ({
  kind: "view",
  viewId: parseDatabaseViewId(viewId),
  databaseId: parseDatabaseId(databaseId),
  dataSourceId: parseDataSourceId(`${databaseId}-source`),
  title,
  viewKind: isDefault ? "kanban" : "calendar",
  isDefault,
  revision: 1,
});

const rootPage = page(
  "page-product",
  "Product notes with a deliberately long title that demonstrates truncation",
  true,
);
const nestedPage = page("page-launch", "Launch plan", true);
const leafPage = page("page-checklist", "Release checklist");
const taskDatabase = database("database-tasks", "Tasks", true);
const boardView = view("view-board", "database-tasks", "Board", true);
const calendarView = view("view-calendar", "database-tasks", "Calendar", false);

const parentKey = (parent: LibraryNavigationParent): string => {
  if (parent.kind === "library") return "library";
  if (parent.kind === "page") return `page:${parent.pageId}`;
  return `database:${parent.databaseId}`;
};

const makeDataSource = (input: {
  root?: readonly LibraryNavigationNode[];
  children?: Readonly<Record<string, readonly LibraryNavigationNode[]>>;
  path?: readonly LibraryNavigationNode[];
  paginatedParents?: readonly string[];
  loading?: boolean;
  error?: boolean;
} = {}): SidebarLibraryDataSource => ({
  useInvalidation: () => undefined,
  usePath: (target) => ({
    data: input.path
      ? { kind: "path", target, nodes: input.path }
      : undefined,
    isPending: false,
    isError: false,
    refetch: async () => undefined,
  }),
  useChildren: () => {
    const items = input.root ?? [rootPage, taskDatabase];
    return {
      data: input.loading || input.error
        ? undefined
        : {
            kind: "children",
            parent: { kind: "library" },
            items,
            nextCursor: null,
            hasMore: false,
            total: items.length,
          },
      isPending: input.loading ?? false,
      isError: input.error ?? false,
      refetch: async () => undefined,
    };
  },
  useInfiniteChildren: (parent) => {
    const items = input.children?.[parentKey(parent)] ?? [];
    const hasMore = input.paginatedParents?.includes(parentKey(parent)) ?? false;
    return {
      data: {
        pages: [{
          kind: "children",
          parent,
          items,
          nextCursor: hasMore ? "storybook-next-page" : null,
          hasMore,
          total: items.length + (hasMore ? 8 : 0),
        }],
      },
      isPending: false,
      isError: false,
      hasNextPage: hasMore,
      refetch: async () => undefined,
      fetchNextPage: async () => undefined,
    };
  },
});

const meta = {
  title: "Workbench/Sidebar/Library",
  component: SidebarLibrarySection,
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
    activeTarget: null,
    onToggle: () => undefined,
    onOpenLibrary: () => undefined,
    onOpenTarget: () => undefined,
    dataSource: makeDataSource(),
  },
} satisfies Meta<typeof SidebarLibrarySection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedRoot: Story = {};

export const DeepActivePath: Story = {
  args: {
    activeTarget: { kind: "page", pageId: "page-checklist" },
    dataSource: makeDataSource({
      path: [rootPage, nestedPage, leafPage],
      children: {
        "page:page-product": [nestedPage],
        "page:page-launch": [leafPage],
      },
    }),
  },
};

export const MultipleViews: Story = {
  args: {
    activeTarget: { kind: "view", viewId: parseDatabaseViewId("view-calendar") },
    dataSource: makeDataSource({
      path: [taskDatabase, calendarView],
      children: { "database:database-tasks": [boardView, calendarView] },
    }),
  },
};

export const PaginatedPageChildren: Story = {
  args: {
    activeTarget: { kind: "page", pageId: "page-launch" },
    dataSource: makeDataSource({
      path: [rootPage, nestedPage],
      children: { "page:page-product": [nestedPage] },
      paginatedParents: ["page:page-product"],
    }),
  },
};

export const Empty: Story = {
  args: { dataSource: makeDataSource({ root: [] }) },
};

export const Loading: Story = {
  args: { dataSource: makeDataSource({ loading: true }) },
};

export const ErrorRetry: Story = {
  args: { dataSource: makeDataSource({ error: true }) },
};

export const Collapsed: Story = {
  args: { collapsed: true },
};

export const DarkSurface: Story = {
  parameters: {
    backgrounds: { default: "dark" },
  },
};
