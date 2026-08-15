import type { Meta, StoryObj } from "@storybook/react-vite";

import { ReferencedBySection } from "./referenced-by-section";

const ITEMS = [
  {
    sourcePageId: "page:architecture",
    sourceBlockId: "block:mention",
    sourceTitle: "Architecture decisions",
    locationLabel: "Nodex / Product / Foundations",
    presentations: ["mention", "link"] as const,
    occurrenceCount: 3,
    updatedAt: "2026-08-16T02:00:00.000Z",
  },
  {
    sourcePageId: "page:long",
    sourceBlockId: "block:embed",
    sourceTitle: "A deliberately long Page title that proves dense backlink rows truncate cleanly",
    locationLabel: "Nodex / Research / Editor interaction models / References",
    presentations: ["reference_block"] as const,
    occurrenceCount: 1,
    updatedAt: "2026-08-16T01:00:00.000Z",
  },
] as const;

const meta = {
  title: "Board/Page Stage/Referenced by",
  component: ReferencedBySection,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[36rem] bg-token-main-surface-primary p-6 text-token-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    items: ITEMS,
    sourcePageCount: 2,
    defaultExpanded: true,
    onOpen: () => undefined,
  },
} satisfies Meta<typeof ReferencedBySection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const Loading: Story = {
  args: { items: [], sourcePageCount: 0, loading: true },
};

export const LoadError: Story = {
  args: { error: new Error("Offline") },
};
