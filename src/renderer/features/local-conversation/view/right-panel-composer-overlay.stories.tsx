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
  visibilityPolicy:
    | "always"
    | "controlled"
    | "browser-auto"
    | "controlled-browser-auto";
  initiallyVisible: boolean;
  draft: "empty" | "long-line" | "multiline";
  bottomPanelOpen: boolean;
  atDocumentBottom: boolean;
  running: boolean;
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
  visibilityPolicy,
  initiallyVisible,
  draft,
  bottomPanelOpen,
  atDocumentBottom,
  running,
}: RightPanelComposerOverlayStoryProps) {
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const [controlledVisible, setControlledVisible] = useState(initiallyVisible);
  const baseFooterModel = buildStoryFooterModel(running);
  const draftPrompt = draft === "long-line"
    ? "This single logical line is deliberately long enough to exceed the compact overlay row, so the shared composer promotes it into the normal prompt-above-controls layout without requiring an explicit newline."
    : draft === "multiline"
      ? Array.from(
          { length: 24 },
          (_, index) => `Multiline composer regression line ${index + 1}`,
        ).join("\n")
      : null;
  const footerModel = draftPrompt
    ? {
        ...baseFooterModel,
        composerIntent: {
          prompt: draftPrompt,
          focusNonce: 1,
        },
      }
    : baseFooterModel;
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
                <span>The pane remains independently interactive beneath the floating composer.</span>
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
              compact: tabKind === "browser",
              visibility: visibilityPolicy === "always"
                ? { kind: "always" }
                : visibilityPolicy === "controlled"
                  ? {
                      kind: "controlled",
                      visible: controlledVisible,
                      attention: running ? "activity" : "none",
                      onVisibleChange: setControlledVisible,
                    }
                  : visibilityPolicy === "controlled-browser-auto"
                    ? {
                        kind: "controlled-browser-auto",
                        visible: controlledVisible,
                        attention: running ? "activity" : "none",
                        onVisibleChange: setControlledVisible,
                        documentBottomKey: "story-browser",
                        isAtDocumentBottom: atDocumentBottom,
                      }
                  : {
                      kind: "browser-auto",
                      documentBottomKey: "story-browser",
                      isAtDocumentBottom: atDocumentBottom,
                    },
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
    visibilityPolicy: "controlled",
    initiallyVisible: true,
    draft: "empty",
    bottomPanelOpen: false,
    atDocumentBottom: false,
    running: false,
  },
  argTypes: {
    tabKind: {
      control: "inline-radio",
      options: ["review", "browser"],
    },
    visibilityPolicy: {
      control: "inline-radio",
      options: [
        "always",
        "controlled",
        "browser-auto",
        "controlled-browser-auto",
      ],
    },
    initiallyVisible: {
      control: false,
      table: { disable: true },
    },
    draft: {
      control: "inline-radio",
      options: ["empty", "long-line", "multiline"],
    },
  },
} satisfies Meta<typeof RightPanelComposerOverlayStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const FullWidthReview: Story = {
  parameters: {
    docs: {
      description: {
        story: "The latest-turn preview starts after the user intro, keeps completed assistant actions visible, and holds the attachment-free composer to one 44px control row.",
      },
    },
  },
};

export const FullWidthBrowser: Story = {
  args: {
    tabKind: "browser",
    visibilityPolicy: "controlled-browser-auto",
  },
};

export const HiddenSessionDock: Story = {
  args: {
    initiallyVisible: false,
  },
  parameters: {
    docs: {
      description: {
        story: "A persisted hidden Session composer releases its pane reserve and leaves the shared reveal handle available.",
      },
    },
  },
};

export const ControlledProjectDock: Story = {
  args: {
    visibilityPolicy: "controlled",
  },
  parameters: {
    docs: {
      description: {
        story: "The Project Agent Dock uses externally persisted visibility, releases its pane reserve while hidden, and keeps a quiet restore handle.",
      },
    },
  },
};

export const FullWidthMultilineDraft: Story = {
  args: {
    draft: "multiline",
  },
  parameters: {
    docs: {
      description: {
        story: "A draft with explicit line breaks uses the prompt row as the only overflowing region while the control row stays fixed inside the composer surface.",
      },
    },
  },
};

export const FullWidthVisuallyWrappedDraft: Story = {
  args: {
    draft: "long-line",
  },
  parameters: {
    docs: {
      description: {
        story: "A single logical line that no longer fits beside the compact controls promotes into the same normal multiline composer used by a Session.",
      },
    },
  },
};

export const BrowserAtDocumentBottom: Story = {
  args: {
    tabKind: "browser",
    visibilityPolicy: "browser-auto",
    atDocumentBottom: true,
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
