import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import {
  SideChatExpiredPanel,
  SideChatLoadingPanel,
  SideChatPlaceholderPanel,
} from "./workbench-shell";

function SideChatStoryFrame({
  children,
  height,
  width,
}: {
  children: ReactNode;
  height: number;
  width: number;
}) {
  return (
    <div
      className="overflow-hidden border border-token-border bg-token-main-surface-primary shadow-card-md"
      style={{ width, height }}
    >
      {children}
    </div>
  );
}

function ExpiredHarness() {
  const [recreateCount, setRecreateCount] = useState(0);
  return (
    <div className="relative h-full min-h-0">
      <SideChatExpiredPanel onRecreateSideChat={() => setRecreateCount((count) => count + 1)} />
      {recreateCount > 0 ? (
        <div className="absolute right-3 bottom-3 rounded-full border border-token-border bg-token-main-surface-primary px-2.5 py-1 text-xs text-token-text-secondary shadow-card-sm">
          Recreate requested
        </div>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Workbench/Side Chat",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Focused side-chat panel states for the right and bottom workbench panels. The live ready state uses the normal connected thread stage; these stories cover the renderer-local loading, expired, and legacy-placeholder panels.",
      },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const RightPanelLoading: Story = {
  render: () => (
    <SideChatStoryFrame width={420} height={560}>
      <SideChatLoadingPanel title="Side chat" />
    </SideChatStoryFrame>
  ),
};

export const BottomPanelLoading: Story = {
  render: () => (
    <SideChatStoryFrame width={840} height={280}>
      <SideChatLoadingPanel title="Side chat 2" />
    </SideChatStoryFrame>
  ),
};

export const Expired: Story = {
  render: () => (
    <SideChatStoryFrame width={420} height={560}>
      <ExpiredHarness />
    </SideChatStoryFrame>
  ),
};

export const CompatibilityPlaceholder: Story = {
  render: () => (
    <SideChatStoryFrame width={420} height={560}>
      <SideChatPlaceholderPanel onOpenSideChat={() => undefined} />
    </SideChatStoryFrame>
  ),
};
