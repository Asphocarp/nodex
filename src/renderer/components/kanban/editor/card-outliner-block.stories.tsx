import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import * as Y from "yjs";
import {
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "../../../../shared/block-documents";
import {
  CardOutlinerBodySkeleton,
  CardOutlinerRow,
} from "@/components/block-documents/card-outliner-surface";
import { CollaborativeCardTitle } from "@/components/block-documents/collaborative-card-title";
import { PortableRichTitle } from "@/components/block-documents/portable-rich-title";

const RICH_TITLE: PortableRichText = [
  { type: "text", text: "Ship ", styles: {} },
  { type: "text", text: "Card-as-Page", styles: { bold: true } },
  { type: "text", text: " outliner", styles: {} },
  { type: "threadMention", uuid: "019f4b50-35af-7153-b195-c8a7a0e7058c" },
];

type OutlinerStoryState =
  | "available"
  | "loading"
  | "error"
  | "missing"
  | "archived"
  | "cycle";

function CardOutlinerStory({
  state = "available",
  initiallyExpanded = false,
  initiallyEditing = false,
  showNestedCard = false,
}: {
  readonly state?: OutlinerStoryState;
  readonly initiallyExpanded?: boolean;
  readonly initiallyEditing?: boolean;
  readonly showNestedCard?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [editing, setEditing] = useState(initiallyEditing);
  const [nestedExpanded, setNestedExpanded] = useState(false);
  const [titleDocument] = useState(() => {
    const document = new Y.Doc({ guid: "card-outliner-story" });
    replaceYTextWithPortableRichText(document.getText("title"), RICH_TITLE);
    return document;
  });
  const available =
    state === "available" || state === "loading" || state === "error";
  const expandable = available;
  const stateLabel =
    state === "available"
      ? null
      : state === "loading"
        ? "Loading"
        : state === "error"
          ? "Unavailable"
          : state === "missing"
            ? "Missing"
            : state === "archived"
              ? "Archived"
              : "Cycle";

  return (
    <main className="min-h-screen bg-token-bg-primary p-8 text-token-text-primary">
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-xs text-token-description-foreground">
          Child Card · no Database membership · independent target Document
        </p>
        <div className="nfm-editor">
          <div className="bn-block-group">
            <div className="bn-block">
              <div
                className="bn-block-content"
                data-content-type="cardRef"
              >
                <CardOutlinerRow
                  targetBlockId="card-outliner-story"
                  projectId="nodex"
                  plainTitle="Ship Card-as-Page outliner"
                  title={
                    (expanded || editing) && state === "available" ? (
                      <CollaborativeCardTitle
                        title={titleDocument.getText("title")}
                        className="px-0 py-0 text-[1em] leading-6 font-normal"
                        onFocus={() => setEditing(true)}
                        onBlur={() => {
                          if (!expanded) setEditing(false);
                        }}
                      />
                    ) : state === "missing" ? (
                      "Card unavailable"
                    ) : (
                      <PortableRichTitle value={RICH_TITLE} />
                    )
                  }
                  stateLabel={stateLabel}
                  expanded={expanded}
                  expandable={expandable}
                  active={(expanded || editing) && available}
                  onExpandedChange={setExpanded}
                  onOpenCard={() => undefined}
                >
                  {expanded && state === "loading" ? (
                    <CardOutlinerBodySkeleton />
                  ) : expanded && state === "error" ? (
                    <div
                      role="alert"
                      className="py-1 text-sm text-token-error-foreground"
                    >
                      Connection closed. Retry
                    </div>
                  ) : expanded && state === "available" ? (
                    <div className="space-y-1 py-1 text-base leading-6 text-token-text-primary">
                      <p>The Card body keeps its own Y.Doc and provider.</p>
                      {showNestedCard ? (
                        <CardOutlinerRow
                          targetBlockId="nested-card-outliner-story"
                          projectId="nodex"
                          plainTitle="Nested Card"
                          title="Nested Card"
                          expanded={nestedExpanded}
                          expandable
                          active={nestedExpanded}
                          onExpandedChange={setNestedExpanded}
                          onOpenCard={() => undefined}
                        >
                          <p>Nested body</p>
                        </CardOutlinerRow>
                      ) : null}
                      <p>
                        Its presentation still follows the host outliner rhythm.
                      </p>
                    </div>
                  ) : null}
                </CardOutlinerRow>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

const meta = {
  title: "Kanban/Block References/Card Outliner",
  component: CardOutlinerStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CardOutlinerStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
  args: { initiallyExpanded: true },
};

export const CollapsedEditing: Story = {
  args: { initiallyEditing: true },
  parameters: {
    docs: {
      description: {
        story: "The authoritative title stays editable while collapsed. Its first pointer activation preserves the clicked caret position; Cmd/Ctrl+Enter toggles this occurrence's body without leaving the title surface.",
      },
    },
  },
};

export const NestedDisclosureStates: Story = {
  args: { initiallyExpanded: true, showNestedCard: true },
  parameters: {
    docs: {
      description: {
        story: "The expanded parent and collapsed nested Card keep independent caret angles.",
      },
    },
  },
};

export const Loading: Story = {
  args: { state: "loading", initiallyExpanded: true },
};

export const Error: Story = {
  args: { state: "error", initiallyExpanded: true },
};

export const Missing: Story = {
  args: { state: "missing" },
};

export const Archived: Story = {
  args: { state: "archived" },
};

export const Cycle: Story = {
  args: { state: "cycle" },
};
