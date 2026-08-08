import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DatabasePageSummary as CardType } from "@/lib/types";
import type { ColumnPaginationState } from "@/lib/board-store";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { Column } from "./column";

const card = (id: string, title: string, order: number): CardType => ({
  id,
  pageKey: null,
  status: "build",
  archived: false,
  title,
  richTitle: plainTextToPortableRichText(title),
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
  tags: [],
  created: new Date("2026-06-17T12:00:00.000Z"),
  order,
});

const CARDS = [
  card("card-1", "Wire the release checklist", 0),
  card("card-2", "Verify installer provenance", 1),
  card("card-3", "Draft the migration note", 2),
];

function ColumnStoryFrame({
  cards = CARDS,
  createDisabledReason,
  collapsed = false,
  pagination,
  highlightedPageId,
  presentedPageIds,
  selectedPageIds,
}: {
  cards?: CardType[];
  createDisabledReason?: string;
  collapsed?: boolean;
  pagination?: ColumnPaginationState;
  highlightedPageId?: string;
  presentedPageIds?: ReadonlySet<string>;
  selectedPageIds?: ReadonlySet<string>;
}) {
  return (
    <div className="flex min-h-screen items-start bg-token-main-surface-primary p-8">
      <div className="h-[480px]">
        <Column
          projectId="alpha"
          projectName="Alpha"
          column={{ id: "build", name: "Build", cards }}
          createDisabledReason={createDisabledReason}
          pagination={pagination}
          highlightedPageId={highlightedPageId}
          presentedPageIds={presentedPageIds}
          selectedPageIds={selectedPageIds}
          onLoadMore={() => {}}
          layout={{ width: 320, collapsed }}
          onRequestCreatePage={() => {}}
          onEditCard={() => {}}
          onUpdatePageProperty={async () => {}}
          onCollapsedChange={() => {}}
          onWidthChange={() => {}}
          dragDisabled
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Board/Column",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every loaded row is on screen; no continuation affordance renders. */
export const FullyLoaded: Story = {
  render: () => (
    <ColumnStoryFrame
      pagination={{
        scopeKey: "key:build",
        loadedRows: 3,
        totalRows: 3,
        hasMore: false,
        loadingMore: false,
        error: null,
      }}
    />
  ),
};

/** Keyboard activity and multi-selection collapse to one selected-card halo. */
export const SelectedAndKeyboardActive: Story = {
  render: () => (
    <ColumnStoryFrame
      highlightedPageId="card-2"
      selectedPageIds={new Set(["card-2"])}
    />
  ),
};

/** Presence remains legible without becoming a second selection halo. */
export const PresentedAndSelected: Story = {
  render: () => (
    <ColumnStoryFrame
      presentedPageIds={new Set(["card-2"])}
      selectedPageIds={new Set(["card-2"])}
    />
  ),
};

/**
 * The column window has a continuation: the header badge reports the true
 * group total and an in-flow `Show N more` row follows the last card.
 */
export const WithMoreRows: Story = {
  render: () => (
    <ColumnStoryFrame
      pagination={{
        scopeKey: "key:build",
        loadedRows: 3,
        totalRows: 42,
        hasMore: true,
        loadingMore: false,
        error: null,
      }}
    />
  ),
};

/** A failed continuation keeps the column and offers an inline retry. */
export const ContinuationFailed: Story = {
  render: () => (
    <ColumnStoryFrame
      pagination={{
        scopeKey: "key:build",
        loadedRows: 3,
        totalRows: 42,
        hasMore: true,
        loadingMore: false,
        error: "Core is unavailable",
      }}
    />
  ),
};

/** Read-only launchers remain focusable and explain the canonical View reason. */
export const ReadOnly: Story = {
  render: () => (
    <ColumnStoryFrame
      createDisabledReason="This View is read-only because it is grouped by Tags."
    />
  ),
};

/** An empty read-only group keeps its collapsed create surface keyboard-reachable. */
export const AutoCollapsedReadOnly: Story = {
  render: () => (
    <ColumnStoryFrame
      cards={[]}
      createDisabledReason="This View is read-only because it is grouped by Tags."
    />
  ),
};
