import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { DatabaseViewReadModel } from "../../../../shared/database-views";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import type { CardSummary } from "@/lib/types";
import { DatabaseViewReferenceSurface } from "@/components/block-documents/reference-block-surfaces";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";

const makeCard = (
  id: string,
  title: string,
  status: CardSummary["status"],
): CardSummary => ({
  id,
  status,
  archived: false,
  title,
  richTitle: plainTextToPortableRichText(title),
  priority: "p2-medium",
  estimate: "s",
  tags: [],
  agentBlocked: false,
  created: new Date("2026-01-01T00:00:00.000Z"),
  order: 0,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
});

const VIEW: DatabaseViewReadModel = {
  view: {
    id: "database-view:inline:story",
    databaseBlockId: "database:primary",
    projectId: "nodex",
    name: "Block-first migration",
    kind: "list",
    config: {},
    isPrimary: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  rows: [
    makeCard("bf-05", "Retire foreign-body projections", "in_progress"),
    makeCard("bf-06", "Make cross-document moves atomic", "backlog"),
    makeCard("bf-07", "Cut history and search over", "backlog"),
    makeCard("bf-08", "Generalize durable Database views", "draft"),
    makeCard("bf-09", "Add document-bearing Block types", "draft"),
  ].map((card, index) => ({ card, groupKey: null, rankKey: String(index) })),
};

function DatabaseViewReferenceStory() {
  const [expansionStore] = useState(() => new ReferenceExpansionStore());
  const [activationBudget] = useState(
    () => new ReferenceSurfaceActivationBudget(2),
  );
  return (
    <main className="min-h-screen bg-token-bg-primary p-8 text-token-text-primary">
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-xs text-token-description-foreground">
          Durable Database View · two-editor activation budget in this fixture
        </p>
        <DatabaseViewReferenceSurface
          referenceKey="story:database-view"
          displayHint=""
          model={VIEW}
          expansionStore={expansionStore}
          activationBudget={activationBudget}
          visibilityOverride
          onOpenCard={() => undefined}
          renderDocument={({ card }) => (
            <div className="py-2 text-sm text-token-text-secondary">
              Independent Y.Doc surface for {card.title}
            </div>
          )}
        />
      </div>
    </main>
  );
}

const meta = {
  title: "Kanban/Block References/Database View",
  parameters: { layout: "fullscreen" },
  render: () => <DatabaseViewReferenceStory />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
