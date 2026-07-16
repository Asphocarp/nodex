import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import {
  createPageDocument,
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "../../../shared/block-documents";
import { CollaborativePageTitle } from "./collaborative-page-title";
import type { BlockDocumentSurfaceWriteFence } from "@/lib/block-document-surface-runtime";

const FROZEN_STORY_FENCE: BlockDocumentSurfaceWriteFence = {
  getWriteFrozen: () => true,
  subscribe: () => () => undefined,
  registerRelocationPreparer: () => () => undefined,
};

const RICH_TITLE: PortableRichText = [
  { type: "text", text: "Designing a ", styles: {} },
  { type: "text", text: "rich", styles: { bold: true, color: "blue" } },
  { type: "text", text: " Page title with ", styles: { italic: true } },
  { type: "link", text: "stable identity", href: "https://nodex.local", styles: {} },
  { type: "dateMention", start: "2026-07-14" },
];

function CollaborativePageTitleStory({
  frozen = false,
  rich = false,
  long = false,
}: {
  frozen?: boolean;
  rich?: boolean;
  long?: boolean;
}) {
  const [pageDocument] = useState(() => {
    const page = createPageDocument({
      documentId: "storybook:collaborative-page-title",
      initialTitle: long
        ? "A deliberately long Page title that demonstrates natural wrapping while preserving a dense, borderless editing surface across the full Page Stage content width"
        : "A Page title backed by Y.Text",
    });
    if (rich) replaceYTextWithPortableRichText(page.title, RICH_TITLE);
    return page;
  });

  useEffect(
    () => () => pageDocument.document.destroy(),
    [pageDocument],
  );

  return (
    <div className="min-h-screen bg-token-main-surface-primary px-10 py-16">
      <div className="mx-auto w-full max-w-(--page-stage-body-max-width)">
        <CollaborativePageTitle
          title={pageDocument.title}
          surfaceWriteFence={frozen ? FROZEN_STORY_FENCE : undefined}
        />
        <p className="mt-2 text-sm text-token-description-foreground">
          {frozen
            ? "Editing is briefly paused while this Page moves between documents."
            : "This story uses the same Y.Text input and local-only undo path as a collaborative Page surface."}
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: "Page Stage/Collaborative Page Title",
  component: CollaborativePageTitleStory,
  parameters: { layout: "fullscreen" },
  render: () => <CollaborativePageTitleStory />,
} satisfies Meta<typeof CollaborativePageTitleStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RichFormattingAndAtoms: Story = {
  render: () => <CollaborativePageTitleStory rich />,
};

export const LongWrappingTitle: Story = {
  render: () => <CollaborativePageTitleStory long />,
};

export const RelocationFrozen: Story = {
  render: () => <CollaborativePageTitleStory frozen />,
};
