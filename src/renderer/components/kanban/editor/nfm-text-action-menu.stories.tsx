import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { TextActionLinkIcon } from "@/components/shared/icons";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { CommandPaletteThread } from "@/lib/command-palette";
import type { BoardSummary, DatabasePageSummary, CodexThreadSummary, Project } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import { writeTextActionRecentColors } from "@/lib/text-action-color-recents";
import { NfmMoveToMenuSurface } from "./nfm-move-to-menu";
import { writeNfmSendToThreadMode } from "./nfm-send-to-thread-mode-settings";
import { NfmSendToThreadMenuSurface } from "./nfm-send-to-thread-menu";
import { NfmTextActionMenuSurface, type NfmTextActionMenuSurfaceProps } from "./nfm-text-action-menu";
import { NfmSideMenuSurface } from "./nfm-side-menu";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  moveNfmSideMenuFocus,
  type NfmSideMenuSubmenuKey,
} from "./nfm-side-menu-model";

const STORY_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeStoryProject(id: string, name: string, icon?: string): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name,
    description: "",
    appearance: icon
      ? { color: "black", marker: { kind: "emoji", emoji: icon } }
      : { color: "black", marker: { kind: "icon", icon: "folder" } },
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: STORY_DATE,
    updated: STORY_DATE,
  };
}

function makeStoryCard(id: string, title: string, status: DatabasePageSummary["status"], order: number): DatabasePageSummary {
  return {
    id,
    status,
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    tags: [],
    created: STORY_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

function makeStoryThread(input: Partial<CodexThreadSummary> & { threadId: string }): CodexThreadSummary {
  return {
    threadId: input.threadId,
    projectId: input.projectId ?? "default",
    source: null,
    ephemeral: input.ephemeral ?? false,
    threadName: input.threadName ?? null,
    threadPreview: input.threadPreview ?? "",
    modelProvider: input.modelProvider ?? "openai",
    cwd: input.cwd ?? "/Users/asc/repo/nodex2",
    approvalPolicy: input.approvalPolicy ?? null,
    approvalsReviewer: input.approvalsReviewer ?? null,
    sandbox: input.sandbox ?? null,
    statusType: input.statusType ?? "idle",
    statusActiveFlags: input.statusActiveFlags ?? [],
    archived: input.archived ?? false,
    createdAt: input.createdAt ?? STORY_DATE.getTime(),
    updatedAt: input.updatedAt ?? STORY_DATE.getTime(),
    linkedAt: input.linkedAt ?? STORY_DATE.toISOString(),
  };
}

function storyThreadSummaryToItem(thread: CodexThreadSummary): CommandPaletteThread {
  const title = thread.threadName?.trim()
    || thread.threadPreview.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
    || thread.threadId;
  return {
    kind: "thread",
    id: `thread:${thread.threadId}`,
    threadId: thread.threadId,
    sessionId: null,
    projectId: thread.projectId,
    projectName: thread.projectId ? "Default" : null,
    title,
    preview: thread.threadPreview,
    cwd: thread.cwd,
    gitBranch: null,
    projectless: thread.projectId === null,
    pinned: false,
    pinnedOrder: null,
    statusType: thread.statusType,
    statusActiveFlags: thread.statusActiveFlags,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    inActiveProject: thread.projectId === "default",
  };
}

const STORY_MOVE_TO_PROJECTS = [
  makeStoryProject("default", "Default", "🔥"),
  makeStoryProject("renderer", "Renderer parity", "🧭"),
];

const STORY_MOVE_TO_BOARD_MAP = new Map<string, BoardSummary>([
  [
    "default",
    {
      columns: [
        {
          id: "triage",
          name: "Triage",
          cards: [
            makeStoryCard("source-card", "Source card", "triage", 0),
            makeStoryCard("target-card", "Target card", "triage", 1),
          ],
        },
      ],
    },
  ],
  [
    "renderer",
    {
      columns: [
        {
          id: "plan",
          name: "Plan",
          cards: [makeStoryCard("runtime", "Runtime polish", "plan", 0)],
        },
      ],
    },
  ],
]);

const STORY_SEND_TO_THREAD_SUMMARIES = [
  makeStoryThread({
    threadId: "thread-implementation",
    threadName: "Implementation pass",
    threadPreview: "Wiring the selected NFM blocks into a Codex turn.",
    updatedAt: STORY_DATE.getTime() + 3,
  }),
  makeStoryThread({
    threadId: "thread-review",
    threadName: "Review follow-up",
    threadPreview: "Check the generated toggle and mention serialization.",
    statusActiveFlags: ["waitingOnApproval"],
    updatedAt: STORY_DATE.getTime() + 2,
  }),
  makeStoryThread({
    threadId: "thread-empty-title",
    threadName: null,
    threadPreview: "Untitled thread preview fallback",
    updatedAt: STORY_DATE.getTime() + 1,
  }),
];

const STORY_SEND_TO_THREAD_THREADS = STORY_SEND_TO_THREAD_SUMMARIES.map(storyThreadSummaryToItem);

function TextActionMenuStorySurface(
  props: Partial<NfmTextActionMenuSurfaceProps>,
) {
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
        <NfmTextActionMenuSurface
          currentBlockTypeLabel="Normal Text"
          blockTypeItems={[
            {
              key: "paragraph",
              label: "Normal Text",
              type: "paragraph",
              isSelected: true,
            },
            {
              key: "heading-1",
              label: "Heading 1",
              type: "heading",
              props: { level: 1, isToggleable: false },
              isSelected: false,
            },
            {
              key: "heading-2",
              label: "Heading 2",
              type: "heading",
              props: { level: 2, isToggleable: false },
              isSelected: false,
            },
          ]}
          activeStyles={{
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            code: false,
          }}
          textColor="default"
          backgroundColor="default"
          canUseTextColor={true}
          canUseBackgroundColor={true}
          canClearFormat={true}
          linkControl={(
            <button
              type="button"
              aria-label="Link"
              className="flex h-7 w-8 items-center justify-center rounded-[6px] text-token-foreground hover:bg-token-list-hover-background"
            >
              <TextActionLinkIcon />
            </button>
          )}
          nodexRows={[]}
          showReferenceMocks
          sourceProjectId={null}
          sourcePageId={null}
          onSelectBlockType={() => undefined}
          onToggleStyle={() => undefined}
          onSetTextColor={() => undefined}
          onSetBackgroundColor={() => undefined}
          onClearFormat={() => undefined}
          onOpenBlockActions={() => undefined}
          onNodexRow={() => undefined}
          onMoveBlocksToDestination={() => undefined}
          {...props}
        />
      </div>
    </NodexTooltipProvider>
  );
}

function TextActionMoreHandoffStorySurface() {
  const [showBlockActions, setShowBlockActions] = useState(false);
  const [showFocusedBlockSelection, setShowFocusedBlockSelection] = useState(false);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [activeSubmenu, setActiveSubmenu] = useState<NfmSideMenuSubmenuKey | null>(null);
  const baseSections = useMemo(() => buildNfmSideMenuSections({
    currentBlockId: "block-1",
    currentBlockType: "paragraph",
    selectionTitle: "2 blocks",
    selectedTopLevelBlockCount: 2,
    isEditable: true,
    canUseColor: true,
    canSendBlocks: true,
    hasConvertDividerToThreadSection: false,
    isTableBlock: false,
    canUseTableHeaders: false,
    showMockActions: true,
  }), []);
  const sections = useMemo(() => filterNfmSideMenuSections(baseSections, query), [baseSections, query]);
  const flatRows = useMemo(() => flattenNfmSideMenuRows(sections), [sections]);

  return (
    <NodexTooltipProvider>
      <div className="relative flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
        <div
          aria-label="Selected block scope preview"
          className="pointer-events-none absolute top-8 left-8 w-72 space-y-1 rounded-lg border-[0.5px] border-token-border bg-token-background/80 p-2 text-sm shadow-sm"
        >
          {["Selected paragraph block", "Selected follow-up block"].map((label) => (
            <div
              key={label}
              className={[
                "rounded-[6px] px-2 py-1.5",
                showFocusedBlockSelection
                  ? "bg-token-charts-blue/20 text-token-foreground ring-[0.5px] ring-token-charts-blue/40"
                  : "bg-token-foreground/5 text-token-description-foreground",
              ].join(" ")}
            >
              {label}
            </div>
          ))}
        </div>
        {showBlockActions ? (
          <NfmSideMenuSurface
            sections={sections}
            query={query}
            focusedIndex={focusedIndex}
            activeSubmenu={activeSubmenu}
            listboxId="text-action-more-handoff-listbox"
            comboboxId="text-action-more-handoff-combobox"
            activeDescendantId={focusedIndex >= 0 ? `text-action-more-handoff-listbox-option-${focusedIndex}` : undefined}
            turnIntoItems={[
              { key: "paragraph", label: "Text", type: "paragraph", enabled: true },
              { key: "heading-1", label: "Heading 1", type: "heading", props: { level: 1, isToggleable: false }, enabled: true },
              { key: "bullet-list", label: "Bulleted list", type: "bulletListItem", enabled: true },
            ]}
            colorOptions={[
              { color: "default", label: "Default" },
              { color: "blue", label: "Blue" },
              { color: "yellow", label: "Yellow" },
            ]}
            canUseTextColor={true}
            canUseBackgroundColor={true}
            canSendBlocks={true}
            sourceProjectId="default"
            sourcePageId="source-card"
            textColor="default"
            backgroundColor="default"
            footerPrimary="Selected text spans two blocks"
            footerSecondary="More opens block actions"
            onQueryChange={(nextQuery) => {
              setQuery(nextQuery);
              setFocusedIndex(nextQuery ? 0 : -1);
            }}
            onFocusIndexChange={setFocusedIndex}
            onMoveFocus={(direction) => {
              setFocusedIndex((currentIndex) => moveNfmSideMenuFocus(currentIndex, direction, flatRows));
            }}
            onActivateFocused={() => undefined}
            onClose={() => {
              setShowBlockActions(false);
              setShowFocusedBlockSelection(true);
            }}
            onAction={(row) => {
              if (row.submenu) {
                setActiveSubmenu(row.submenu);
                return;
              }
              setShowFocusedBlockSelection(false);
            }}
            onSubmenuChange={setActiveSubmenu}
            onTurnInto={() => setShowFocusedBlockSelection(false)}
            onColor={() => setShowFocusedBlockSelection(false)}
            onMoveBlocksToDestination={() => {
              setShowFocusedBlockSelection(false);
            }}
            renderMoveToMenu={(props) => (
              <NfmMoveToMenuSurface
                {...props}
                projects={STORY_MOVE_TO_PROJECTS}
                boardMap={STORY_MOVE_TO_BOARD_MAP}
                loading={false}
                loadError={null}
              />
            )}
          />
        ) : (
          <NfmTextActionMenuSurface
            currentBlockTypeLabel="Normal Text"
            blockTypeItems={[
              {
                key: "paragraph",
                label: "Normal Text",
                type: "paragraph",
                isSelected: true,
              },
            ]}
            activeStyles={{
              bold: false,
              italic: false,
              underline: false,
              strike: false,
              code: false,
            }}
            textColor="default"
            backgroundColor="default"
            canUseTextColor={true}
            canUseBackgroundColor={true}
            canClearFormat={true}
            linkControl={(
              <button
                type="button"
                aria-label="Link"
                className="flex h-7 w-8 items-center justify-center rounded-[6px] text-token-foreground hover:bg-token-list-hover-background"
              >
                <TextActionLinkIcon />
              </button>
            )}
            nodexRows={[
              {
                key: "move-to",
                label: "Move to",
                enabled: true,
              },
            ]}
            showReferenceMocks
            sourceProjectId="default"
            sourcePageId="source-card"
            onSelectBlockType={() => undefined}
            onToggleStyle={() => undefined}
            onSetTextColor={() => undefined}
            onSetBackgroundColor={() => undefined}
            onClearFormat={() => undefined}
            onOpenBlockActions={() => {
              setShowFocusedBlockSelection(false);
              setShowBlockActions(true);
            }}
            onNodexRow={() => undefined}
            onMoveBlocksToDestination={() => undefined}
          />
        )}
      </div>
    </NodexTooltipProvider>
  );
}

function CollapsedCursorNoToolbarStorySurface() {
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
        <div className="w-[34rem] rounded-lg border-[0.5px] border-token-border bg-token-background/80 px-5 py-4 text-[15px] leading-7 shadow-sm">
          <p className="text-token-foreground">
            Schedule follow-up after reviewing the release notes
            <span
              aria-hidden="true"
              className="mx-0.5 inline-block h-5 w-px translate-y-1 bg-token-charts-blue"
            />
            with the team.
          </p>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Kanban/Editor/Text Action Menu",
  component: TextActionMenuStorySurface,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Floating text action menu for expanded NFM rich-text selections. Its exit transition preserves the final open geometry even when the selected content is deleted, while globally portalled action tooltips remain above the editor-owned menu layer.",
      },
    },
  },
} satisfies Meta<typeof TextActionMenuStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ActiveMarks: Story = {
  args: {
    activeStyles: {
      bold: true,
      italic: true,
      underline: false,
      strike: true,
      code: false,
    },
    textColor: "blue",
    backgroundColor: "yellow",
  },
};

export const TextColorMenu: Story = {
  args: {
    textColor: "blue",
    backgroundColor: "yellow",
  },
  render: (args) => {
    writeTextActionRecentColors([
      { kind: "text", color: "blue" },
      { kind: "text", color: "pink" },
      { kind: "background", color: "red" },
      { kind: "background", color: "purple" },
      { kind: "background", color: "green" },
    ]);

    return <TextActionMenuStorySurface {...args} />;
  },
  parameters: {
    docs: {
      description: {
        story: "Open the Color button to inspect the 190px Notion-style swatch grid with five persisted recent color slots.",
      },
    },
  },
};

export const WithNodexActions: Story = {
  args: {
    nodexRows: [
      {
        key: "send-to-thread",
        label: "Send to chat",
        enabled: true,
      },
      {
        key: "move-to",
        label: "Move to",
        enabled: true,
      },
    ],
    sourceProjectId: "default",
    sourcePageId: "source-card",
    sendToThreadProjectNameById: { default: "Default" },
    sendToThreadPreferredTarget: STORY_SEND_TO_THREAD_SUMMARIES[0]
      ? {
          kind: "thread",
          thread: STORY_SEND_TO_THREAD_SUMMARIES[0],
          meta: "This session",
        }
      : null,
    onSendBlocksToThread: () => undefined,
    renderSendToThreadMenu: (props) => (
      <NfmSendToThreadMenuSurface
        {...props}
        threadItems={STORY_SEND_TO_THREAD_THREADS}
        enableThreadSearch={false}
      />
    ),
    renderMoveToMenu: (props) => (
      <NfmMoveToMenuSurface
        {...props}
        projects={STORY_MOVE_TO_PROJECTS}
        boardMap={STORY_MOVE_TO_BOARD_MAP}
        loading={false}
        loadError={null}
      />
    ),
  },
  parameters: {
    docs: {
      description: {
        story: "Send to chat and Move to fit without a bottom fade; hovering or focusing either row keeps this action menu stable, and clicking opens its destination picker.",
      },
    },
  },
};

export const SendToThreadPicker: Story = {
  render: () => {
    writeNfmSendToThreadMode("wrap-toggle");

    return (
      <NodexTooltipProvider>
        <div className="flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
          <NfmSendToThreadMenuSurface
            projectId="default"
            threadItems={STORY_SEND_TO_THREAD_THREADS}
            enableThreadSearch={false}
            projectNameById={{ default: "Default" }}
            preferredTarget={STORY_SEND_TO_THREAD_SUMMARIES[0]
              ? {
                  kind: "thread",
                  thread: STORY_SEND_TO_THREAD_SUMMARIES[0],
                  meta: "This session",
                }
              : null}
            initialQuery="implementation"
            onAccept={() => undefined}
            onClose={() => undefined}
          />
        </div>
      </NodexTooltipProvider>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Direct send-to-chat picker coverage for thread search, the selected-block current session hint, the bottom New chat action, the persisted Send / Send & wrap selector, and the wrap info tooltip.",
      },
    },
  },
};

export const SendToThreadPickerEmptySession: Story = {
  render: () => (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
        <NfmSendToThreadMenuSurface
          projectId="default"
          threadItems={STORY_SEND_TO_THREAD_THREADS}
          enableThreadSearch={false}
          projectNameById={{ default: "Default" }}
          preferredTarget={{
            kind: "new-thread",
            sessionId: "session-current",
            meta: "This session",
          }}
          onAccept={() => undefined}
          onClose={() => undefined}
        />
      </div>
    </NodexTooltipProvider>
  ),
  parameters: {
    docs: {
      description: {
        story: "Selected-block send picker coverage for an empty current session: New chat is the first row with This session meta and the project-level footer action is not duplicated.",
      },
    },
  },
};

export const SendToThreadPickerThreadSection: Story = {
  render: () => (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
        <NfmSendToThreadMenuSurface
          projectId="default"
          threadItems={STORY_SEND_TO_THREAD_THREADS}
          enableThreadSearch={false}
          projectNameById={{ default: "Default" }}
          preferredTarget={STORY_SEND_TO_THREAD_SUMMARIES[1]
            ? {
                kind: "thread",
                thread: STORY_SEND_TO_THREAD_SUMMARIES[1],
                meta: "Current section",
              }
            : null}
          showModeSelector={false}
          onAccept={() => undefined}
          onClose={() => undefined}
        />
      </div>
    </NodexTooltipProvider>
  ),
  parameters: {
    docs: {
      description: {
        story: "Thread-section send picker coverage where the bound section chat is the preferred first row and New chat remains fixed at the bottom.",
      },
    },
  },
};

export const SendToThreadPickerEmpty: Story = {
  render: () => (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
        <NfmSendToThreadMenuSurface
          projectId="default"
          threadItems={[]}
          enableThreadSearch={false}
          initialQuery="no matches"
          onAccept={() => undefined}
          onClose={() => undefined}
        />
      </div>
    </NodexTooltipProvider>
  ),
  parameters: {
    docs: {
      description: {
        story: "Empty search state keeps the bottom New chat action available while explaining that no existing threads matched.",
      },
    },
  },
};

export const DividerBlockActions: Story = {
  args: {
    currentBlockTypeLabel: "Divider",
    nodexRows: [
      {
        key: "convert-divider-to-thread-section",
        label: "Make thread section",
        enabled: true,
      },
    ],
  },
};

export const DisabledReferenceMocks: Story = {
  args: {
    canUseTextColor: false,
    canUseBackgroundColor: false,
    canClearFormat: false,
  },
};

export const MoreHandoffToBlockActions: Story = {
  render: () => <TextActionMoreHandoffStorySurface />,
  parameters: {
    docs: {
      description: {
        story: "Click More to replace the text-selection toolbar with the block side-menu action surface; dismissing it returns focus to the editor with the selected block scope still active.",
      },
    },
  },
};

export const CollapsedCursorNoToolbar: Story = {
  render: () => <CollapsedCursorNoToolbarStorySurface />,
  parameters: {
    docs: {
      description: {
        story: "Collapsed rich-text cursor state: the NFM floating toolbar remains closed instead of falling back to the legacy formatting toolbar.",
      },
    },
  },
};
