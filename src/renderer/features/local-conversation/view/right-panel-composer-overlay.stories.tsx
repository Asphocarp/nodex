import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions } from "../thread-stage-types";
import { LocalConversationFooter } from "./local-conversation-footer";
import { EnsureLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";
import {
  buildThreadStageStoryScenario,
  buildThreadStageStorySurfaceModels,
  type ThreadStageStoryControls,
} from "./thread-stage-story-fixtures";

interface RightPanelComposerOverlayStoryProps {
  tabKind: "review" | "browser";
  bottomPanelOpen: boolean;
  running: boolean;
  reducedMotionPreview: boolean;
}

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: () => { },
    onModelChange: () => { },
    onReasoningEffortChange: () => { },
    onPermissionModeChange: () => { },
    onQueueingEnabledChange: () => { },
    onSendPrompt: async () => { },
    onSteerPrompt: async () => { },
    onInterruptTurn: async () => { },
    onRespondApproval: async () => { },
    onRespondUserInput: async () => { },
    onRespondMcpElicitation: async () => { },
    onResolvePlanImplementationRequest: async () => { },
    onEnqueueQueuedFollowUp: async () => { },
    onRemoveQueuedFollowUp: async () => { },
    onReorderQueuedFollowUps: async () => { },
    onSendQueuedFollowUpNow: async () => { },
    onEditQueuedFollowUp: async () => { },
    onEditLastUserTurn: async () => { },
    onForkFromTurn: async () => { },
    onUnarchiveThread: async () => { },
    onOpenTurnDiffReview: () => { },
    onConsumeComposerIntent: () => { },
    onOpenThread: () => { },
    onCleanBackgroundTerminals: async () => { },
  };
}

function buildStoryFooterModel(running: boolean) {
  const controls: ThreadStageStoryControls = {
    preset: running ? "streaming" : "background-activity",
    permissionMode: "auto",
    authenticatedAccount: true,
    isQueueingEnabled: false,
    collapseAgentBody: false,
  };
  const scenario = buildThreadStageStoryScenario(controls);
  return buildThreadStageStorySurfaceModels(
    scenario,
    controls,
    scenario.runtime,
  ).footerModel;
}

function RightPanelComposerOverlayStory({
  tabKind,
  bottomPanelOpen,
  running,
  reducedMotionPreview,
}: RightPanelComposerOverlayStoryProps) {
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const footerModel = buildStoryFooterModel(running);
  const title = tabKind === "review" ? "Review" : "Browser";
  const bodyLabel = tabKind === "review"
    ? "Diff and source scroll surface"
    : "Browser viewport surface";

  return (
    <TooltipProvider>
      <EnsureLocalConversationThreadScrollController>
        <div
          className="relative h-[760px] overflow-hidden rounded-xl border border-token-border bg-token-main-surface-primary text-token-foreground"
          style={{
            "--app-shell-bottom-panel-height": bottomPanelOpen ? "220px" : "0px",
          } as CSSProperties}
          data-reduced-motion-preview={reducedMotionPreview ? "true" : "false"}
        >
          <div
            ref={setOverlayHost}
            data-right-panel-composer-overlay-host="true"
            className="absolute inset-0 min-h-0 min-w-0 overflow-hidden bg-token-main-surface-primary"
          >
            <div className="draggable relative z-10 flex h-toolbar items-center gap-2 border-b border-token-border px-toolbar text-sm text-token-description-foreground">
              <span className="text-token-foreground">{title}</span>
              <span className="rounded-md bg-token-foreground/5 px-1.5 py-0.5 text-xs">
                full width
              </span>
            </div>
            <div className="absolute inset-x-0 top-[var(--height-toolbar)] bottom-0 overflow-auto px-toolbar py-4 text-sm text-token-description-foreground">
              <div className="flex min-h-[960px] flex-col gap-2 rounded-lg border border-dashed border-token-border/70 bg-token-foreground/3 p-3">
                <span>{bodyLabel}</span>
                <span>Scroll-padding consumes the overlay reserve variable.</span>
              </div>
            </div>
          </div>
          <LocalConversationFooter
            model={footerModel}
            actions={buildActions()}
            errorMessage={null}
            onErrorMessage={() => { }}
            rightPanelComposerOverlay={{
              enabled: overlayHost !== null,
              target: overlayHost,
            }}
          />
          {bottomPanelOpen ? (
            <div className="absolute inset-x-0 bottom-0 z-30 flex h-[220px] items-center border-t border-token-border bg-token-main-surface-primary px-toolbar text-sm text-token-description-foreground">
              Bottom panel
            </div>
          ) : null}
        </div>
      </EnsureLocalConversationThreadScrollController>
    </TooltipProvider>
  );
}

const meta = {
  title: "Local Conversation/Right Panel Composer Overlay",
  component: RightPanelComposerOverlayStory,
  args: {
    tabKind: "review",
    bottomPanelOpen: false,
    running: false,
    reducedMotionPreview: false,
  },
  argTypes: {
    tabKind: {
      control: "inline-radio",
      options: ["review", "browser"],
    },
  },
} satisfies Meta<typeof RightPanelComposerOverlayStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const FullWidthReview: Story = {};

export const FullWidthBrowser: Story = {
  args: {
    tabKind: "browser",
  },
};

export const FullWidthWithBottomPanel: Story = {
  args: {
    bottomPanelOpen: true,
  },
};

export const RunningThreadStop: Story = {
  args: {
    running: true,
  },
};

export const ReducedMotionFullWidth: Story = {
  args: {
    reducedMotionPreview: true,
  },
};
