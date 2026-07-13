import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DbViewCardRecord } from "@/lib/db-view-prefs";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { ToggleListReferenceRows } from "./toggle-list-view";

const CARDS: DbViewCardRecord[] = [
  {
    id: "card-sync-contract",
    status: "in_progress",
    archived: false,
    title: "Define the Card document sync contract",
    richTitle: plainTextToPortableRichText("Define the Card document sync contract"),
    priority: "p0-critical",
    estimate: "l",
    tags: ["sync", "architecture"],
    agentBlocked: false,
    created: new Date("2026-07-10T09:00:00.000Z"),
    order: 0,
    descriptionPreview: "Each expanded row opens the Card's own Y.Doc.",
    descriptionLength: 45,
    hasDescription: true,
    columnId: "in_progress",
    columnName: "In Progress",
    boardIndex: 0,
  },
  {
    id: "card-reference-migration",
    status: "in_review",
    archived: false,
    title: "Verify foreign-body migration",
    richTitle: plainTextToPortableRichText("Verify foreign-body migration"),
    priority: "p1-high",
    estimate: "m",
    tags: ["migration"],
    agentBlocked: false,
    created: new Date("2026-07-11T08:00:00.000Z"),
    order: 1,
    descriptionPreview: "Host documents retain references only.",
    descriptionLength: 37,
    hasDescription: true,
    columnId: "in_review",
    columnName: "In Review",
    boardIndex: 1,
  },
];

const meta = {
  title: "Kanban/Toggle List/Reference Rows",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CollaborativeRows: Story = {
  render: () => (
    <main className="min-h-screen bg-token-bg-primary p-8 text-token-text-primary">
      <div className="mx-auto max-w-4xl rounded-lg border-[0.5px] border-token-border bg-token-bg-primary px-3.5 py-3">
        <ToggleListReferenceRows
          projectId="nodex"
          disclosureScopeKey="toggle-list:view-story"
          cards={CARDS}
          propertyOrder={["priority", "estimate", "status", "tags"]}
          hiddenProperties={[]}
          showEmptyEstimate={false}
          showEmptyPriority={false}
          visibilityOverride
          onOpenCard={() => undefined}
          renderDocument={({ card }) => (
            <div className="py-2 text-sm text-token-text-secondary">
              Independent collaborative surface for {card.title}
            </div>
          )}
        />
      </div>
    </main>
  ),
};
