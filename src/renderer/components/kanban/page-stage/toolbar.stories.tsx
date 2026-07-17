import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { PageStageToolbar } from "./toolbar";

const PAGE_OWNERSHIP_PATH = [
  { projectId: "nodex", pageId: "planning", title: "Planning" },
  { projectId: "nodex", pageId: "workbench", title: "Workbench" },
  { projectId: "nodex", pageId: "page-tabs", title: "Page tabs" },
  { projectId: "nodex", pageId: "navigation", title: "Navigation" },
  { projectId: "nodex", pageId: "breadcrumb", title: "Breadcrumb polish" },
] as const;

function NestedPageToolbarStory() {
  const [currentIndex, setCurrentIndex] = useState(PAGE_OWNERSHIP_PATH.length - 1);
  const current = PAGE_OWNERSHIP_PATH[currentIndex] ?? PAGE_OWNERSHIP_PATH[0];

  return (
    <NodexTooltipProvider>
      <div className="h-screen bg-token-main-surface-primary text-token-foreground">
        <PageStageToolbar
          saving={false}
          historyPanelActive={false}
          limitMainContentWidth={true}
          showRawContent={false}
          onCopyDeeplink={() => undefined}
          onDelete={() => undefined}
          onToggleContentWidth={() => undefined}
          onToggleShowRawContent={() => undefined}
          breadcrumb={{
            ancestors: PAGE_OWNERSHIP_PATH.slice(0, currentIndex),
            currentTitle: current.title,
            onOpenAncestor: (_ancestor, ancestorIndex) => {
              setCurrentIndex(ancestorIndex);
            },
          }}
        />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Kanban/Page Stage/Toolbar",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <NestedPageToolbarStory />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const CanonicalOwnershipBreadcrumb: Story = {};
