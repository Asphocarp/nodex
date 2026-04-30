import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import { selectConversationTurnRequestsByTurnId } from "../conversation-request-helpers";
import { buildTurnRenderModel } from "../projection/build-turn-render-model";
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
  buildThreadStageStorySurfaceModels,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "./thread-stage-story-fixtures";

const STORY_CONTROLS: ThreadStageStoryControls = {
  preset: "background-activity",
  permissionMode: "auto",
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
    onResolvePlanImplementationRequest: async () => { },
    onEnqueueQueuedFollowUp: async () => { },
    onRemoveQueuedFollowUp: async () => { },
    onReorderQueuedFollowUps: async () => { },
    onSendQueuedFollowUpNow: async () => { },
    onEditQueuedFollowUp: async () => { },
    onEditLastUserTurn: async () => { },
    onForkFromTurn: async () => { },
    onOpenTurnDiffReview: () => { },
    onConsumeComposerIntent: () => { },
    onOpenThread: () => { },
    onCleanBackgroundTerminals: async () => { },
    onOpenCard: () => { },
  };
}

function resolveStoryAboveComposerBlocks(
  model: ReturnType<typeof buildThreadStageStorySurfaceModels>,
) {
  const activeTurnId = model.bodyModel.body.activeTurnId;
  const conversation = model.footerModel.conversation;
  if (!activeTurnId || !conversation) return [];

  const activeTurn = conversation.turns.find((turn) => turn.turnId === activeTurnId);
  if (!activeTurn) return [];

  const turnRequestsByTurnId = selectConversationTurnRequestsByTurnId(conversation);

  return buildTurnRenderModel({
    turn: activeTurn,
    requests: turnRequestsByTurnId.get(activeTurnId) ?? [],
    isLatestTurn: model.bodyModel.body.latestTurnId === activeTurnId,
    isStreamingTurn: true,
    canEditTurnUserPrefix: false,
    canForkTurn: false,
  }).aboveComposerBlocks ?? [];
}

function buildShellModel(customize?: (model: ReturnType<typeof buildThreadStageStorySurfaceModels>) => ReturnType<typeof buildThreadStageStorySurfaceModels>) {
  const scenario = buildThreadStageStoryScenario(STORY_CONTROLS);
  const model = buildThreadStageStorySurfaceModels(scenario, STORY_CONTROLS, scenario.runtime);
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

  return buildThreadStageStorySurfaceModels(scenario, controls, {
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
  model?: ReturnType<typeof buildThreadStageStorySurfaceModels>;
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
            blocks={resolveStoryAboveComposerBlocks(model)}
            isLatestTurn={model.bodyModel.body.latestTurnId === model.bodyModel.body.activeTurnId}
            isStreamingTurn={true}
            projectWorkspacePath={model.bodyModel.projectWorkspacePath}
            threadCwd={model.footerModel.conversation?.cwd ?? null}
          />
          <LocalConversationComposerShell
            model={model.footerModel}
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
    footerModel: {
      ...current.footerModel,
      composerShell: {
        ...current.footerModel.composerShell,
        activeRequest: null,
        backgroundRequest: null,
        backgroundAgentRows: [],
        backgroundTerminalRows: [],
        showRequestCards: false,
        showComposer: true,
        showApprovalMode: false,
      },
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

function NarrowRequestCardsStory() {
  return (
    <div className="max-w-[390px]">
      <AboveComposerStoryFrame
        model={buildShellModel()}
        title="Request Cards Narrow"
        description="Narrow-width parity story verifying request cards replace composer controls while the lower status strip wraps cleanly instead of being covered."
      />
    </div>
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
      "Focused parity story for the unified Codex-style composer shell: queued steers, queued follow-ups, background terminals, background agents, request cards, and the preserved lower status strip are rendered by one shell instead of split footer surfaces.",
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

export const RequestCardsNarrow: Story = {
  args: {
    title: "Request Cards Narrow",
    description:
      "Narrow-width parity story verifying request cards replace composer controls while the lower status strip wraps cleanly instead of being covered.",
  },
  render: () => <NarrowRequestCardsStory />,
};
