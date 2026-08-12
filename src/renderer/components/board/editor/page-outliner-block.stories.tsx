import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import * as Y from "yjs";
import {
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "../../../../shared/block-documents";
import {
  PageOutlinerBodySkeleton,
  PageOutlinerRow,
} from "@/components/block-documents/page-outliner-surface";
import { CollaborativePageTitle } from "@/components/block-documents/collaborative-page-title";
import { PortableRichTitle } from "@/components/block-documents/portable-rich-title";

const RICH_TITLE: PortableRichText = [
  { type: "text", text: "Ship ", styles: {} },
  { type: "text", text: "Page-as-Page", styles: { bold: true } },
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

function PageOutlinerStory({
  state = "available",
  initiallyExpanded = false,
  initiallyEditing = false,
  showNestedPage = false,
}: {
  readonly state?: OutlinerStoryState;
  readonly initiallyExpanded?: boolean;
  readonly initiallyEditing?: boolean;
  readonly showNestedPage?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [editing, setEditing] = useState(initiallyEditing);
  const [nestedExpanded, setNestedExpanded] = useState(false);
  const [titleDocument] = useState(() => {
    const document = new Y.Doc({ guid: "page-outliner-story" });
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
          Child Page · no Database membership · independent target Document
        </p>
        <div className="nfm-editor">
          <div className="bn-block-group">
            <div className="bn-block">
              <div
                className="bn-block-content"
                data-content-type="pageRef"
              >
                <PageOutlinerRow
                  targetBlockId="page-outliner-story"
                  accessKind="project"
                  plainTitle="Ship Page-as-Page outliner"
                  title={
                    (expanded || editing) && state === "available" ? (
                      <CollaborativePageTitle
                        title={titleDocument.getText("title")}
                        className="px-0 py-0 text-[1em] leading-6 font-normal"
                        onFocus={() => setEditing(true)}
                        onBlur={() => {
                          if (!expanded) setEditing(false);
                        }}
                      />
                    ) : state === "missing" ? (
                      "Page unavailable"
                    ) : (
                      <PortableRichTitle value={RICH_TITLE} />
                    )
                  }
                  stateLabel={stateLabel}
                  expanded={expanded}
                  expandable={expandable}
                  active={(expanded || editing) && available}
                  onExpandedChange={setExpanded}
                  onOpenPage={() => undefined}
                >
                  {expanded && state === "loading" ? (
                    <PageOutlinerBodySkeleton />
                  ) : expanded && state === "error" ? (
                    <div
                      role="alert"
                      className="py-1 text-sm text-token-error-foreground"
                    >
                      Connection closed. Retry
                    </div>
                  ) : expanded && state === "available" ? (
                    <div className="space-y-1 py-1 text-base leading-6 text-token-text-primary">
                      <p>The Page body keeps its own Y.Doc and provider.</p>
                      {showNestedPage ? (
                        <PageOutlinerRow
                          targetBlockId="nested-page-outliner-story"
                          accessKind="project"
                          plainTitle="Nested Page"
                          title="Nested Page"
                          expanded={nestedExpanded}
                          expandable
                          active={nestedExpanded}
                          onExpandedChange={setNestedExpanded}
                          onOpenPage={() => undefined}
                        >
                          <p>Nested body</p>
                        </PageOutlinerRow>
                      ) : null}
                      <p>
                        Its presentation still follows the host outliner rhythm.
                      </p>
                    </div>
                  ) : null}
                </PageOutlinerRow>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

const meta = {
  title: "Board/Block References/Page Outliner",
  component: PageOutlinerStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PageOutlinerStory>;

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
  args: { initiallyExpanded: true, showNestedPage: true },
  parameters: {
    docs: {
      description: {
        story: "The expanded parent and collapsed nested Page keep independent caret angles.",
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
