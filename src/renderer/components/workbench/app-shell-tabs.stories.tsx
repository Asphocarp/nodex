import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { History, SquareKanban } from "lucide-react";
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

function AppShellTabsStory({ showInsertionPreview = false }: { showInsertionPreview?: boolean }) {
  const [activeTabId, setActiveTabId] = useState("session:2");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessionTabs, setSessionTabs] = useState([
    { id: "session:1", title: "Inbox triage and project notes" },
    { id: "session:2", title: "Codex-parity card stage tab bar" },
    { id: "session:3", title: "Release checklist" },
    { id: "session:4", title: "Long title that fades at the trailing edge" },
    { id: "session:5", title: "Follow-up prompts" },
    { id: "session:6", title: "Calendar polish" },
  ]);

  const tabs: AppShellTabItem[] = [
    ...sessionTabs.map((tab) => ({
      ...tab,
      title: historyOpen && tab.id === activeTabId ? "History" : tab.title,
      icon: historyOpen && tab.id === activeTabId ? History : SquareKanban,
      closable: true,
      reorderable: true,
      splittable: true,
      tooltip: (
        <div className="flex max-w-80 flex-col gap-1">
          <div className="truncate font-medium">
            {historyOpen && tab.id === activeTabId ? `History | ${tab.title}` : tab.title}
          </div>
          <div className="text-xs text-token-description-foreground">Design System / {tab.id}</div>
        </div>
      ),
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
