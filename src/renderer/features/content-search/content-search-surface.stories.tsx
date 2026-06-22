import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContentSearchSurfaceView } from "./content-search-surface";

const meta = {
  title: "Workbench/Content search input",
  component: ContentSearchSurfaceView,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    open: true,
    domain: "conversation",
    query: "review",
    hasBrowserTarget: false,
    loading: false,
    resultLabel: "1 / 24 results",
    navigationDisabled: false,
    onDomainChange: () => undefined,
    onQueryChange: () => undefined,
    onClose: () => undefined,
    onNext: () => undefined,
    onPrevious: () => undefined,
  },
} satisfies Meta<typeof ContentSearchSurfaceView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PopulatedConversation: Story = {};

export const EmptyCollapsedRow: Story = {
  args: {
    query: "",
    resultLabel: "",
    navigationDisabled: true,
  },
};

export const LoadingDiff: Story = {
  args: {
    domain: "diff",
    query: "selectedPath",
    loading: true,
    resultLabel: "Searching…",
    navigationDisabled: true,
  },
};

export const BrowserButtonVisible: Story = {
  args: {
    domain: "browser",
    query: "localhost",
    hasBrowserTarget: true,
    resultLabel: "3 / 8 results",
  },
};

export const DialogOverlaySuppressed: Story = {
  args: {
    open: false,
  },
  render: (args) => (
    <div className="min-h-screen bg-token-main-surface-primary">
      <div className="codex-dialog-overlay fixed inset-0 z-50 bg-black/45" />
      <ContentSearchSurfaceView {...args} />
    </div>
  ),
};
