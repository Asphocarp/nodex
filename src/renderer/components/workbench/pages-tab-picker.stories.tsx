import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseDatabaseId } from "../../../shared/database-identities";
import type { LibraryCatalogEntry } from "../../../shared/library-module";
import {
  PagesTabPicker,
  type PagesTabPickerDataSource,
} from "./pages-tab-picker";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const items: LibraryCatalogEntry[] = [
  {
    target: { kind: "page", pageId: "page-today" },
    title: "Today",
    kind: "page",
    lifecycle: "active",
    locationLabel: "Pages",
    updatedAt: "2026-08-04T00:00:00.000Z",
    locationRevision: 1,
    metadataRevision: 1,
  },
  {
    target: {
      kind: "database",
      databaseId: parseDatabaseId("database-reading-list"),
    },
    title: "Reading list",
    kind: "database",
    lifecycle: "active",
    locationLabel: "Pages / Research",
    updatedAt: "2026-08-04T00:00:00.000Z",
    locationRevision: 1,
    metadataRevision: 1,
  },
  {
    target: { kind: "canvas", canvasId: "canvas-ideas" },
    title: "Loose ideas",
    kind: "canvas",
    lifecycle: "active",
    locationLabel: "Pages",
    updatedAt: "2026-08-04T00:00:00.000Z",
    locationRevision: 1,
    metadataRevision: 1,
  },
];

const dataSource = {
  useCatalog: () => ({
    data: {
      pages: [{
        kind: "catalog" as const,
        libraryId: "library:storybook",
        storeEpoch: "epoch:storybook",
        changeLogSeq: 1,
        items,
        nextCursor: null,
        hasMore: false,
        total: items.length,
      }],
      pageParams: [undefined],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
    refetch: async () => ({}) as never,
    fetchNextPage: async () => ({}) as never,
  }),
  useCreateCommands: () => ({
    isPending: false,
    createPage: async () => undefined,
    createDatabase: async () => undefined,
  }),
} satisfies PagesTabPickerDataSource;

const meta = {
  title: "Workbench/Pages/Open Tab Picker",
  component: PagesTabPicker,
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <div className="flex h-[420px] items-start bg-token-background p-20">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    defaultOpen: true,
    dataSource,
    onOpenTarget: () => undefined,
  },
} satisfies Meta<typeof PagesTabPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Empty: Story = {
  args: {
    dataSource: {
      ...dataSource,
      useCatalog: () => ({
        ...dataSource.useCatalog(),
        data: {
          pages: [{
            kind: "catalog" as const,
            libraryId: "library:storybook",
            storeEpoch: "epoch:storybook",
            changeLogSeq: 1,
            items: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
          }],
          pageParams: [undefined],
        },
      }),
    },
  },
};
