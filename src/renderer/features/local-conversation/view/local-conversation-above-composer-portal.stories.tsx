import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2";
import { useEffect } from "react";
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

type GoalStoryInteraction = "expand-objective" | "open-edit-dialog";

interface GoalStatusRowStoryOptions {
  status?: ThreadGoal["status"];
  objective?: string;
  tokenBudget?: number | null;
  tokensUsed?: number;
  timeUsedSeconds?: number;
}

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
    onSetThreadGoal: async () => null,
    onClearThreadGoal: async () => { },
    onDismissThreadGoalResumeConfirmation: async () => { },
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

function buildGoalResumeConfirmationModel() {
  return buildShellModel((current) => {
    const threadId = current.footerModel.threadId;
    const conversation = current.footerModel.conversation;
    if (!threadId || !conversation) return current;

    const goal: ThreadGoal = {
      threadId,
      objective: "Finish goal parity with the Codex Electron resume prompt and keep the thread moving while idle.",
      status: "paused",
      tokenBudget: null,
      tokensUsed: 42,
      timeUsedSeconds: 120,
      createdAt: 1,
      updatedAt: 2,
    };

    return {
      ...current,
      footerModel: {
        ...current.footerModel,
        conversation: {
          ...conversation,
          threadGoal: goal,
          threadGoalResumeConfirmation: goal,
        },
      },
    };
  });
}

function buildGoalStatusRowModel(input: ThreadGoal["status"] | GoalStatusRowStoryOptions = "active") {
  const options: GoalStatusRowStoryOptions = typeof input === "string" ? { status: input } : input;
  return buildShellModel((current) => {
    const threadId = current.footerModel.threadId;
    const conversation = current.footerModel.conversation;
    if (!threadId || !conversation) return current;
    const status = options.status ?? "active";

    const goal: ThreadGoal = {
      threadId,
      objective: options.objective ?? [
        "Drive the second research pass into a full implementation-ready parity package.",
        "Keep API contracts, continuation state, UI layout, and fixture gaps synchronized until another agent can reproduce the feature from the docs.",
      ].join(" "),
      status,
      tokenBudget: options.tokenBudget ?? 400000,
      tokensUsed: options.tokensUsed ?? 124000,
      timeUsedSeconds: options.timeUsedSeconds ?? 3665,
      createdAt: 1,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    return {
      ...current,
      footerModel: {
        ...current.footerModel,
        conversation: {
          ...conversation,
          threadGoal: goal,
          threadGoalResumeConfirmation: null,
        },
      },
    };
  });
}

function buildGoalLongObjectiveModel() {
  return buildGoalStatusRowModel({
    status: "active",
    tokenBudget: null,
    timeUsedSeconds: 3665,
    objective: [
      "Drive `/goal` parity until the implementation is reproducible from local docs alone.",
      "",
      "Acceptance:",
      "1. Preserve the request and notification contract for get, set, clear, updated, and cleared.",
      "2. Keep the composer footer chip, above-composer row, replacement confirmation, edit dialog, and resume confirmation aligned with the reference hierarchy.",
      "3. Continue active goals only after idle status and only when no pending stream, request, steer, or runtime work is in progress.",
      "4. Materialize long objectives, pasted text, and image references before storing the goal.",
      "5. Update the parity ledger whenever a source-only inference becomes a verified implementation detail.",
    ].join("\n"),
  });
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
                    changes: buildCodexFileChangeMap([{
                      type: "update",
                      path: "src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx",
                      unifiedDiff: liveDraftDiff,
                      movePath: null,
                    }]),
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
  goalInteraction = null,
}: {
  model?: ReturnType<typeof buildThreadStageStorySurfaceModels>;
  title: string;
  description: string;
  goalInteraction?: GoalStoryInteraction | null;
}) {
  useEffect(() => {
    if (!goalInteraction) return undefined;

    let cancelled = false;
    const targetLabel = goalInteraction === "open-edit-dialog" ? "Edit goal" : "Show full goal";
    const attemptInteraction = (remainingAttempts: number) => {
      if (cancelled) return;

      const target = document.querySelector<HTMLButtonElement>(`button[aria-label="${targetLabel}"]`);
      if (target) {
        target.click();
        return;
      }

      if (remainingAttempts <= 0) return;
      window.setTimeout(() => {
        attemptInteraction(remainingAttempts - 1);
      }, 50);
    };

    const timer = window.setTimeout(() => {
      attemptInteraction(10);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [goalInteraction, model.footerModel.threadId]);

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
            <div className="flex flex-col" data-thread-footer-stack="true">
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

export const GoalResumeConfirmation: Story = {
  args: {
    model: buildGoalResumeConfirmationModel(),
    title: "Goal Resume Confirmation",
    description:
      "Focused story for the Codex-compatible paused-goal resume confirmation dialog mounted from the production composer shell.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalStatusRow: Story = {
  args: {
    model: buildGoalStatusRowModel(),
    title: "Goal Status Row",
    description:
      "Focused story for the saved-goal row mounted in the above-composer queue portal: status label, objective, token progress, and edit/pause/clear controls use the production composer shell.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalStatusPaused: Story = {
  args: {
    model: buildGoalStatusRowModel({
      status: "paused",
      tokenBudget: null,
      timeUsedSeconds: 120,
    }),
    title: "Goal Status Paused",
    description:
      "Paused saved-goal row with elapsed time and resume/clear/edit controls, matching the non-active status surface.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalStatusBlocked: Story = {
  args: {
    model: buildGoalStatusRowModel({
      status: "blocked",
      tokenBudget: null,
      timeUsedSeconds: 3665,
      objective: "Unblock goal parity by resolving the runtime contract question before continuing implementation.",
    }),
    title: "Goal Status Blocked",
    description:
      "Blocked saved-goal row with the Goal blocked label and resume action exposed from the production row.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalStatusUsageLimited: Story = {
  args: {
    model: buildGoalStatusRowModel({
      status: "usageLimited",
      tokenBudget: null,
      timeUsedSeconds: 90_061,
      objective: "Wait for usage availability, then continue the same saved objective without losing runtime state.",
    }),
    title: "Goal Status Usage Limited",
    description:
      "Usage-limited saved-goal row with elapsed duration formatting across day/hour/minute/second units.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalStatusBudgetLimited: Story = {
  args: {
    model: buildGoalStatusRowModel({
      status: "budgetLimited",
      tokenBudget: 400000,
      tokensUsed: 400000,
      objective: "Stop once the configured token budget is exhausted and keep the goal visible for review.",
    }),
    title: "Goal Status Budget Limited",
    description:
      "Budget-limited saved-goal row with compact token progress and no pause/resume toggle.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalStatusCompleteHidden: Story = {
  args: {
    model: buildGoalStatusRowModel({
      status: "complete",
      tokenBudget: null,
      timeUsedSeconds: 125,
      objective: "A transient complete goal is cached by runtime handling and cleared rather than kept above the composer.",
    }),
    title: "Goal Status Complete Hidden",
    description:
      "Transient complete-goal state: the production shell intentionally renders no above-composer goal row while complete-clear handling owns the cached result.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalLongObjectiveCollapsed: Story = {
  args: {
    model: buildGoalLongObjectiveModel(),
    title: "Goal Long Objective Collapsed",
    description:
      "Long saved-goal objective in the collapsed row, including the expand affordance when the objective truncates.",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalLongObjectiveExpanded: Story = {
  args: {
    model: buildGoalLongObjectiveModel(),
    title: "Goal Long Objective Expanded",
    description:
      "Long saved-goal objective after expanding the production row into the pre-wrap scrollable objective area.",
    goalInteraction: "expand-objective",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
};

export const GoalEditDialog: Story = {
  args: {
    model: buildGoalStatusRowModel({
      status: "active",
      tokenBudget: null,
      timeUsedSeconds: 125,
      objective: "Edit this saved objective and restart it as the active goal without appending a transcript item.",
    }),
    title: "Goal Edit Dialog",
    description:
      "Saved-goal edit dialog opened through the real row action, showing the textarea, Cancel, and Save controls.",
    goalInteraction: "open-edit-dialog",
  },
  render: (args) => <AboveComposerStoryFrame {...args} />,
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
