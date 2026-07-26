import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DatabasePageSummary as CardType } from "@/lib/types";
import type { ColumnPaginationState } from "@/lib/kanban-store";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { Column } from "./column";

const card = (id: string, title: string, order: number): CardType => ({
  id,
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
  pagination,
}: {
  pagination?: ColumnPaginationState;
}) {
  return (
    <div className="flex min-h-screen items-start bg-token-main-surface-primary p-8">
      <div className="h-[480px]">
        <Column
          projectId="alpha"
          projectName="Alpha"
          column={{ id: "build", name: "Build", cards: CARDS }}
          pagination={pagination}
          onLoadMore={() => {}}
          layout={{ width: 320, collapsed: false }}
          onAddCard={async () => {}}
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
  title: "Kanban/Column",
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
