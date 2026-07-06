import type { Meta, StoryObj } from "@storybook/react-vite";
import { MotionConfig } from "motion/react";
import type { CSSProperties } from "react";
import { BranchStatusIcon, LocalStatusIcon } from "@/components/shared/icons";
import { CODEX_SUMMARY_PANEL_WIDTH } from "@/lib/codex-panel-motion";
import type {
  CodexConversationChildMembership,
  CodexConversationSnapshot,
  CodexConversationTurn,
} from "@/lib/types";
import { ThreadFloatingSummaryPanel } from "./thread-floating-summary-panel";
import { ThreadSummaryPanelRow } from "./thread-summary-panel-row";
import { ThreadSummaryPanelSection } from "./thread-summary-panel-section";

const SUMMARY_PANEL_STORY_CHILD_MEMBERSHIPS: CodexConversationChildMembership[] = [
  {
    threadId: "summary-inline-scout",
    parentThreadId: "thread-story",
    role: "backgroundChild",
    actorName: "Scout",
    displayName: "Scout",
    agentRole: "explorer",
    showInlineActivity: true,
  },
  {
    threadId: "summary-inline-planner",
    parentThreadId: "thread-story",
    role: "backgroundChild",
    actorName: "Planner",
    displayName: "Planner",
    agentRole: null,
    showInlineActivity: true,
  },
  {
    threadId: "summary-inline-finisher",
    parentThreadId: "thread-story",
    role: "backgroundChild",
    actorName: "Finisher",
    displayName: "Finisher",
    agentRole: null,
    showInlineActivity: true,
  },
  {
    threadId: "summary-listed-reviewer",
    parentThreadId: "thread-story",
    role: "backgroundChild",
    actorName: "Reviewer",
    displayName: "Reviewer",
    agentRole: "reviewer",
    showInlineActivity: false,
  },
  {
    threadId: "summary-listed-waiting",
    parentThreadId: "thread-story",
    role: "backgroundChild",
    actorName: "Verifier",
    displayName: "Verifier",
    agentRole: null,
    showInlineActivity: false,
  },
];

function makeSummaryPanelStorySubagentConversation(input: {
  threadId: string;
  name: string;
  statusType: "active" | "idle" | "notLoaded";
  turns?: CodexConversationTurn[];
}): CodexConversationSnapshot {
  return {
    threadId: input.threadId,
    projectId: "project-story",
    projectName: "Story Project",
    title: input.name,
    threadName: input.name,
    threadPreview: input.name,
    agentNickname: input.name,
    agentRole: null,
    statusType: input.statusType,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    resumeState: "resumed",
    turns: input.turns ?? [],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canCollapseTurns: true,
      canEditLastUserTurn: true,
      canForkFromTurn: true,
      canSearch: true,
    },
  } as unknown as CodexConversationSnapshot;
}

const SUMMARY_PANEL_STORY_KNOWN_CONVERSATIONS: Record<string, CodexConversationSnapshot> = {
  "summary-inline-scout": makeSummaryPanelStorySubagentConversation({
    threadId: "summary-inline-scout",
    name: "Scout",
    statusType: "active",
  }),
  "summary-inline-planner": makeSummaryPanelStorySubagentConversation({
    threadId: "summary-inline-planner",
    name: "Planner",
    statusType: "notLoaded",
  }),
  "summary-inline-finisher": makeSummaryPanelStorySubagentConversation({
    threadId: "summary-inline-finisher",
    name: "Finisher",
    statusType: "idle",
  }),
  "summary-listed-reviewer": makeSummaryPanelStorySubagentConversation({
    threadId: "summary-listed-reviewer",
    name: "Reviewer",
    statusType: "active",
    turns: [{
      turnId: "summary-listed-reviewer-turn",
      status: "inProgress",
      diff: "@@ -1 +1,2 @@\n-old\n+new\n+another",
      items: [],
    }] as unknown as CodexConversationTurn[],
  }),
  "summary-listed-waiting": makeSummaryPanelStorySubagentConversation({
    threadId: "summary-listed-waiting",
    name: "Verifier",
    statusType: "notLoaded",
  }),
};

function SummaryPanelSurfaceStory({ noGit = false }: { noGit?: boolean }) {
  return (
    <div className="flex min-h-screen items-start justify-end bg-token-main-surface-primary p-10 text-token-text-primary">
      <div
        className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-token-border-default bg-token-dropdown-background pt-3 shadow-md select-none"
        style={{ width: CODEX_SUMMARY_PANEL_WIDTH }}
      >
        <div className="flex h-fit max-h-full min-h-0 flex-col gap-3 overflow-y-auto pb-3">
          <ThreadSummaryPanelSection title="Environment">
            <ThreadSummaryPanelRow
              label="Changes"
              trailing={<span className="text-size-chat text-token-text-tertiary">{noGit ? "No Git" : "+9,212 -4,412"}</span>}
              trailingVisible
              disabled={noGit}
              interactive={!noGit}
            />
            <ThreadSummaryPanelRow label="Local" icon={<LocalStatusIcon />} trailing={<span className="text-size-chat text-token-text-tertiary">Work locally</span>} trailingVisible />
            <ThreadSummaryPanelRow label="dev-redesign" icon={<BranchStatusIcon />} disabled={noGit} />
            <ThreadSummaryPanelRow label="Commit or push" disabled={noGit} interactive={!noGit} />
            <ThreadSummaryPanelRow label="Create pull request" disabled={noGit} interactive={!noGit} />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Progress">
            <ThreadSummaryPanelRow label="Inspect shell width math" />
            <ThreadSummaryPanelRow label="Wire summary panel rows" />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Outputs">
            <ThreadSummaryPanelRow label="thread-layout.tsx" title="src/renderer/features/local-conversation/view/thread-layout.tsx" />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Side chats">
            <ThreadSummaryPanelRow label="Investigate header edge" trailing={<span className="text-size-chat text-token-text-tertiary">Open</span>} trailingVisible />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Subagents">
            <ThreadSummaryPanelRow label="Layout parity agent" />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Background tasks">
            <ThreadSummaryPanelRow label="bun test" trailing={<span className="text-size-chat text-token-text-tertiary">3 pass</span>} trailingVisible />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Browser">
            <ThreadSummaryPanelRow label="Release notes" trailing={<span className="text-size-chat text-token-text-tertiary">Right panel</span>} trailingVisible />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Sources">
            <div className="flex flex-wrap gap-1.5 py-0.5" aria-label="Sources">
              <span className="inline-flex h-6 items-center gap-1 rounded-lg bg-token-foreground/5 px-2 text-size-chat text-token-foreground">
                <span className="size-1.5 shrink-0 rounded-full bg-token-text-link-foreground" aria-hidden="true" />
                Context7
              </span>
            </div>
          </ThreadSummaryPanelSection>
        </div>
      </div>
    </div>
  );
}

function FloatingSummaryPanelStory({
  open = true,
  reducedMotion = false,
  mode = "shift",
  stageWidth = 1180,
}: {
  open?: boolean;
  reducedMotion?: boolean;
  mode?: "gutter" | "shift" | "overlay";
  stageWidth?: number;
}) {
  const content = (
    <div className="flex min-h-screen items-start justify-end overflow-x-auto bg-token-main-surface-primary p-10 text-token-text-primary">
      <div
        className="relative h-[640px] w-full max-w-4xl overflow-hidden border border-token-border-default bg-(--background)"
        style={{
          "--thread-floating-content-top-inset": "48px",
          "--thread-floating-content-bottom-inset": "16px",
          width: `${stageWidth}px`,
          maxWidth: "100%",
        } as CSSProperties}
      >
        {mode === "overlay" ? (
          <div className="absolute top-3 right-3 z-10">
            <button
              type="button"
              className="h-8 rounded-md border border-token-border-default px-2 text-size-chat text-token-text-secondary"
            >
              Toggle summary
            </button>
          </div>
        ) : null}
        <ThreadFloatingSummaryPanel
          mounted
          open={open}
          activeThreadId="thread-story"
          cwd={null}
          projectWorkspacePath={null}
          turns={[]}
          childMemberships={SUMMARY_PANEL_STORY_CHILD_MEMBERSHIPS}
          knownConversationsById={SUMMARY_PANEL_STORY_KNOWN_CONVERSATIONS}
          sideChatRows={[{ id: "side-chat", title: "Investigate layout", status: "Open" }]}
          browserRows={[{ id: "browser", title: "Release notes", status: "Right panel" }]}
          onErrorMessage={() => undefined}
        />
      </div>
    </div>
  );

  if (!reducedMotion) return content;
  return <MotionConfig reducedMotion="always">{content}</MotionConfig>;
}

const meta = {
  title: "Workbench/Threads/Summary Panel",
  component: SummaryPanelSurfaceStory,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SummaryPanelSurfaceStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActiveThreadWithSources: Story = {};

export const NoGitRepository: Story = {
  args: {
    noGit: true,
  },
};

export const PinnedOverlaySurface: Story = {
  args: {},
  parameters: {
    docs: {
      description: {
        story: "Surface chrome used by the pinned floating summary overlay while the workbench right panel is collapsed.",
      },
    },
  },
};

export const FloatingPinnedShiftOpen: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory open />,
  parameters: {
    docs: {
      description: {
        story: "Pinned floating summary body in the Codex shift band; Workbench applies the companion -158px body/footer shift while this panel springs in from the right.",
      },
    },
  },
};

export const FloatingPinnedGutterOpen: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory mode="gutter" open />,
  parameters: {
    viewport: {
      defaultViewport: "desktop",
    },
    docs: {
      description: {
        story: "Pinned floating summary body in gutter mode, where the panel is visible without shifting thread content.",
      },
    },
  },
};

export const Viewport1902SidebarOpenGutter: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory mode="gutter" stageWidth={1602} open />,
  parameters: {
    docs: {
      description: {
        story: "Acceptance state for a 1902px shell with a 300px left sidebar and no right panel: effective thread width is 1602px, so the summary panel stays pinned in gutter mode.",
      },
    },
  },
};

export const Viewport1801SidebarOpenShift: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory mode="shift" stageWidth={1501} open />,
  parameters: {
    docs: {
      description: {
        story: "Acceptance state for a 1801px shell with a 300px left sidebar and no right panel: effective thread width is 1501px, so the summary panel stays pinned and shifts the body/footer by -158px.",
      },
    },
  },
};

export const Viewport1598SidebarRightPanelOverlay: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory mode="overlay" stageWidth={950} open={false} />,
  parameters: {
    docs: {
      description: {
        story: "Acceptance state for a 1598px shell with the left sidebar and a right panel competing for space: effective thread width falls below 1096px, so the mounted inline panel animates closed while the header trigger controls the popover.",
      },
    },
  },
};

export const FloatingPinnedClosingReducedMotion: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory open={false} reducedMotion />,
  parameters: {
    docs: {
      description: {
        story: "Reduced-motion close state: the Codex summary body snaps to opacity 0, translateX(100%), and scale 0.8 without a spring.",
      },
    },
  },
};
