import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions } from "../thread-stage-types";
import { LocalConversationComposerShell } from "./composer/local-conversation-composer-shell";
import {
  LocalConversationAboveComposerPortal,
  LocalConversationAboveComposerPortalHost,
  LocalConversationAboveComposerQueuePortalHost,
} from "./local-conversation-above-composer-portal";
import {
  buildStoryConversation,
  buildStoryConversationItem,
  buildStoryConversationTurn,
  buildThreadStageStoryModel,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "./thread-stage-story-fixtures";

const STORY_CONTROLS: ThreadStageStoryControls = {
  preset: "background-activity",
  permissionMode: "sandbox",
  authenticatedAccount: true,
  isQueueingEnabled: false,
  collapseAgentBody: false,
};

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: () => { },
    onModelChange: () => { },
    onReasoningEffortChange: () => { },
    onPermissionModeChange: () => { },
    onQueueingEnabledChange: () => { },
    onRefreshAccount: async () => {
      throw new Error("not implemented");
    },
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => { },
    onLogout: async () => { },
    onStartThreadForCard: async () => { },
    onSendPrompt: async () => { },
    onSteerPrompt: async () => { },
    onInterruptTurn: async () => { },
    onRespondApproval: async () => { },
    onRespondUserInput: async () => { },
    onRespondMcpElicitation: async () => { },
    onResolvePlanImplementationRequest: () => { },
    onEnqueueQueuedFollowUp: async () => { },
    onRemoveQueuedFollowUp: async () => { },
    onReorderQueuedFollowUps: async () => { },
    onSendQueuedFollowUpNow: async () => { },
    onEditQueuedFollowUp: async () => { },
    onEditLastUserTurn: async () => { },
    onForkFromTurn: async () => { },
    onConsumeComposerIntent: () => { },
    onOpenThread: () => { },
    onCleanBackgroundTerminals: async () => { },
    onOpenCard: () => { },
  };
}

function buildShellModel(customize?: (model: ReturnType<typeof buildThreadStageStoryModel>) => ReturnType<typeof buildThreadStageStoryModel>) {
  const scenario = buildThreadStageStoryScenario(STORY_CONTROLS);
  const model = buildThreadStageStoryModel(scenario, STORY_CONTROLS, scenario.runtime);
  return customize ? customize(model) : model;
}

function buildPortalTasksAndFileChangesModel() {
  const controls: ThreadStageStoryControls = {
    ...STORY_CONTROLS,
    preset: "streaming",
  };
  const scenario = buildThreadStageStoryScenario(controls);
  const conversation = buildStoryConversation({
    statusType: "active",
    turns: [
      buildStoryConversationTurn({
        turnId: "turn_story_portal",
        status: "inProgress",
        items: [
          buildStoryConversationItem({
            turnId: "turn_story_portal",
            itemId: "user_story_portal",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Fix context compaction parity and keep the above-composer portal aligned with Codex Electron.",
            createdAt: 10_000,
            updatedAt: 10_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_portal",
            itemId: "todo_story_portal",
            type: "plan",
            kind: "plan",
            semanticKind: "todoList",
            status: "inProgress",
            markdownText: [
              "1. Inspect current context compaction flow across main, session replay, renderer, stories, and Codex Electron reference",
              "2. Implement missing main/session parity and any renderer/storybook wiring needed",
              "3. Add or update tests and docs, run checks, and commit the changes",
            ].join("\n"),
            rawItem: {
              plan: [
                {
                  step: "Inspect current context compaction flow across main, session replay, renderer, stories, and Codex Electron reference",
                  status: "in_progress",
                },
                {
                  step: "Implement missing main/session parity and any renderer/storybook wiring needed",
                  status: "pending",
                },
                {
                  step: "Add or update tests and docs, run checks, and commit the changes",
                  status: "pending",
                },
              ],
            },
            createdAt: 11_000,
            updatedAt: 11_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_portal",
            itemId: "turn_diff_story_portal",
            type: "turn_diff",
            kind: "systemEvent",
            semanticKind: "diff",
            rawItem: {
              type: "turn-diff",
              cwd: "/workspace/nodex",
              unifiedDiff: [
                "--- a/src/main/codex/codex-service.ts",
                "+++ b/src/main/codex/codex-service.ts",
                "@@ -1 +1 @@",
                "-old",
                "+new",
                "--- a/src/main/codex/codex-session-store.ts",
                "+++ b/src/main/codex/codex-session-store.ts",
                "@@ -1 +1 @@",
                "-old",
                "+new",
                "--- a/src/renderer/features/local-conversation/view/shared/thread-transcript-specials.stories.tsx",
                "+++ b/src/renderer/features/local-conversation/view/shared/thread-transcript-specials.stories.tsx",
                "@@ -1 +1 @@",
                "-old",
                "+new",
                "--- a/docs/product-specs/codex-thread-transcript-behavior.md",
                "+++ b/docs/product-specs/codex-thread-transcript-behavior.md",
                "@@ -1 +1 @@",
                "-old",
                "+new",
              ].join("\n"),
            },
            createdAt: 12_000,
            updatedAt: 12_000,
          }),
        ],
      }),
    ],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    requests: [],
  });

  return buildThreadStageStoryModel(scenario, controls, {
    ...scenario.runtime,
    activeThreadId: conversation.threadId,
    activeThreadSummary: conversation,
    conversation,
    knownConversationsById: {
      [conversation.threadId]: conversation,
    },
  });
}

function AboveComposerStoryFrame({
  model = buildShellModel(),
  title,
  description,
}: {
  model?: ReturnType<typeof buildThreadStageStoryModel>;
  title: string;
  description: string;
}) {
  return (
    <div className="relative flex min-h-[320px] flex-col rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">{title}</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">{description}</div>
      </div>
      <TooltipProvider>
        <div className="flex-1" />
        <div className="px-panel z-10 mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col pb-2">
          <LocalConversationAboveComposerPortalHost />
          <LocalConversationAboveComposerQueuePortalHost />
          <LocalConversationAboveComposerPortal
            blocks={model.body.aboveComposerBlocks ?? []}
            isLatestTurn={model.body.latestTurnId === model.body.activeTurnId}
            isStreamingTurn={true}
            projectWorkspacePath={model.projectWorkspacePath}
            threadCwd={model.conversation?.cwd ?? null}
          />
          <LocalConversationComposerShell
            model={model}
            actions={buildActions()}
            errorMessage={null}
            onErrorMessage={() => { }}
          />
        </div>
      </TooltipProvider>
    </div>
  );
}
function QueueRowsOnlyStory() {
  const model = buildShellModel((current) => ({
    ...current,
    composerShell: {
      ...current.composerShell,
      activeRequest: null,
      backgroundRequest: null,
      backgroundAgentRows: [],
      backgroundTerminalRows: [],
      showRequestCards: false,
      showComposer: true,
      showApprovalMode: false,
    },
  }));

  return (
    <AboveComposerStoryFrame
      model={model}
      title="Queue Lane"
      description="Focused parity story for the Codex Electron queue lane row primitives: pending steer, queued message actions, and the narrowed above-composer shell width without background panels."
    />
  );
}

const meta = {
  title: "Workbench/Threads/Above Composer",
  component: AboveComposerStoryFrame,
  parameters: {
    docs: {
      description: {
        component:
          "Focused parity story for the Codex-style composer shell. The scene is built from the real thread-stage projection model and uses the same shell that renders queue rows, background activity, and live request cards in production.",
      },
    },
  },
} satisfies Meta<typeof AboveComposerStoryFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const QueueLane: Story = {
  args: {
    title: "Composer Shell",
    description:
      "Focused parity story for the unified Codex-style composer shell: queued steers, queued follow-ups, background terminals, background agents, and request cards are rendered by one shell instead of split footer surfaces.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const QueueRowsOnly: Story = {
  args: {
    title: "Queue Lane",
    description:
      "Focused parity story for the Codex Electron queue lane row primitives: pending steer, queued message actions, and the narrowed above-composer shell width without background panels.",
  },
  render: () => <QueueRowsOnlyStory />,
};

export const FileChangesAndTasksInPortal: Story = {
  args: {
    model: buildPortalTasksAndFileChangesModel(),
    title: "File Changes And Tasks In Portal",
    description:
      "Debug fixture for the Codex Electron portal shape where the active turn lifts both the todo/tasks card and the files-changed banner into the fixed above-composer portal while the queue lane stays empty.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};
