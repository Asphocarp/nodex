import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { createCardDocument } from "../../../shared/block-documents";
import { CollaborativeCardTitle } from "./collaborative-card-title";

function CollaborativeCardTitleStory() {
  const [cardDocument] = useState(() =>
    createCardDocument({
      documentId: "storybook:collaborative-card-title",
      initialTitle: "A Card title backed by Y.Text",
    }),
  );

  useEffect(
    () => () => cardDocument.document.destroy(),
    [cardDocument],
  );

  return (
    <div className="min-h-screen bg-token-main-surface-primary px-10 py-16">
      <div className="mx-auto w-full max-w-(--card-stage-body-max-width)">
        <CollaborativeCardTitle title={cardDocument.title} />
        <p className="mt-2 text-sm text-token-description-foreground">
          This story uses the same Y.Text input and local-only undo path as a
          collaborative Card surface.
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
