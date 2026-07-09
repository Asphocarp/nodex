import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { History, SquareKanban, X } from "lucide-react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { AppShellTabs, type AppShellTabItem } from "./app-shell-tabs";

const meta = {
  title: "Workbench/App shell tabs",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <AppShellTabsStory />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

interface StorySessionTab {
  id: string;
  title: string;
  contextLabel?: string;
  customTooltip?: boolean;
}

function AppShellTabsStory({ showInsertionPreview = false }: { showInsertionPreview?: boolean }) {
  const [activeTabId, setActiveTabId] = useState("session:2");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessionTabs, setSessionTabs] = useState<StorySessionTab[]>([
    { id: "session:1", title: "Inbox triage and project notes" },
    { id: "session:2", title: "Codex-parity card stage tab bar", customTooltip: true },
    { id: "session:3", title: "Release checklist", contextLabel: "Codex readable" },
    {
      id: "session:4",
      title: "Long title that fades at the trailing edge",
      contextLabel: "Very long project label",
    },
    { id: "session:5", title: "Follow-up prompts" },
    { id: "session:6", title: "Calendar polish" },
  ]);

  const tabs: AppShellTabItem[] = [
    ...sessionTabs.map((tab) => ({
      ...tab,
      title: historyOpen && tab.id === activeTabId ? "History" : tab.title,
      contextLabel: tab.contextLabel,
      titleLabel: tab.contextLabel ? `${tab.contextLabel} project, ${tab.title}` : undefined,
      icon: historyOpen && tab.id === activeTabId ? History : SquareKanban,
      closable: true,
      reorderable: true,
      splittable: true,
      tooltip: tab.customTooltip ? (
        <div className="flex max-w-80 flex-col gap-1">
          <div className="truncate font-medium">
            {historyOpen && tab.id === activeTabId ? `History | ${tab.title}` : tab.title}
          </div>
          <div className="text-xs text-token-description-foreground">Design System / {tab.id}</div>
        </div>
      ) : undefined,
      renderPanel: () => (
        historyOpen && tab.id === activeTabId ? (
          <div className="grid h-full grid-cols-[18rem_1fr] text-sm text-token-foreground">
            <aside className="border-r border-token-border p-3 text-token-description-foreground">
              Embedded card history
            </aside>
            <section className="p-4">History renders as a second state of the active card tab.</section>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
            {tab.title}
          </div>
        )
      ),
    })),
  ];

  return (
    <NodexTooltipProvider>
      <div className="h-screen bg-token-main-surface-primary text-token-foreground">
        <AppShellTabs
          tabs={tabs}
          activeTabId={activeTabId}
          panelTabDnd={showInsertionPreview ? {
            sessionId: "storybook-session",
            panelId: "right",
            leafId: "storybook-leaf",
            activeDragId: "session:2",
            previewIntent: {
              kind: "tab-row",
              panelId: "right",
              leafId: "storybook-leaf",
              targetIndex: 3,
              markerLeft: 438,
            },
          } : undefined}
          onSelect={(tabId) => {
            setHistoryOpen(false);
            setActiveTabId(tabId);
          }}
          onCloseTab={(tabId) => {
            if (historyOpen && tabId === activeTabId) {
              setHistoryOpen(false);
              return;
            }
            setSessionTabs((current) => current.filter((tab) => tab.id !== tabId));
            if (activeTabId === tabId) {
              setActiveTabId(sessionTabs.find((tab) => tab.id !== tabId)?.id ?? "");
            }
          }}
        />
      </div>
    </NodexTooltipProvider>
  );
}

export const CardStageTabs: Story = {};

export const InsertionPreview: Story = {
  render: () => <AppShellTabsStory showInsertionPreview />,
};

export const ResponsiveEqualWidths: Story = {
  render: () => <ResponsiveEqualWidthsStory />,
};

function ResponsiveEqualWidthsStory() {
  const [activeTabId, setActiveTabId] = useState("equal:short");
  const tabs = [
    { id: "equal:short", title: "Review" },
    { id: "equal:medium", title: "Implementation plan" },
    { id: "equal:long", title: "Browser research with a much longer page title" },
  ].map((tab) => makeRapidCloseStoryTab(tab));

  return (
    <NodexTooltipProvider>
      <div className="h-screen bg-token-main-surface-primary text-token-foreground">
        <div className="h-full w-[30rem] border-r border-token-border">
          <AppShellTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onCloseTab={() => undefined}
          />
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

export const RapidCloseEqualWidths: Story = {
  render: () => <RapidCloseEqualWidthsStory />,
};

function RapidCloseEqualWidthsStory() {
  const [activeTabId, setActiveTabId] = useState("rapid:planning");
  const [sessionTabs, setSessionTabs] = useState<StorySessionTab[]>([
    { id: "rapid:planning", title: "Weekly planning and project inbox" },
    { id: "rapid:review", title: "Review" },
    { id: "rapid:browser", title: "Browser research with a much longer page title" },
    { id: "rapid:files", title: "Files" },
    { id: "rapid:terminal", title: "Terminal" },
    { id: "rapid:notes", title: "Implementation notes and follow-up prompts" },
  ]);
  const tabs: AppShellTabItem[] = [
    ...sessionTabs.slice(0, 3).map((tab) => makeRapidCloseStoryTab(tab)),
    {
      id: "rapid:history",
      title: "History",
      icon: History,
      closable: false,
      isLabel: true,
      reorderable: false,
      renderPanel: () => (
        <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
          History
        </div>
      ),
    },
    ...sessionTabs.slice(3).map((tab) => makeRapidCloseStoryTab(tab)),
  ];

  return (
    <NodexTooltipProvider>
      <div className="h-screen bg-token-main-surface-primary text-token-foreground">
        <div className="h-full w-[30rem] border-r border-token-border">
          <AppShellTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onCloseTab={(tabId) => {
              setSessionTabs((current) => current.filter((tab) => tab.id !== tabId));
              setActiveTabId((current) => {
                if (current !== tabId) return current;
                const nextTabs = sessionTabs.filter((tab) => tab.id !== tabId);
                return nextTabs[0]?.id ?? "rapid:history";
              });
            }}
          />
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

function makeRapidCloseStoryTab(tab: StorySessionTab): AppShellTabItem {
  return {
    ...tab,
    icon: SquareKanban,
    closable: true,
    reorderable: true,
    splittable: true,
    renderPanel: () => (
      <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
        {tab.title}
      </div>
    ),
  };
}

export const CardStagePreviewTab: Story = {
  render: () => {
    const tabs: AppShellTabItem[] = [
      {
        id: "db-view",
        title: "DB View",
        icon: SquareKanban,
        closable: true,
        reorderable: true,
        splittable: true,
        renderPanel: () => (
          <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
            Kanban board
          </div>
        ),
      },
      {
        id: "tab:card-stage-preview-story",
        title: "Workbench tab preview polish",
        icon: SquareKanban,
        closable: true,
        preview: true,
        reorderable: false,
        renderPanel: () => (
          <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary text-token-foreground">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-token-border px-3">
              <span className="text-sm font-medium">Workbench tab preview polish</span>
              <button
                type="button"
                data-app-shell-preview-pin-suppressed="true"
                className="inline-flex size-7 items-center justify-center rounded-md text-token-description-foreground hover:bg-token-main-surface-tertiary hover:text-token-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-token-description-foreground">
              Card Stage preview
            </div>
          </div>
        ),
      },
    ];

    return (
      <NodexTooltipProvider>
        <div className="h-screen bg-token-main-surface-primary text-token-foreground">
          <AppShellTabs
            tabs={tabs}
            activeTabId="tab:card-stage-preview-story"
            onSelect={() => undefined}
            onCloseTab={() => undefined}
            onPinTab={() => undefined}
            onMoveTab={() => undefined}
            onSplitTab={() => undefined}
          />
        </div>
      </NodexTooltipProvider>
    );
  },
};

const retainedCardStageNotes = [
  "Preserve the discussion around the database view cache boundary.",
  "Keep the card editor mounted when switching between right-panel card tabs.",
  "Flush draft and scroll snapshots on deactivation for fallback restores.",
  "Avoid measuring hidden session content through global panel refs.",
  "Keep browser webview visibility owned by the browser manager.",
  "Use the summary rows only for sidebar selection and labels.",
  "Let board freshness follow project events, mutation recovery, and manual refresh.",
  "Keep scroll retention local to the renderer hot state.",
  "Retain only the bounded MRU sessions to avoid unbounded memory growth.",
  "Restore DB View scroll before paint when the tab remounts.",
  "Let Card Stage tab switches use the browser's native mounted scroll state.",
  "Park inactive retained tabs with visibility and inert semantics.",
];

export const RetainedCardStageTabs: Story = {
  render: () => <RetainedCardStageTabsStory />,
};

function RetainedCardStageTabsStory() {
  const [activeTabId, setActiveTabId] = useState("retained:planning");
  const tabs: AppShellTabItem[] = [
    makeRetainedCardStageStoryTab({
      id: "retained:planning",
      title: "Session hot switch plan",
      accent: "bg-sky-500",
    }),
    makeRetainedCardStageStoryTab({
      id: "retained:editor",
      title: "Card editor scroll draft",
      accent: "bg-emerald-500",
    }),
  ];

  return (
    <NodexTooltipProvider>
      <div className="h-screen bg-token-main-surface-primary text-token-foreground">
        <AppShellTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onCloseTab={() => undefined}
          onPinTab={() => undefined}
          onMoveTab={() => undefined}
          onSplitTab={() => undefined}
        />
      </div>
    </NodexTooltipProvider>
  );
}

function makeRetainedCardStageStoryTab({
  id,
  title,
  accent,
}: {
  id: string;
  title: string;
  accent: string;
}): AppShellTabItem {
  return {
    id,
    title,
    icon: SquareKanban,
    closable: true,
    reorderable: true,
    splittable: true,
    retentionMode: "layout",
    renderPanel: (_closeTab, { active }) => (
      <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary text-token-foreground">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-token-border px-3">
          <span className={`size-2 rounded-full ${accent}`} aria-hidden="true" />
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="ml-auto text-xs text-token-description-foreground">
            {active ? "Active" : "Retained"}
          </span>
        </div>
        <div className="scrollbar-token min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <div className="rounded-lg border border-token-border bg-token-main-surface-secondary p-4">
              <div className="text-xs font-medium uppercase text-token-description-foreground">
                Card Stage body
              </div>
              <div className="mt-2 text-lg font-semibold">{title}</div>
              <p className="mt-2 text-sm leading-6 text-token-description-foreground">
                Scroll this panel, switch to the other retained card tab, then return. The panel stays
                mounted and keeps native scroll without waiting for a fallback restore.
              </p>
            </div>
            {retainedCardStageNotes.map((note) => (
              <div key={`${id}:${note}`} className="rounded-md border border-token-border p-4">
                <div className="text-sm leading-6 text-token-foreground">{note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  };
}

export const ContextMenuTabStates: Story = {
  render: () => {
    const tabs: AppShellTabItem[] = [
      {
        id: "browser",
        title: "Browser",
        icon: SquareKanban,
        closable: true,
        reorderable: true,
        splittable: true,
        contextMenuItems: [
          {
            id: "browser-new-tab-right",
            label: "New tab to the right",
            onSelect: () => undefined,
          },
          {
            id: "browser-reload",
            label: "Reload",
            onSelect: () => undefined,
          },
          {
            id: "browser-duplicate",
            label: "Duplicate",
            onSelect: () => undefined,
          },
        ],
        renderPanel: () => (
          <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
            Browser surface
          </div>
        ),
      },
      {
        id: "preview",
        title: "Files",
        icon: History,
        closable: true,
        preview: true,
        reorderable: false,
        renderPanel: () => (
          <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
            Files preview
          </div>
        ),
      },
      {
        id: "review",
        title: "Review",
        icon: SquareKanban,
        closable: true,
        reorderable: true,
        splittable: true,
        renderPanel: () => (
          <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
            Review surface
          </div>
        ),
      },
      {
        id: "history",
        title: "History",
        icon: History,
        isLabel: true,
        closable: false,
        reorderable: false,
        renderPanel: () => (
          <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">
            History surface
          </div>
        ),
      },
    ];

    return (
      <NodexTooltipProvider>
        <div className="h-screen bg-token-main-surface-primary text-token-foreground">
          <AppShellTabs
            tabs={tabs}
            activeTabId="browser"
            onSelect={() => undefined}
            onCloseTab={() => undefined}
            onPinTab={() => undefined}
            onMoveTab={() => undefined}
            onSplitTab={() => undefined}
          />
        </div>
      </NodexTooltipProvider>
    );
  },
};
