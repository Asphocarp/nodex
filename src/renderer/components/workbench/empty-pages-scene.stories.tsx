import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  EmptyPagesScene,
  type PagesTabPickerDataSource,
} from "./pages-tab-picker";

const queryClient = new QueryClient();
const emptyDataSource = {
  useCatalog: () => ({
    data: {
      pages: [{
        kind: "catalog" as const,
        libraryId: "library:storybook",
        storeEpoch: "epoch:storybook",
        commitSeq: 1,
        items: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
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
  title: "Workbench/Pages/Empty Scene",
  component: EmptyPagesScene,
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <div className="h-[520px] bg-token-background">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    dataSource: emptyDataSource,
    onOpenTarget: () => undefined,
  },
} satisfies Meta<typeof EmptyPagesScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
