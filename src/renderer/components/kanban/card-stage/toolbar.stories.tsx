import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { CardStageToolbar } from "./toolbar";

const CARD_PATH = [
  { projectId: "nodex", cardId: "planning", title: "Planning" },
  { projectId: "nodex", cardId: "workbench", title: "Workbench" },
  { projectId: "nodex", cardId: "card-tabs", title: "Card tabs" },
  { projectId: "nodex", cardId: "navigation", title: "Navigation" },
  { projectId: "nodex", cardId: "breadcrumb", title: "Breadcrumb polish" },
] as const;

function NestedCardToolbarStory() {
  const [currentIndex, setCurrentIndex] = useState(CARD_PATH.length - 1);
  const current = CARD_PATH[currentIndex] ?? CARD_PATH[0];

  return (
    <NodexTooltipProvider>
      <div className="h-screen bg-token-main-surface-primary text-token-foreground">
        <CardStageToolbar
          saving={false}
          historyPanelActive={false}
          limitMainContentWidth={true}
          showRawContent={false}
          onCopyDeeplink={() => undefined}
          onDelete={() => undefined}
          onToggleContentWidth={() => undefined}
          onToggleShowRawContent={() => undefined}
          breadcrumb={{
            ancestors: CARD_PATH.slice(0, currentIndex),
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
  title: "Kanban/Card Stage/Toolbar",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <NestedCardToolbarStory />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const NestedCardBreadcrumb: Story = {};
