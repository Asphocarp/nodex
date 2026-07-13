import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { CardReferenceReadModel } from "../../../../shared/block-references";
import {
  CARD_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../../../shared/block-documents";
import type { CardSummary } from "@/lib/types";
import { CardReferenceSurface } from "@/components/block-documents/reference-block-surfaces";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";

const CARD: CardSummary = {
  id: "card-reference-story",
  status: "in_progress",
  archived: false,
  title: "Make Card documents independently collaborative",
  richTitle: plainTextToPortableRichText("Make Card documents independently collaborative"),
  priority: "p1-high",
  estimate: "m",
  tags: ["sync"],
  agentBlocked: false,
  created: new Date("2026-01-01T00:00:00.000Z"),
  order: 0,
  descriptionPreview: "The host Card stores only a stable reference.",
  descriptionLength: 51,
  hasDescription: true,
};

const AVAILABLE: CardReferenceReadModel = {
  status: "available",
  targetBlockId: CARD.id,
  projectId: "nodex",
  lifecycle: "active",
  summary: CARD,
  document: {
    documentId: `document:${CARD.id}`,
    generation: 1,
    headSeq: 18,
    readiness: "ready",
    authority: "ydoc_primary",
    schemaKey: "nodex.card",
    schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  },
};

function CardReferenceStory({
  model,
}: {
  readonly model: CardReferenceReadModel;
}) {
  const [expansionStore] = useState(() => new ReferenceExpansionStore());
  const [activationBudget] = useState(
    () => new ReferenceSurfaceActivationBudget(2),
  );
  return (
    <main className="min-h-screen bg-token-bg-primary p-8 text-token-text-primary">
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-xs text-token-description-foreground">
          Host Card content · reference Block
        </p>
        <CardReferenceSurface
          referenceKey={`story:${model.targetBlockId}`}
          displayHint="Collaborative Card"
          model={model}
          expansionStore={expansionStore}
          activationBudget={activationBudget}
          visibilityOverride
          onOpenCard={() => undefined}
          renderDocument={({ card }) => (
            <div className="py-2">
              <textarea
                aria-label="Embedded Card title"
                defaultValue={card.title}
                className="w-full resize-none border-none bg-transparent text-base font-semibold outline-none"
              />
              <p className="mt-1 text-sm text-token-text-secondary">
                This is the target Card’s independent document surface. In the app,
                it owns a separate Y.Doc/provider and never becomes host children.
              </p>
            </div>
          )}
        />
      </div>
    </main>
  );
}

const meta = {
  title: "Kanban/Block References/Card",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
  render: () => <CardReferenceStory model={AVAILABLE} />,
};

export const Missing: Story = {
  render: () => (
    <CardReferenceStory
      model={{ status: "missing", targetBlockId: "deleted-card" }}
    />
  ),
};

export const Archived: Story = {
  render: () => (
    <CardReferenceStory
      model={{ ...AVAILABLE, lifecycle: "archived" }}
    />
  ),
};
