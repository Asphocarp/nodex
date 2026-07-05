import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
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

function buildPortalContentModel({
  includeTodo = true,
  includeDiff = true,
}: {
  includeTodo?: boolean;
  includeDiff?: boolean;
} = {}) {
  const controls: ThreadStageStoryControls = {
    ...STORY_CONTROLS,
    preset: "streaming",
  };
  const scenario = buildThreadStageStoryScenario(controls);
  const portalItems = [
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
    ...(includeTodo
      ? [
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
        ]
      : []),
    ...(includeDiff
      ? [
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
        ]
      : []),
  ];
  const conversation = buildStoryConversation({
    statusType: "active",
    turns: [
      buildStoryConversationTurn({
        turnId: "turn_story_portal",
        status: "inProgress",
        items: portalItems,
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

function buildPortalTasksAndFileChangesModel() {
  return buildPortalContentModel({ includeTodo: true, includeDiff: true });
}

function buildPortalFileChangesOnlyModel() {
  return buildPortalContentModel({ includeTodo: false, includeDiff: true });
}

function buildPortalTasksOnlyModel() {
  return buildPortalContentModel({ includeTodo: true, includeDiff: false });
}

function buildQueueAndFileChangesModel() {
  const portalModel = buildPortalFileChangesOnlyModel();
  const queueModel = buildShellModel();

  return {
    ...portalModel,
    footerModel: {
      ...portalModel.footerModel,
      composerShell: {
        ...portalModel.footerModel.composerShell,
        pendingSteerRows: queueModel.footerModel.composerShell.pendingSteerRows,
        queuedFollowUpRows: queueModel.footerModel.composerShell.queuedFollowUpRows,
        backgroundAgentRows: queueModel.footerModel.composerShell.backgroundAgentRows,
        backgroundTerminalRows: queueModel.footerModel.composerShell.backgroundTerminalRows,
        showRequestCards: queueModel.footerModel.composerShell.showRequestCards,
      },
    },
  };
}

function buildLiveDraftedEditDiffModel({
  includeFileChange = false,
}: {
  includeFileChange?: boolean;
} = {}) {
  const controls: ThreadStageStoryControls = {
    ...STORY_CONTROLS,
    preset: "streaming",
  };
  const scenario = buildThreadStageStoryScenario(controls);
  const liveDraftDiff = [
    "--- a/src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx",
    "+++ b/src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx",
    "@@ -240,5 +240,14 @@",
    "-  return <div className=\"old\">Files changed</div>;",
    "+  return (",
    "+    <div",
    "+      className=\"bg-token-input-background/70 text-token-foreground border-token-border/80\"",
    "+      codex.turn_diff.state=\"in_progress\"",
    "+    >",
    "+      <span>1 file changed</span>",
    "+      <AnimatedDiffStats additions={8} deletions={1} />",
    "+    </div>",
    "+  );",
  ].join("\n");
  const conversation = buildStoryConversation({
    statusType: "active",
    turns: [
      buildStoryConversationTurn({
        turnId: "turn_story_live_draft_diff",
        status: "inProgress",
        diff: liveDraftDiff,
        items: [
          buildStoryConversationItem({
            turnId: "turn_story_live_draft_diff",
            itemId: "user_story_live_draft_diff",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Draft the implementation changes and show live generated edit lines before the fileChange item starts.",
            createdAt: 10_000,
            updatedAt: 10_000,
          }),
          ...(includeFileChange
            ? [
                buildStoryConversationItem({
                  turnId: "turn_story_live_draft_diff",
                  itemId: "patch_story_live_draft_diff",
                  type: "file_change",
                  kind: "fileChange",
                  semanticKind: "patch",
                  status: "inProgress",
                  fileChange: {
                    paths: ["src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx"],
                    changes: buildCodexFileChangeMap([{
                      type: "update",
                      path: "src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx",
                      unifiedDiff: liveDraftDiff,
                      movePath: null,
                    }]),
                    diffs: [liveDraftDiff],
                    label: "Edited src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx",
                  },
                  toolCall: {
                    subtype: "fileChange",
                    toolName: "file_change",
                    result: {
                      diff: liveDraftDiff,
                    },
                  },
                  createdAt: 11_000,
                  updatedAt: 11_000,
                }),
              ]
            : []),
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
        <div className="z-10 mx-auto flex w-full max-w-(--thread-content-max-width) flex-col px-toolbar pb-4">
          <div className="flex flex-col" data-thread-find-composer="true">
            <div className="relative h-0" data-thread-catch-up-control="true" />
            <div className="flex flex-col gap-2" data-thread-footer-stack="true">
              <LocalConversationAboveComposerPortalHost conversationId={model.footerModel.threadId} />
              <LocalConversationAboveComposerQueuePortalHost conversationId={model.footerModel.threadId} />
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
          </div>
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
        description="Narrow-width parity story verifying existing-thread request cards replace composer controls without rendering the new-chat-only lower status strip."
      />
    </div>
  );
}

function RightPanelOverlayNarrowStory() {
  return (
    <div className="max-w-[420px]">
      <AboveComposerStoryFrame
        model={buildPortalTasksAndFileChangesModel()}
        title="Right Panel Overlay Narrow"
        description="Narrow overlay fixture for the shared above-composer fixed layer, compact todo progress, and files-changed pill above the composer."
      />
    </div>
  );
}

function RightPanelOverlayWideStory() {
  return (
    <div className="max-w-[760px]">
      <AboveComposerStoryFrame
        model={buildPortalTasksAndFileChangesModel()}
        title="Right Panel Overlay Wide"
        description="Wide overlay fixture for the same ordered portal host, queue host, and composer stack used by the right-panel composer overlay."
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
      "Focused parity story for the unified Codex-style existing-thread composer shell: queued steers, queued follow-ups, background terminals, background agents, and request cards render without the new-chat-only lower status strip.",
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

export const FileChangesOnlyInPortal: Story = {
  args: {
    model: buildPortalFileChangesOnlyModel(),
    title: "File Changes Only In Portal",
    description:
      "Focused fixed-layer story for the active turn files-changed summary without todo progress or queue rows.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const TasksOnlyInPortal: Story = {
  args: {
    model: buildPortalTasksOnlyModel(),
    title: "Tasks Only In Portal",
    description:
      "Focused fixed-layer story for compact active-turn todo progress without a files-changed summary.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
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

export const QueueAndFileChangesInPortal: Story = {
  args: {
    model: buildQueueAndFileChangesModel(),
    title: "Queue And File Changes In Portal",
    description:
      "Combined fixture proving queue/background rows remain in the queue lane while files-changed renders in the fixed above-composer pill.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const LiveDraftedEditDiffBeforeFileChange: Story = {
  args: {
    model: buildLiveDraftedEditDiffModel(),
    title: "Live Drafted Edit Diff Before FileChange",
    description:
      "Parity fixture for Codex Electron's pre-tool-call turn/diff/updated path: the above-composer files-changed banner is derived from turn.diff before any fileChange row exists.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const LiveDraftedEditDiffWithFileChange: Story = {
  args: {
    model: buildLiveDraftedEditDiffModel({ includeFileChange: true }),
    title: "Live Drafted Edit Diff With FileChange",
    description:
      "Parity fixture for the live patchUpdated path: the fileChange row exists in the turn, but the active turn/diff files-changed pill remains in the fixed above-composer portal.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const RequestCardsNarrow: Story = {
  args: {
    title: "Request Cards Narrow",
    description:
      "Narrow-width parity story verifying existing-thread request cards replace composer controls without rendering the new-chat-only lower status strip.",
  },
  render: () => <NarrowRequestCardsStory />,
};

export const RightPanelOverlayNarrow: Story = {
  args: {
    title: "Right Panel Overlay Narrow",
    description:
      "Narrow overlay-width fixture for the ordered above-composer fixed layer and composer stack.",
  },
  render: () => <RightPanelOverlayNarrowStory />,
};

export const RightPanelOverlayWide: Story = {
  args: {
    title: "Right Panel Overlay Wide",
    description:
      "Wide overlay-width fixture for the ordered above-composer fixed layer and composer stack.",
  },
  render: () => <RightPanelOverlayWideStory />,
};
