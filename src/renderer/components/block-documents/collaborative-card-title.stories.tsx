import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import {
  createCardDocument,
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "../../../shared/block-documents";
import { CollaborativeCardTitle } from "./collaborative-card-title";
import type { BlockDocumentSurfaceWriteFence } from "@/lib/block-document-surface-runtime";

const FROZEN_STORY_FENCE: BlockDocumentSurfaceWriteFence = {
  getWriteFrozen: () => true,
  subscribe: () => () => undefined,
  registerRelocationPreparer: () => () => undefined,
};

const RICH_TITLE: PortableRichText = [
  { type: "text", text: "Designing a ", styles: {} },
  { type: "text", text: "rich", styles: { bold: true, color: "blue" } },
  { type: "text", text: " Card title with ", styles: { italic: true } },
  { type: "link", text: "stable identity", href: "https://nodex.local", styles: {} },
  { type: "dateMention", start: "2026-07-14" },
];

function CollaborativeCardTitleStory({
  frozen = false,
  rich = false,
  long = false,
}: {
  frozen?: boolean;
  rich?: boolean;
  long?: boolean;
}) {
  const [cardDocument] = useState(() => {
    const card = createCardDocument({
      documentId: "storybook:collaborative-card-title",
      initialTitle: long
        ? "A deliberately long Card title that demonstrates natural wrapping while preserving a dense, borderless editing surface across the full Card Stage content width"
        : "A Card title backed by Y.Text",
    });
    if (rich) replaceYTextWithPortableRichText(card.title, RICH_TITLE);
    return card;
  });

  useEffect(
    () => () => cardDocument.document.destroy(),
    [cardDocument],
  );

  return (
    <div className="min-h-screen bg-token-main-surface-primary px-10 py-16">
      <div className="mx-auto w-full max-w-(--card-stage-body-max-width)">
        <CollaborativeCardTitle
          title={cardDocument.title}
          surfaceWriteFence={frozen ? FROZEN_STORY_FENCE : undefined}
        />
        <p className="mt-2 text-sm text-token-description-foreground">
          {frozen
            ? "Editing is briefly paused while this Card moves between documents."
            : "This story uses the same Y.Text input and local-only undo path as a collaborative Card surface."}
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: "Card Stage/Collaborative Card Title",
  component: CollaborativeCardTitleStory,
  parameters: { layout: "fullscreen" },
  render: () => <CollaborativeCardTitleStory />,
} satisfies Meta<typeof CollaborativeCardTitleStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RichFormattingAndAtoms: Story = {
  render: () => <CollaborativeCardTitleStory rich />,
};

export const LongWrappingTitle: Story = {
  render: () => <CollaborativeCardTitleStory long />,
};

export const RelocationFrozen: Story = {
  render: () => <CollaborativeCardTitleStory frozen />,
};
