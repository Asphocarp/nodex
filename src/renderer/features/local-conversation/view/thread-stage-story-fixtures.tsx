import { useEffect, useMemo, type ReactNode } from "react";
import type {
  Card,
  CodexAccountSnapshot,
  CodexCollaborationModePreset,
  CodexCommandAction,
  CodexComposerIntent,
  CodexConnectionState,
  CodexDictationStateSnapshot,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexMcpToolCallView,
  CodexModelOption,
  CodexPermissionMode,
  CodexReasoningEffortOption,
  CodexThreadSummary,
  CodexTranscriptEntry,
  CodexUserInputRequest,
} from "@/lib/types";
import { buildComposerShellModel } from "../projection/build-composer-shell-model";
import { buildThreadBodyModel } from "../projection/build-thread-body-model";
import { selectPrimaryConversationRequest } from "../conversation-request-helpers";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
import type {
  ThreadBodySurfaceModel,
  ThreadBodyUiStateOverrides,
  ThreadFooterModel,
  ThreadStageHeaderModel,
  ThreadStageRouteInput,
} from "../thread-stage-types";

export type ThreadStageStoryPresetId =
  | "new-thread"
  | "session-starting-local"
  | "session-starting-worktree"
  | "existing-empty"
  | "resuming"
  | "streaming"
  | "long-thread-streaming"
  | "long-thread-search-open"
  | "completed-collapsed"
  | "tool-call-mixed"
  | "approval-lane"
  | "user-input-lane"
  | "implement-plan"
  | "background-activity"
  | "search-open"
  | "inline-edit-open"
  | "inline-edit-failure"
  | "latest-turn-fork"
  | "older-turn-fork";

export interface ThreadStageStoryControls {
  preset: ThreadStageStoryPresetId;
  permissionMode: CodexPermissionMode;
  authenticatedAccount: boolean;
  isQueueingEnabled: boolean;
  collapseAgentBody: boolean;
}

export interface ThreadStageStoryPreset {
  id: ThreadStageStoryPresetId;
  name: string;
  description: string;
}

export interface ThreadStageStoryRuntimeState {
  isNewThreadTab: boolean;
  newThreadTarget: ThreadStageRouteInput["newThreadTarget"];
  activeThreadId: string | null;
  activeThreadSummary: CodexThreadSummary | null;
  conversation: CodexConversationSnapshot | null;
  knownConversationsById: Record<string, CodexConversationSnapshot>;
  searchOpenTick: number;
  composerIntent: CodexComposerIntent | null;
  threadStartProgress: ThreadStageRouteInput["threadStartProgress"];
  logs: string[];
}

export interface ThreadStageStorySurfaceModels {
  headerModel: ThreadStageHeaderModel;
  bodyModel: ThreadBodySurfaceModel;
  footerModel: ThreadFooterModel;
}

export interface ThreadStageStoryScenario {
  preset: ThreadStageStoryPreset;
  runtime: ThreadStageStoryRuntimeState;
  initialUiState?: ThreadBodyUiStateOverrides;
  transportCard: Card;
  permissionDescription: string;
  autoAction?: "openEdit" | "submitEditFailure" | "openOlderFork" | "triggerLatestFork";
}

interface StorybookElectronBridgeListenerMap {
  "git:branch:changed": Array<(payload: { cwd: string }) => void>;
}

function initializeStorybookRendererDocument(): void {
  const root = document.documentElement;
  const shouldEmulateElectronWindow = true;
  const shouldEmulateOpaqueElectronWindow = true;

  root.dataset.codexWindowType = shouldEmulateElectronWindow ? "electron" : "browser";
  window.__NODEX_STORYBOOK__ = true;

  if (!shouldEmulateElectronWindow) {
    root.classList.remove("electron-dark", "electron-light", "electron-opaque");
    return;
  }

  root.classList.toggle("electron-opaque", shouldEmulateOpaqueElectronWindow);

  const isDark = root.classList.contains("dark");
  root.classList.toggle("electron-dark", isDark);
  root.classList.toggle("electron-light", !isDark);
}

const STORY_PROJECT_ID = "storybook-local-conversation";
const STORY_CARD_ID = "card-thread-storybook";
const STORY_SESSION_ID = "session-thread-storybook";
const STORY_WORKSPACE_PATH = "/workspace/nodex";
const STORY_THREAD_ID = "thread_storybook";
const STORY_NEW_THREAD_TARGET: NonNullable<ThreadStageRouteInput["newThreadTarget"]> = {
  projectId: STORY_PROJECT_ID,
  projectName: "Nodex",
  sessionId: STORY_SESSION_ID,
  threadTitle: "Add Storybook coverage for thread surfaces",
  runInTarget: "newWorktree",
};

const DEFAULT_CONNECTION: CodexConnectionState = {
  status: "connected",
  retries: 0,
};

const DEFAULT_ACCOUNT_AUTHENTICATED: CodexAccountSnapshot = {
  account: {
    type: "chatgpt",
    email: "asc@example.com",
    planType: "Pro",
  },
  requiresOpenAiAuth: false,
  pendingLogin: null,
  rateLimits: null,
};

const DEFAULT_ACCOUNT_SIGNED_OUT: CodexAccountSnapshot = {
  account: null,
  requiresOpenAiAuth: true,
  pendingLogin: null,
  rateLimits: null,
};

const DEFAULT_MODELS: CodexModelOption[] = [
  {
    id: "gpt-5.3-codex",
    model: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    description: "Balanced model for thread work.",
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "minimal", description: "Fastest" },
      { reasoningEffort: "medium", description: "Balanced" },
      { reasoningEffort: "high", description: "Deep" },
    ],
    defaultReasoningEffort: "high",
    isDefault: true,
  },
];

const DEFAULT_COLLABORATION_MODES: CodexCollaborationModePreset[] = [
  { name: "Default", mode: "default", model: null, reasoningEffort: null },
  { name: "Plan", mode: "plan", model: null, reasoningEffort: "high" },
];

const DEFAULT_REASONING_OPTIONS: CodexReasoningEffortOption[] = [
  { reasoningEffort: "medium", description: "Balanced" },
  { reasoningEffort: "high", description: "Thorough" },
];

const DEFAULT_DICTATION_STATE: CodexDictationStateSnapshot = {
  isEnabled: true,
  authMethod: "chatgpt",
  isRealtimeVoiceActive: false,
  shortcutLabel: "Ctrl+M",
};

type StoryUserInputQuestion = CodexUserInputRequest["questions"][number];

export const THREAD_STAGE_STORY_PRESETS: ThreadStageStoryPreset[] = [
  {
    id: "new-thread",
    name: "New Thread",
    description: "Empty new-thread state with the real footer and branch controls still mounted.",
  },
  {
    id: "session-starting-local",
    name: "Session Started",
    description: "Materialized first local-project turn with the submitted prompt and Thinking state.",
  },
  {
    id: "session-starting-worktree",
    name: "Worktree Setup",
    description: "Visible new-worktree startup progress while setup output is still streaming.",
  },
  {
    id: "existing-empty",
    name: "Existing Empty",
    description: "An existing linked thread with no visible turns yet.",
  },
  {
    id: "resuming",
    name: "Resuming",
    description: "Reopen flow while the active thread waits for the canonical resume snapshot.",
  },
  {
    id: "streaming",
    name: "Streaming",
    description: "In-progress turn with live command and reasoning activity.",
  },
  {
    id: "long-thread-streaming",
    name: "Long Thread Streaming",
    description: "Long transcript mounted through the two-layer virtualizer with latest-turn follow and response-spacer behavior.",
  },
  {
    id: "long-thread-search-open",
    name: "Long Thread Search",
    description: "Long transcript with find-in-thread open against virtualized reveal, restore, and shared search indexing.",
  },
  {
    id: "completed-collapsed",
    name: "Completed Collapsed",
    description: "Completed turn with prior agent work collapsed ahead of the final answer.",
  },
  {
    id: "tool-call-mixed",
    name: "Tool Call Mixed",
    description: "Production-like completed thread with command, file edit, web, MCP, dynamic, turn diff, auto-review, and multi-agent activity.",
  },
  {
    id: "approval-lane",
    name: "Approval Lane",
    description: "Blocked active turn with the approval request surface above the composer.",
  },
  {
    id: "user-input-lane",
    name: "User Input Lane",
    description: "Blocked active turn with a multi-question request-user-input card.",
  },
  {
    id: "implement-plan",
    name: "Implement Plan",
    description: "Completed plan turn that surfaces the implement-plan follow-up request.",
  },
  {
    id: "background-activity",
    name: "Background Activity",
    description: "Active thread plus background child approval and side-channel rows.",
  },
  {
    id: "search-open",
    name: "Search Open",
    description: "Find-in-thread opened against explicit user and assistant search units.",
  },
  {
    id: "inline-edit-open",
    name: "Inline Edit Open",
    description: "Auto-opens the latest editable user message inline editor.",
  },
  {
    id: "inline-edit-failure",
    name: "Inline Edit Failure",
    description: "Auto-submits an edit failure and leaves the inline editor open with the error state.",
  },
  {
    id: "latest-turn-fork",
    name: "Latest Fork",
    description: "Triggers the latest-turn fork path and records the story action in-page.",
  },
  {
    id: "older-turn-fork",
    name: "Older Turn Fork",
    description: "Auto-opens the older-turn fork confirmation dialog.",
  },
];

export const THREAD_STAGE_STORY_DEFAULT_PRESET = THREAD_STAGE_STORY_PRESETS[0];

export function resolveThreadStageStoryPreset(preset: ThreadStageStoryPresetId): ThreadStageStoryPreset {
  return THREAD_STAGE_STORY_PRESETS.find((candidate) => candidate.id === preset) ?? THREAD_STAGE_STORY_DEFAULT_PRESET;
}

function buildStoryCard(): Card {
  return {
    id: STORY_CARD_ID,
    status: "in_progress",
    archived: false,
    title: "Add Storybook coverage for thread surfaces",
    description: [
      "## Storybook rollout",
      "",
      "- Cover the mounted local-conversation stage",
      "- Cover the notebook-style editor `threadSection` flow",
      "- Keep stories on the real projection path",
    ].join("\n"),
    priority: "p1-high",
    estimate: "m",
    tags: ["threads", "storybook", "ui"],
    assignee: "asc",
    agentBlocked: false,
    runInTarget: "newWorktree",
    runInBaseBranch: "main",
    runInEnvironmentPath: ".codex/environments/ui-polish.toml",
    created: new Date("2026-03-24T08:00:00.000Z"),
    order: 0,
  };
}

export function buildStoryConversationItem(overrides: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_1",
    itemId: "item_story_1",
    type: "assistant_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function buildStoryConversationTurn(overrides: Partial<CodexConversationTurn>): CodexConversationTurn {
  const items = overrides.items ?? [];
  return {
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_1",
    status: "completed",
    itemIds: items.map((item) => item.itemId),
    items,
    ...overrides,
  };
}

export function buildStoryConversation(
  overrides?: Partial<CodexConversationSnapshot>,
): CodexConversationSnapshot {
  return {
    threadId: STORY_THREAD_ID,
    projectId: STORY_PROJECT_ID,
    source: overrides?.source ?? null,
    threadName: "Thread Storybook rollout",
    threadPreview: "Cover tool calls, request lanes, edit flow, and fork flow.",
    modelProvider: "openai",
    cwd: STORY_WORKSPACE_PATH,
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1_000,
    updatedAt: 8_000,
    linkedAt: "2026-03-24T08:00:00.000Z",
    resumeState: "resumed",
    turns: [],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: true,
      canForkFromTurn: true,
      canSearch: true,
      canCollapseTurns: true,
    },
    ...overrides,
  };
}

function buildPrimaryCompletedConversation(): CodexConversationSnapshot {
  return buildStoryConversation({
    updatedAt: 22_000,
    turns: [
      buildStoryConversationTurn({
        turnId: "turn_story_older",
        status: "completed",
        items: [
          buildStoryConversationItem({
            turnId: "turn_story_older",
            itemId: "user_story_older",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Trace the current thread renderer seams before editing anything.",
            createdAt: 1_000,
            updatedAt: 1_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_older",
            itemId: "assistant_story_older",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            role: "assistant",
            assistantPhase: "final_answer",
            markdownText: "Mapped the mounted stage, footer, and request surfaces.",
            createdAt: 2_000,
            updatedAt: 2_000,
          }),
        ],
      }),
      buildStoryConversationTurn({
        turnId: "turn_story_latest",
        status: "completed",
        items: [
          buildStoryConversationItem({
            turnId: "turn_story_latest",
            itemId: "user_story_latest",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Add Storybook scenes for the thread feature, including tool calls, edit flow, and fork flow.",
            createdAt: 5_000,
            updatedAt: 5_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_latest",
            itemId: "exec_story_latest",
            type: "command_execution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "completed",
            command: "rg --files src/renderer/features/local-conversation",
            cwd: STORY_WORKSPACE_PATH,
            commandActions: [
              {
                type: "listFiles",
                command: "rg --files src/renderer/features/local-conversation",
                path: "src/renderer/features/local-conversation",
              } satisfies CodexCommandAction,
            ],
            aggregatedOutput: "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
            toolCall: {
              subtype: "command",
              toolName: "exec_command",
              args: {
                command: "rg --files src/renderer/features/local-conversation",
                cwd: STORY_WORKSPACE_PATH,
                summaryLabel: "Explored renderer files",
                commandActions: [
                  {
                    type: "listFiles",
                    command: "rg --files src/renderer/features/local-conversation",
                    path: "src/renderer/features/local-conversation",
                  } satisfies CodexCommandAction,
                ],
              },
              result: "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
            },
            createdAt: 6_000,
            updatedAt: 8_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_latest",
            itemId: "commentary_story_latest",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            role: "assistant",
            assistantPhase: "commentary",
            markdownText: "Building reusable fixtures first so the stage and leaf stories stay aligned.",
            createdAt: 9_000,
            updatedAt: 9_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_latest",
            itemId: "assistant_story_latest",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            role: "assistant",
            assistantPhase: "final_answer",
            markdownText: [
              "Implemented a Storybook fixture layer on top of the real thread projection pipeline.",
              "",
              "The stage stories now cover request lanes, edit flow, and fork flow without inventing a second renderer path.",
            ].join("\n"),
            createdAt: 13_000,
            updatedAt: 13_000,
          }),
        ],
      }),
    ],
  });
}

function buildStreamingConversation(
  overrides?: Partial<CodexConversationSnapshot>,
): CodexConversationSnapshot {
  return buildStoryConversation({
    statusType: "active",
    statusActiveFlags: [],
    updatedAt: 25_000,
    turns: [
      buildStoryConversationTurn({
        turnId: "turn_story_streaming",
        status: "inProgress",
        items: [
          buildStoryConversationItem({
            turnId: "turn_story_streaming",
            itemId: "user_story_streaming",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Build the thread Storybook fixtures and wire a fake Electron bridge for the stage screen.",
            createdAt: 20_000,
            updatedAt: 20_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_streaming",
            itemId: "reasoning_story_streaming",
            type: "reasoning",
            kind: "reasoning",
            semanticKind: "reasoning",
            status: "inProgress",
            markdownText: "Comparing story-only transport stubbing against direct renderer mocks.",
            createdAt: 21_000,
            updatedAt: 24_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_streaming",
            itemId: "exec_story_streaming",
            type: "command_execution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            toolCall: {
              subtype: "command",
              toolName: "exec_command",
              args: {
                command: "sed -n '1,220p' src/renderer/lib/api.ts",
                cwd: STORY_WORKSPACE_PATH,
                summaryLabel: "Reading renderer transport seams",
              },
              result: "import { resolveInvokeTransport, resolveRendererTransport } from \"./renderer-transport\";",
            },
            createdAt: 22_000,
            updatedAt: 25_000,
          }),
        ],
      }),
    ],
    ...overrides,
  });
}

function buildLongThreadStreamingConversation(): CodexConversationSnapshot {
  const olderTurns = Array.from({ length: 59 }, (_, index) =>
    buildStoryConversationTurn({
      turnId: `turn_story_long_${index + 1}`,
      status: "completed",
      items: [
        buildStoryConversationItem({
          turnId: `turn_story_long_${index + 1}`,
          itemId: `user_story_long_${index + 1}`,
          type: "user_message",
          kind: "userMessage",
          semanticKind: "userMessage",
          role: "user",
          markdownText: `Checkpoint request ${index + 1}: audit the mounted thread renderer seams.`,
          createdAt: 1_000 + index * 100,
          updatedAt: 1_000 + index * 100,
        }),
        buildStoryConversationItem({
          turnId: `turn_story_long_${index + 1}`,
          itemId: `assistant_story_long_${index + 1}`,
          type: "assistant_message",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          assistantPhase: "final_answer",
          markdownText: `Completed checkpoint ${index + 1}.`,
          createdAt: 1_020 + index * 100,
          updatedAt: 1_020 + index * 100,
        }),
      ],
    }),
  );
  const latestStreamingTurn = buildStreamingConversation().turns;

  return buildStreamingConversation({
    turns: [...olderTurns, ...latestStreamingTurn],
    updatedAt: 99_999,
  });
}

function buildApprovalRequestConversation(): CodexConversationSnapshot {
  return buildStreamingConversation({
    requests: [
      {
        type: "approval",
        requestId: "approval_story_active",
        kind: "command",
        projectId: STORY_PROJECT_ID,
        threadId: STORY_THREAD_ID,
        turnId: "turn_story_streaming",
        itemId: "exec_story_streaming",
        reason: "Running a command that writes to the worktree.",
        command: "bun run build:storybook",
        cwd: STORY_WORKSPACE_PATH,
        createdAt: 26_000,
      },
    ],
  });
}

function buildUserInputQuestions(): StoryUserInputQuestion[] {
  return [
    {
      id: "thread_scope",
      header: "Scope",
      question: "Which surfaces should the rollout cover?",
      isOther: false,
      isSecret: false,
      options: [
        {
          label: "Both surfaces",
          description: "Mounted conversation stage and editor threadSection flow.",
        },
        {
          label: "Conversation only",
          description: "Skip the editor for now.",
        },
      ],
    },
    {
      id: "storybook_shape",
      header: "Packaging",
      question: "How should the stories be organized?",
      isOther: true,
      isSecret: false,
      options: [
        {
          label: "Hybrid gallery",
          description: "Composed screen plus focused leaf stories.",
        },
      ],
    },
  ];
}

function buildUserInputRequestConversation(): CodexConversationSnapshot {
  return buildStreamingConversation({
    requests: [
      {
        type: "userInput",
        requestId: "user_input_story_active",
        projectId: STORY_PROJECT_ID,
        threadId: STORY_THREAD_ID,
        turnId: "turn_story_streaming",
        itemId: "reasoning_story_streaming",
        questions: buildUserInputQuestions(),
        createdAt: 26_000,
      },
    ],
  });
}

function buildImplementPlanConversation(): CodexConversationSnapshot {
  return buildStoryConversation({
    updatedAt: 30_000,
    requests: [{
      type: "implementPlan",
      requestId: "implement-plan:turn_story_plan",
      projectId: STORY_PROJECT_ID,
      threadId: STORY_THREAD_ID,
      turnId: "turn_story_plan",
      itemId: "implement-plan:turn_story_plan",
      planContent: [
        "1. Add story fixtures on top of the split header/body/footer surfaces.",
        "2. Cover tool-call families and request cards with focused stories.",
        "3. Extract the threadSection row for editor and Storybook reuse.",
      ].join("\n"),
      createdAt: 29_500,
    }],
    turns: [
      buildStoryConversationTurn({
        turnId: "turn_story_plan",
        status: "completed",
        items: [
          buildStoryConversationItem({
            turnId: "turn_story_plan",
            itemId: "user_story_plan",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Plan the Storybook rollout for thread surfaces.",
            createdAt: 20_000,
            updatedAt: 20_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_plan",
            itemId: "plan_story_plan",
            type: "plan",
            kind: "plan",
            semanticKind: "proposedPlan",
            markdownText: [
              "1. Add story fixtures on top of the split header/body/footer surfaces.",
              "2. Cover tool-call families and request cards with focused stories.",
              "3. Extract the threadSection row for editor and Storybook reuse.",
              "4. Extract the threadSection row for editor and Storybook reuse.",
              "5. Extract the threadSection row for editor and Storybook reuse.",
              "6. Extract the threadSection row for editor and Storybook reuse.",
              "7. Extract the threadSection row for editor and Storybook reuse.",
              "8. Extract the threadSection row for editor and Storybook reuse.",
              "9. Extract the threadSection row for editor and Storybook reuse.",
              "10. Extract the threadSection row for editor and Storybook reuse.",
              "11. Extract the threadSection row for editor and Storybook reuse.",
            ].join("\n"),
            createdAt: 25_000,
            updatedAt: 29_000,
          }),
          buildStoryConversationItem({
            turnId: "turn_story_plan",
            itemId: "implement-plan:turn_story_plan",
            type: "planImplementation",
            kind: "planImplementation",
            semanticKind: "planImplementation",
            markdownText: [
              "1. Add story fixtures on top of the split header/body/footer surfaces.",
              "2. Cover tool-call families and request cards with focused stories.",
              "3. Extract the threadSection row for editor and Storybook reuse.",
            ].join("\n"),
            status: "inProgress",
            createdAt: 29_500,
            updatedAt: 30_000,
          }),
        ],
      }),
    ],
  });
}

function buildBackgroundConversation(): {
  conversation: CodexConversationSnapshot;
  knownConversationsById: Record<string, CodexConversationSnapshot>;
} {
  const backgroundThreadId = "thread_story_background_worker";
  const conversation = buildStoryConversation({
    statusType: "active",
    statusActiveFlags: [],
    requests: [
      {
        type: "approval",
        requestId: "approval_story_active",
        kind: "command",
        projectId: STORY_PROJECT_ID,
        threadId: STORY_THREAD_ID,
        turnId: "turn_story_streaming",
        itemId: "exec_story_streaming",
        reason: "Foreground thread wants to run lint before Storybook build.",
        command: "bun run lint",
        cwd: STORY_WORKSPACE_PATH,
        createdAt: 26_000,
      },
    ],
    turns: buildStreamingConversation().turns,
    childMemberships: [
      {
        threadId: backgroundThreadId,
        parentThreadId: STORY_THREAD_ID,
        role: "backgroundChild",
        actorName: "Worker 1",
      },
    ],
    pendingSteers: [
      {
        steerId: "steer_story_1",
        threadId: STORY_THREAD_ID,
        turnId: "turn_story_streaming",
        prompt: "Keep the stage stories on the real projection path.",
        createdAt: 27_000,
      },
    ],
    queuedFollowUps: [
      {
        followUpId: "follow_up_story_1",
        threadId: STORY_THREAD_ID,
        prompt: "Run final validation once the stories are in place.",
        createdAt: 28_000,
        collaborationMode: "default",
        serviceTier: null,
      },
    ],
    backgroundTerminalRows: [
      {
        id: "background_terminal_story_1",
        command: "bun test src/renderer/features/local-conversation/view/shared/request-cards/local-conversation-request-cards.test.tsx",
        cwd: STORY_WORKSPACE_PATH,
        previewLine: "1418 pass",
        processId: 4172,
      },
    ],
  });

  const backgroundConversation = buildStoryConversation({
    threadId: backgroundThreadId,
    threadName: "Worker 1",
    threadPreview: "Reviewing request-card density",
    statusType: "active",
    statusActiveFlags: ["waitingOnApproval"],
    turns: [
      buildStoryConversationTurn({
        threadId: backgroundThreadId,
        turnId: "turn_story_background",
        status: "inProgress",
        items: [
          buildStoryConversationItem({
            threadId: backgroundThreadId,
            turnId: "turn_story_background",
            itemId: "user_story_background",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Check the request-card stories for keyboard continuity.",
            createdAt: 25_000,
            updatedAt: 25_000,
          }),
        ],
      }),
    ],
    requests: [
      {
        type: "approval",
        requestId: "approval_story_background",
        kind: "command",
        projectId: STORY_PROJECT_ID,
        threadId: backgroundThreadId,
        turnId: "turn_story_background",
        itemId: "background_exec_story",
        reason: "Background child wants to run the isolated request-card tests.",
        command: "bun test src/renderer/features/local-conversation/view/shared/request-cards/local-conversation-request-cards.test.tsx",
        cwd: STORY_WORKSPACE_PATH,
        createdAt: 26_500,
      },
    ],
  });

  return {
    conversation,
    knownConversationsById: {
      [STORY_THREAD_ID]: conversation,
      [backgroundThreadId]: backgroundConversation,
    },
  };
}

function cloneStoryEntryForTurn(
  entry: CodexTranscriptEntry,
  turnId: string,
  index: number,
): CodexTranscriptEntry {
  const itemId = `mixed_${entry.itemId}_${index}`;
  return {
    ...entry,
    threadId: STORY_THREAD_ID,
    turnId,
    itemId,
    entryId: itemId,
    createdAt: 41_000 + index * 100,
    updatedAt: 41_000 + index * 100,
  };
}

function buildMixedDynamicToolCallItem(turnId: string): CodexTranscriptEntry {
  return buildStoryConversationItem({
    turnId,
    itemId: "mixed_dynamic_read_thread",
    type: "dynamicToolCall",
    kind: "toolCall",
    semanticKind: "dynamicToolCall",
    status: "completed",
    toolCall: {
      subtype: "dynamic",
      toolName: "read_thread",
      server: "codex_app",
      args: { threadId: STORY_THREAD_ID, turnLimit: 1 },
      result: [{ type: "inputText", text: "{\"threadId\":\"thread_storybook\"}" }],
    },
    dynamicToolCall: {
      callId: "mixed_dynamic_read_thread",
      namespace: "codex_app",
      tool: "read_thread",
      arguments: { threadId: STORY_THREAD_ID, turnLimit: 1 },
      status: "completed",
      contentItems: [{ type: "inputText", text: "{\"threadId\":\"thread_storybook\"}" }],
      success: true,
      durationMs: 18,
      completed: true,
    },
    createdAt: 41_500,
    updatedAt: 41_500,
  });
}

function buildMixedToolCallConversation(): CodexConversationSnapshot {
  const turnId = "turn_story_mixed_tools";
  const clonedToolItems = [
    THREAD_TOOL_CALL_STORY_ITEMS.command,
    THREAD_TOOL_CALL_STORY_ITEMS.fileChange,
    THREAD_TOOL_CALL_STORY_ITEMS.webSearch,
    THREAD_TOOL_CALL_STORY_ITEMS.mcp,
    buildMixedDynamicToolCallItem(turnId),
    THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.automaticApprovalReviewCompleted,
    ...THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.multiAgentSettled,
    THREAD_TOOL_CALL_STORY_ITEMS.turnDiff,
  ].map((entry, index) => cloneStoryEntryForTurn(entry, turnId, index + 1));

  return buildStoryConversation({
    threadPreview: "Production-like thread with mixed tool-call activity.",
    updatedAt: 52_000,
    turns: [
      buildStoryConversationTurn({
        turnId,
        status: "completed",
        items: [
          buildStoryConversationItem({
            turnId,
            itemId: "user_story_mixed_tools",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Exercise the complete tool-call surface in one production-like thread.",
            createdAt: 40_000,
            updatedAt: 40_000,
          }),
          ...clonedToolItems,
          buildStoryConversationItem({
            turnId,
            itemId: "assistant_story_mixed_tools",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            role: "assistant",
            assistantPhase: "final_answer",
            markdownText: "The mixed thread renders command, patch, web, MCP, dynamic, turn-diff, auto-review, and multi-agent activity through the production projection pipeline.",
            createdAt: 52_000,
            updatedAt: 52_000,
          }),
        ],
      }),
    ],
  });
}

function buildToolItemBase(overrides: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: STORY_THREAD_ID,
    turnId: "turn_tool_story",
    itemId: "tool_story_item",
    type: "tool_call",
    kind: "toolCall",
    semanticKind: "toolCall",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildMcpToolCallView(overrides: Partial<CodexMcpToolCallView>): CodexMcpToolCallView {
  const invocation = overrides.invocation ?? {
    server: "context7",
    tool: "resolve-library-id",
    arguments: {},
  };

  return {
    callId: "call_story_mcp",
    functionName: `${invocation.server}__${invocation.tool}`,
    invocation,
    durationMs: 0,
    completed: true,
    result: null,
    ...overrides,
  };
}

export const THREAD_TOOL_CALL_STORY_ITEMS = {
  command: buildToolItemBase({
    itemId: "tool_story_command",
    type: "command_execution",
    kind: "commandExecution",
    semanticKind: "exec",
    status: "completed",
    command: "rg --files src/renderer/features/local-conversation",
    cwd: STORY_WORKSPACE_PATH,
    processId: "4172",
    commandActions: [
      {
        type: "listFiles",
        command: "rg --files src/renderer/features/local-conversation",
        path: "src/renderer/features/local-conversation",
      } satisfies CodexCommandAction,
      {
        type: "read",
        command: "sed -n '1,220p' src/renderer/features/local-conversation/view/local-conversation-thread-body.tsx",
        name: "local-conversation-thread-body.tsx",
        path: "src/renderer/features/local-conversation/view/local-conversation-thread-body.tsx",
      } satisfies CodexCommandAction,
    ],
    aggregatedOutput:
      "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx\nsrc/renderer/features/local-conversation/view/local-conversation-thread-body.tsx",
    exitCode: 0,
    durationMs: 1_200,
    toolCall: {
      subtype: "command",
      toolName: "exec_command",
      args: {
        summaryLabel: "Explored thread renderer files",
      },
      result:
        "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx\nsrc/renderer/features/local-conversation/view/local-conversation-thread-body.tsx",
    },
  }),
  fileChange: buildToolItemBase({
    itemId: "tool_story_file_change",
    type: "file_change",
    kind: "fileChange",
    fileChange: {
      label: "Edited src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
      changes: {
        "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx": {
          type: "update",
          movePath: null,
          unifiedDiff: [
            "@@ -1,5 +1,7 @@",
            " import { useState } from \"react\";",
            "+import { StoryShell } from \"./thread-stage-dev-story\";",
            " ",
            " export function LocalConversationStageScreen() {",
            "+  return <StoryShell />;",
            " }",
          ].join("\n"),
        },
      },
    },
    toolCall: {
      subtype: "fileChange",
      toolName: "file_change",
      args: {
        label: "Edited src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
      },
      result: null,
    },
  }),
  turnDiff: buildToolItemBase({
    itemId: "tool_story_turn_diff",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    rawItem: {
      type: "turn-diff",
      cwd: "/workspace/nodex",
      unifiedDiff: [
        "--- a/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
        "+++ b/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
        "@@ -3,11 +3,12 @@",
        " import { LocalConversationFooter } from \"./local-conversation-footer\";",
        " import { ThreadStageHeader } from \"./local-conversation-stage-header\";",
        " import { LocalConversationThreadBody } from \"./local-conversation-thread-body\";",
        "+import { StoryShell } from \"./thread-stage-dev-story\";",
        " ",
        " export function LocalConversationStageScreen({ model, actions, initialUiState }: ThreadStageScreenProps) {",
        "   const [errorMessage, setErrorMessage] = useState<string | null>(null);",
        " ",
        "   return (",
        "-    <div className=\"flex h-full min-h-0 flex-col bg-(--background)\">",
        "+    <StoryShell className=\"flex h-full min-h-0 flex-col bg-(--background)\">",
        "       <ThreadStageHeader model={model} actions={actions} onErrorMessage={setErrorMessage} />",
        "       <LocalConversationThreadBody",
        "@@ -22,6 +23,6 @@",
        "         errorMessage={errorMessage}",
        "         onErrorMessage={setErrorMessage}",
        "       />",
        "-    </div>",
        "+    </StoryShell>",
        "   );",
        " }",
        "--- a/src/renderer/features/local-conversation/view/shared/tools/thread-tool-calls.stories.tsx",
        "+++ b/src/renderer/features/local-conversation/view/shared/tools/thread-tool-calls.stories.tsx",
        "@@ -153,7 +153,7 @@",
        " export const TurnDiff: Story = {",
        "   render: () => (",
        "     <StorySurface",
        "-      description=\"Turn-level unified diff rendered separately from the file-edit tool call.\"",
        "+      description=\"Turn-level unified diff rendered as a Codex-style files-changed card with embedded file rows.\"",
        "     >",
        "       <TurnDiffSurface",
        "         item={THREAD_TOOL_CALL_STORY_ITEMS.turnDiff}",
        "--- a/docs/product-specs/codex-thread-transcript-behavior.md",
        "+++ b/docs/product-specs/codex-thread-transcript-behavior.md",
        "@@ -125,6 +125,8 @@",
        "   - turn-level aggregated `turn.diff` renders as a separate `turn-diff` surface",
        "   - active in-progress turn diffs surface as a compact above-composer `files changed` banner instead of a generic inline diff viewer",
        "   - completed turn diffs render as a dedicated `Edited …` card with per-file collapsed embedded diff rows",
        "+  - completed turn-diff cards summarize multi-file changes before any embedded rows expand.",
        "+  - embedded turn-diff rows are collapsed by default and open files from the filename button when a workspace path is available.",
        "   - the unified diff card is never allowed to replace or swallow the underlying `Edited file` tool row",
        "   - file-change rows expand inline to reveal their own unified diff frame instead of delegating expansion to the separate turn-level diff card",
        "   - file-change headers split the status label and filename into separate elements; the filename is clickable and opens the local file target without toggling the row",
        "--- a/src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx",
        "+++ b/src/renderer/features/local-conversation/view/shared/turn-diff-surface.tsx",
        "@@ -183,7 +183,7 @@",
        "   return (",
        "     <div className=\"mb-2 flex flex-col overflow-hidden rounded-xl bg-token-list-hover-background/60 text-base\">",
        "       <div className=\"flex items-center gap-2\">",
        "-        <div className=\"flex w-full min-w-0 flex-nowrap items-center gap-1 pr-1 pl-3\">",
        "+        <div className=\"flex w-full min-w-0 flex-nowrap items-center gap-1 pr-1 pl-3 pb-0.5\">",
        "           <TurnDiffFilesChangedLabel fileCount={summary.fileCount} />",
        "           <DiffStats",
        "             additions={summary.additions}",
        "@@ -322,7 +322,7 @@",
        "           <div className=\"flex-1\" />",
        "         </div>",
        "       </div>",
        "-      <div className=\"flex flex-col divide-y-[0.5px] divide-token-border\">",
        "+      <div className=\"flex flex-col divide-y-[0.5px] divide-token-border bg-token-side-bar-background\">",
        "         {rows.map((row) => (",
        "           <TurnDiffEmbeddedRow",
        "             key={row.key}",
        "--- a/src/renderer/features/local-conversation/view/shared/turn-diff-surface.test.tsx",
        "+++ b/src/renderer/features/local-conversation/view/shared/turn-diff-surface.test.tsx",
        "@@ -61,6 +61,7 @@",
        "     );",
        " ",
        "     expect(Boolean(container.textContent?.includes(\"2 files changed\"))).toBeTrue();",
        "+    expect(Boolean(container.textContent?.includes(\"files changed\"))).toBeTrue();",
        "     expect(Boolean(container.textContent?.includes(\"+2\"))).toBeTrue();",
        "     expect(Boolean(container.textContent?.includes(\"-2\"))).toBeTrue();",
        "     expect(container.querySelectorAll('[role=\"button\"][aria-expanded=\"false\"]').length).toBe(2);",
        "@@ -108,6 +109,7 @@",
        "     );",
        " ",
        "     expect(Boolean(container.textContent?.includes(\"2 files changed\"))).toBeTrue();",
        "+    expect(Boolean(container.textContent?.includes(\"files changed\"))).toBeTrue();",
        "     expect(container.querySelectorAll('[role=\"button\"]').length).toBe(0);",
        "   });",
        " });",
      ].join("\n"),
    },
  }),
  webSearch: buildToolItemBase({
    itemId: "tool_story_web_search",
    type: "web_search",
    semanticKind: "webSearch",
    toolCall: {
      subtype: "webSearch",
      toolName: "web_search",
      args: { query: "storybook react vite args decorators loaders play" },
      result: {
        type: "search",
        queries: [
          "storybook react vite args decorators loaders play",
          "storybook react vite args",
        ],
      },
    },
    rawItem: {
      query: "storybook react vite args decorators loaders play",
      action: {
        type: "search",
        queries: [
          "storybook react vite args decorators loaders play",
          "storybook react vite args",
        ],
      },
    },
  }),
  webSearchFindInPage: buildToolItemBase({
    itemId: "tool_story_web_search_find_in_page",
    type: "web_search",
    semanticKind: "webSearch",
    status: "completed",
    toolCall: {
      subtype: "webSearch",
      toolName: "web_search",
      args: { query: "storyboard find in page" },
      result: {
        type: "findInPage",
        pattern: "play function",
        url: "https://storybook.js.org/docs/writing-stories/play-function",
      },
    },
    rawItem: {
      action: {
        type: "findInPage",
        pattern: "play function",
        url: "https://storybook.js.org/docs/writing-stories/play-function",
      },
    },
  }),
  webSearchInProgress: buildToolItemBase({
    itemId: "tool_story_web_search_in_progress",
    type: "web_search",
    semanticKind: "webSearch",
    status: "inProgress",
    toolCall: {
      subtype: "webSearch",
      toolName: "web_search",
      args: { query: "storybook args decorators" },
      result: {
        type: "search",
        query: "storybook args decorators",
      },
    },
    rawItem: {
      action: {
        type: "search",
        query: "storybook args decorators",
      },
    },
  }),
  mcp: buildToolItemBase({
    itemId: "tool_story_mcp",
    type: "mcp_tool_call",
    semanticKind: "mcpToolCall",
    status: "completed",
    toolCall: {
      subtype: "mcp",
      server: "context7",
      toolName: "resolve-library-id",
      args: {
        libraryName: "storybook",
        query:
          "React Vite Storybook best practices for component stories using args vs loaders, decorators, controls, docs, and play functions for interactive stateful UI.",
      },
      result: {
        type: "success",
        content: [
          {
            type: "text",
            text: [
              "Available Libraries:",
              "",
              "- Title: Storybook",
              "- Context7-compatible library ID: /storybookjs/storybook",
              "- Description: Storybook is a frontend workshop for building UI components and pages in isolation, used by thousands of teams for development, testing, and documentation.",
              "- Code Snippets: 4341",
              "- Source Reputation: High",
              "- Benchmark Score: 68.34",
              "- Versions: v9.0.15, v8_6_14, v6_5_9, v10.2.9",
              "----------",
              "- Title: Storybook",
              "- Context7-compatible library ID: /websites/storybook_js",
              "- Description: Storybook is a frontend workshop for building UI components and pages in isolation, used for UI development, testing, and documentation.",
              "- Code Snippets: 5561",
              "- Source Reputation: High",
              "- Benchmark Score: 83.09",
              "----------",
              "- Title: Storybook",
              "- Context7-compatible library ID: /storybookjs/web",
              "- Description: The main website and documentation for Storybook, built with Next.js, Tailwind, Turborepo, and Storybook.",
              "- Code Snippets: 77",
              "- Source Reputation: High",
              "- Benchmark Score: 30.56",
              "----------",
              "- Title: Storybook React Native",
              "- Context7-compatible library ID: /storybookjs/react-native",
              "- Description: Storybook for React Native allows you to design and develop individual React Native components without running your entire application.",
              "- Code Snippets: 263",
              "- Source Reputation: High",
              "- Benchmark Score: 69.27",
              "- Versions: v9.1.4",
              "----------",
              "- Title: Storybook Rsbuild",
              "- Context7-compatible library ID: /rspack-contrib/storybook-rsbuild",
              "- Description: This repository contains the Storybook Rsbuild builder and UI framework integrations for various JavaScript frameworks.",
              "- Code Snippets: 62",
              "- Source Reputation: High",
              "- Benchmark Score: 75.56",
            ].join("\n"),
          },
        ],
        structuredContent: null,
        raw: {
          content: [
            {
              type: "text",
              text: "Available Libraries:\n\n- Title: Storybook\n- Context7-compatible library ID: /storybookjs/storybook",
            },
          ],
        },
      },
    },
    mcpToolCall: buildMcpToolCallView({
      callId: "call_9L9LUlz6nkg1Jp2LA4mrAL8o",
      functionName: "context7__resolve-library-id",
      invocation: {
        server: "context7",
        tool: "resolve-library-id",
        arguments: {
          libraryName: "storybook",
          query:
            "React Vite Storybook best practices for component stories using args vs loaders, decorators, controls, docs, and play functions for interactive stateful UI.",
        },
      },
      durationMs: 2957,
      completed: true,
      result: {
        type: "success",
        content: [
          {
            type: "text",
            text: [
              "Available Libraries:",
              "",
              "- Title: Storybook",
              "- Context7-compatible library ID: /storybookjs/storybook",
              "- Description: Storybook is a frontend workshop for building UI components and pages in isolation, used by thousands of teams for development, testing, and documentation.",
              "- Code Snippets: 4341",
              "- Source Reputation: High",
              "- Benchmark Score: 68.34",
              "- Versions: v9.0.15, v8_6_14, v6_5_9, v10.2.9",
              "----------",
              "- Title: Storybook",
              "- Context7-compatible library ID: /websites/storybook_js",
              "- Description: Storybook is a frontend workshop for building UI components and pages in isolation, used for UI development, testing, and documentation.",
              "- Code Snippets: 5561",
              "- Source Reputation: High",
              "- Benchmark Score: 83.09",
              "----------",
              "- Title: Storybook",
              "- Context7-compatible library ID: /storybookjs/web",
              "- Description: The main website and documentation for Storybook, built with Next.js, Tailwind, Turborepo, and Storybook.",
              "- Code Snippets: 77",
              "- Source Reputation: High",
              "- Benchmark Score: 30.56",
              "----------",
              "- Title: Storybook React Native",
              "- Context7-compatible library ID: /storybookjs/react-native",
              "- Description: Storybook for React Native allows you to design and develop individual React Native components without running your entire application.",
              "- Code Snippets: 263",
              "- Source Reputation: High",
              "- Benchmark Score: 69.27",
              "- Versions: v9.1.4",
              "----------",
              "- Title: Storybook Rsbuild",
              "- Context7-compatible library ID: /rspack-contrib/storybook-rsbuild",
              "- Description: This repository contains the Storybook Rsbuild builder and UI framework integrations for various JavaScript frameworks.",
              "- Code Snippets: 62",
              "- Source Reputation: High",
              "- Benchmark Score: 75.56",
            ].join("\n"),
          },
        ],
        structuredContent: null,
        raw: {
          content: [
            {
              type: "text",
              text: [
                "Available Libraries:",
                "",
                "- Title: Storybook",
                "- Context7-compatible library ID: /storybookjs/storybook",
              ].join("\n"),
            },
          ],
          structuredContent: null,
        },
      },
    }),
    rawItem: {
      callId: "call_9L9LUlz6nkg1Jp2LA4mrAL8o",
      invocation: {
        server: "context7",
        tool: "resolve-library-id",
        arguments: {
          libraryName: "storybook",
          query:
            "React Vite Storybook best practices for component stories using args vs loaders, decorators, controls, docs, and play functions for interactive stateful UI.",
        },
      },
      durationMs: 2957,
      result: {
        type: "success",
        content: [
          {
            type: "text",
            text: [
              "Available Libraries:",
              "",
              "- Title: Storybook",
              "- Context7-compatible library ID: /storybookjs/storybook",
              "- Description: Storybook is a frontend workshop for building UI components and pages in isolation, used by thousands of teams for development, testing, and documentation.",
              "- Code Snippets: 4341",
              "- Source Reputation: High",
              "- Benchmark Score: 68.34",
              "- Versions: v9.0.15, v8_6_14, v6_5_9, v10.2.9",
              "----------",
              "- Title: Storybook",
              "- Context7-compatible library ID: /websites/storybook_js",
              "- Description: Storybook is a frontend workshop for building UI components and pages in isolation, used for UI development, testing, and documentation.",
              "- Code Snippets: 5561",
              "- Source Reputation: High",
              "- Benchmark Score: 83.09",
              "----------",
              "- Title: Storybook",
              "- Context7-compatible library ID: /storybookjs/web",
              "- Description: The main website and documentation for Storybook, built with Next.js, Tailwind, Turborepo, and Storybook.",
              "- Code Snippets: 77",
              "- Source Reputation: High",
              "- Benchmark Score: 30.56",
              "----------",
              "- Title: Storybook React Native",
              "- Context7-compatible library ID: /storybookjs/react-native",
              "- Description: Storybook for React Native allows you to design and develop individual React Native components without running your entire application.",
              "- Code Snippets: 263",
              "- Source Reputation: High",
              "- Benchmark Score: 69.27",
              "- Versions: v9.1.4",
              "----------",
              "- Title: Storybook Rsbuild",
              "- Context7-compatible library ID: /rspack-contrib/storybook-rsbuild",
              "- Description: This repository contains the Storybook Rsbuild builder and UI framework integrations for various JavaScript frameworks.",
              "- Code Snippets: 62",
              "- Source Reputation: High",
              "- Benchmark Score: 75.56",
            ].join("\n"),
          },
        ],
        structuredContent: null,
        raw: {
          content: [
            {
              type: "text",
              text: [
                "Available Libraries:",
                "",
                "- Title: Storybook",
                "- Context7-compatible library ID: /storybookjs/storybook",
              ].join("\n"),
            },
          ],
        },
      },
    },
  }),
  mcpQueryDocs: buildToolItemBase({
    itemId: "tool_story_mcp_query_docs",
    type: "mcp_tool_call",
    semanticKind: "mcpToolCall",
    status: "completed",
    toolCall: {
      subtype: "mcp",
      server: "context7",
      toolName: "query_docs",
      args: {
        libraryId: "/storybookjs/storybook",
        query: "args and play functions",
      },
      result: {
        type: "success",
        content: [],
        structuredContent: {
          snippetCount: 3,
        },
      },
    },
    rawItem: {
      callId: "call_jvUwWwXkT6ZG1Upbgd6V7gZX",
      invocation: {
        server: "context7",
        tool: "query_docs",
        arguments: {
          libraryId: "/storybookjs/storybook",
          query: "args and play functions",
        },
      },
      durationMs: 1284,
      result: {
        type: "success",
        content: [],
        structuredContent: {
          snippetCount: 3,
          section: "args",
        },
      },
    },
    mcpToolCall: buildMcpToolCallView({
      callId: "call_jvUwWwXkT6ZG1Upbgd6V7gZX",
      functionName: "context7__query_docs",
      invocation: {
        server: "context7",
        tool: "query_docs",
        arguments: {
          libraryId: "/storybookjs/storybook",
          query: "args and play functions",
        },
      },
      durationMs: 1284,
      completed: true,
      result: {
        type: "success",
        content: [],
        structuredContent: {
          snippetCount: 3,
          section: "args",
        },
        raw: {
          content: [],
          structuredContent: {
            snippetCount: 3,
            section: "args",
          },
        },
      },
    }),
  }),
  mcpInProgress: buildToolItemBase({
    itemId: "tool_story_mcp_in_progress",
    type: "mcp_tool_call",
    semanticKind: "mcpToolCall",
    status: "inProgress",
    toolCall: {
      subtype: "mcp",
      server: "context7",
      toolName: "resolve-library-id",
      args: {
        libraryName: "storybook",
      },
    },
    mcpToolCall: buildMcpToolCallView({
      callId: "call_mcp_in_progress",
      functionName: "context7__resolve-library-id",
      invocation: {
        server: "context7",
        tool: "resolve-library-id",
        arguments: {
          libraryName: "storybook",
        },
      },
      durationMs: null,
      completed: false,
      result: null,
    }),
  }),
  mcpInProgressWithResult: buildToolItemBase({
    itemId: "tool_story_mcp_in_progress_with_result",
    type: "mcp_tool_call",
    semanticKind: "mcpToolCall",
    status: "inProgress",
    toolCall: {
      subtype: "mcp",
      server: "context7",
      toolName: "query_docs",
      args: {
        libraryId: "/storybookjs/storybook",
      },
      result: {
        type: "success",
        content: [
          {
            type: "text",
            text: "Streaming MCP result content already arrived.",
          },
        ],
        structuredContent: null,
      },
    },
    mcpToolCall: buildMcpToolCallView({
      callId: "call_mcp_in_progress_with_result",
      functionName: "context7__query_docs",
      invocation: {
        server: "context7",
        tool: "query_docs",
        arguments: {
          libraryId: "/storybookjs/storybook",
        },
      },
      durationMs: null,
      completed: false,
      result: {
        type: "success",
        content: [
          {
            type: "text",
            text: "Streaming MCP result content already arrived.",
          },
        ],
        structuredContent: null,
        raw: {
          content: [
            {
              type: "text",
              text: "Streaming MCP result content already arrived.",
            },
          ],
          structuredContent: null,
        },
      },
    }),
  }),
  mcpProtocolError: buildToolItemBase({
    itemId: "tool_story_mcp_error",
    type: "mcp_tool_call",
    semanticKind: "mcpToolCall",
    status: "failed",
    toolCall: {
      subtype: "mcp",
      server: "context7",
      toolName: "resolve-library-id",
      args: {
        libraryName: "storybook",
      },
      error: "Authentication required",
    },
    mcpToolCall: buildMcpToolCallView({
      callId: "call_mcp_error",
      functionName: "context7__resolve-library-id",
      invocation: {
        server: "context7",
        tool: "resolve-library-id",
        arguments: {
          libraryName: "storybook",
        },
      },
      durationMs: 812,
      completed: true,
      result: {
        type: "error",
        kind: "protocol",
        error: "Authentication required",
        rawError: {
          message: "Authentication required",
        },
      },
    }),
  }),
  mcpUnknownBlock: buildToolItemBase({
    itemId: "tool_story_mcp_unknown",
    type: "mcp_tool_call",
    semanticKind: "mcpToolCall",
    status: "completed",
    toolCall: {
      subtype: "mcp",
      server: "context7",
      toolName: "resolve-library-id",
      args: {
        libraryName: "storybook",
      },
    },
    mcpToolCall: buildMcpToolCallView({
      callId: "call_mcp_unknown",
      functionName: "context7__resolve-library-id",
      invocation: {
        server: "context7",
        tool: "resolve-library-id",
        arguments: {
          libraryName: "storybook",
        },
      },
      durationMs: 531,
      completed: true,
      result: {
        type: "success",
        content: [
          {
            type: "unknown",
            raw: {
              type: "not_real",
              foo: "bar",
            },
          },
        ],
        structuredContent: null,
        raw: {
          content: [
            {
              type: "not_real",
              foo: "bar",
            },
          ],
          structuredContent: null,
        },
      },
    }),
  }),
};

export const THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS = {
  streamErrorReconnecting: buildToolItemBase({
    itemId: "story_stream_error_reconnecting",
    entryId: "story_stream_error_reconnecting",
    type: "error",
    kind: "systemEvent",
    semanticKind: "streamError",
    status: "inProgress",
    markdownText: "Reconnecting... 2/5",
    additionalDetails: "Network error: connection dropped while streaming. Retrying in 750ms.",
    willRetry: true,
    rawItem: {
      id: "error:turn_tool_story",
      type: "error",
      willRetry: true,
      error: {
        message: "Reconnecting... 2/5",
        additionalDetails: "Network error: connection dropped while streaming. Retrying in 750ms.",
      },
    },
  }),
  systemErrorFailed: buildToolItemBase({
    itemId: "story_system_error_failed",
    entryId: "story_system_error_failed",
    type: "error",
    kind: "systemEvent",
    semanticKind: "systemError",
    status: "failed",
    markdownText: "Failed to reconnect to the stream.",
    additionalDetails: "The connection could not be re-established after repeated retry attempts.",
    willRetry: false,
    rawItem: {
      id: "error:turn_tool_story",
      type: "error",
      willRetry: false,
      error: {
        message: "Failed to reconnect to the stream.",
        additionalDetails: "The connection could not be re-established after repeated retry attempts.",
      },
    },
  }),
  contextCompactionCompleted: buildToolItemBase({
    itemId: "story_context_compaction_completed",
    entryId: "story_context_compaction_completed",
    type: "context_compaction",
    kind: "systemEvent",
    semanticKind: "contextCompaction",
    status: "completed",
    markdownText: "Context automatically compacted",
    rawItem: {
      id: "story_context_compaction_completed",
      type: "context_compaction",
      status: "completed",
    },
  }),
  contextCompactionInProgress: buildToolItemBase({
    itemId: "story_context_compaction_in_progress",
    entryId: "story_context_compaction_in_progress",
    type: "context_compaction",
    kind: "systemEvent",
    semanticKind: "contextCompaction",
    status: "inProgress",
    markdownText: "Automatically compacting context",
    rawItem: {
      id: "story_context_compaction_in_progress",
      type: "context_compaction",
      status: "in_progress",
    },
  }),
  automaticApprovalReviewCompleted: buildToolItemBase({
    itemId: "story_automatic_approval_review_completed",
    entryId: "story_automatic_approval_review_completed",
    type: "automaticApprovalReview",
    kind: "systemEvent",
    semanticKind: "automaticApprovalReview",
    status: "completed",
    rawItem: {
      targetItemId: "item-command",
      review: {
        status: "approved",
        riskScore: 0.11,
        riskLevel: "low",
        rationale: "Only local Storybook and renderer tests are executed before packaging.",
      },
      action: {
        type: "command",
        source: "shell",
        command: "bun run build:storybook",
        cwd: "/Users/asc/repo/nodex",
      },
    },
  }),
  automaticApprovalReviewInProgress: buildToolItemBase({
    itemId: "story_automatic_approval_review_in_progress",
    entryId: "story_automatic_approval_review_in_progress",
    type: "automaticApprovalReview",
    kind: "systemEvent",
    semanticKind: "automaticApprovalReview",
    status: "inProgress",
    rawItem: {
      targetItemId: "item-command",
      review: {
        status: "inProgress",
        riskScore: 0.45,
        riskLevel: "medium",
        rationale: null,
      },
      action: {
        type: "command",
        source: "shell",
        command: "bun run build:storybook",
        cwd: "/Users/asc/repo/nodex",
      },
    },
  }),
  autoReviewInterruptionWarning: buildToolItemBase({
    itemId: "story_auto_review_interruption_warning",
    entryId: "story_auto_review_interruption_warning",
    type: "autoReviewInterruptionWarning",
    kind: "systemEvent",
    semanticKind: "autoReviewInterruptionWarning",
    status: "completed",
    markdownText: "Automatic approval review rejected too many approval requests for this turn",
    rawItem: {
      id: "story_auto_review_interruption_warning",
      type: "autoReviewInterruptionWarning",
    },
  }),
  multiAgentSettled: [
    buildToolItemBase({
      itemId: "story_multi_agent_settled_spawn",
      entryId: "story_multi_agent_settled_spawn",
      type: "collabAgentToolCall",
      kind: "toolCall",
      semanticKind: "multiAgentAction",
      status: "completed",
      rawItem: {
        id: "story_multi_agent_settled_spawn",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1"],
        receiverThreads: [
          {
            threadId: "thread-agent-1",
            thread: {
              nickname: "@research",
              model: "gpt-5.4-mini",
              agentRole: "worker",
            },
          },
        ],
        prompt: "Audit the transcript renderer parity gaps.",
        agentsStates: {
          "thread-agent-1": {
            status: "completed",
            message: "Bundle walkthrough finished",
          },
        },
      },
    }),
    buildToolItemBase({
      itemId: "story_multi_agent_settled_message",
      entryId: "story_multi_agent_settled_message",
      type: "collabAgentToolCall",
      kind: "toolCall",
      semanticKind: "multiAgentAction",
      status: "completed",
      rawItem: {
        id: "story_multi_agent_settled_message",
        tool: "sendInput",
        status: "completed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1"],
        receiverThreads: [
          {
            threadId: "thread-agent-1",
            thread: {
              nickname: "@research",
              model: "gpt-5.4-mini",
              agentRole: "worker",
            },
          },
        ],
        prompt: "Summarize the remaining UI parity gaps.",
        agentsStates: {
          "thread-agent-1": {
            status: "running",
            message: "Drafting the findings",
          },
        },
      },
    }),
  ],
  multiAgentInProgress: [
    buildToolItemBase({
      itemId: "story_multi_agent_in_progress",
      entryId: "story_multi_agent_in_progress",
      type: "collabAgentToolCall",
      kind: "toolCall",
      semanticKind: "multiAgentAction",
      status: "inProgress",
      rawItem: {
        id: "story_multi_agent_in_progress",
        tool: "spawnAgent",
        status: "inProgress",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1", "thread-agent-2"],
        receiverThreads: [
          {
            threadId: "thread-agent-1",
            thread: {
              nickname: "@research",
              model: "gpt-5.4-mini",
              agentRole: "worker",
            },
          },
          {
            threadId: "thread-agent-2",
            thread: {
              nickname: "@ui",
              model: "gpt-5.4-mini",
              agentRole: "worker",
            },
          },
        ],
        prompt: "Investigate the Storybook visual mismatch.",
        agentsStates: {
          "thread-agent-1": {
            status: "pendingInit",
            message: null,
          },
          "thread-agent-2": {
            status: "running",
            message: "Reading the renderer stories",
          },
        },
      },
    }),
  ],
  multiAgentFailed: [
    buildToolItemBase({
      itemId: "story_multi_agent_failed",
      entryId: "story_multi_agent_failed",
      type: "collabAgentToolCall",
      kind: "toolCall",
      semanticKind: "multiAgentAction",
      status: "failed",
      rawItem: {
        id: "story_multi_agent_failed",
        tool: "closeAgent",
        status: "failed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1"],
        receiverThreads: [
          {
            threadId: "thread-agent-1",
            thread: {
              nickname: "@research",
              model: "gpt-5.4-mini",
              agentRole: "worker",
            },
          },
        ],
        prompt: null,
        agentsStates: {
          "thread-agent-1": {
            status: "errored",
            message: "Agent did not respond before close",
          },
        },
      },
    }),
  ],
  multiAgentPromptMetadata: [
    buildToolItemBase({
      itemId: "story_multi_agent_prompt_metadata",
      entryId: "story_multi_agent_prompt_metadata",
      type: "collabAgentToolCall",
      kind: "toolCall",
      semanticKind: "multiAgentAction",
      status: "completed",
      rawItem: {
        id: "story_multi_agent_prompt_metadata",
        tool: "resumeAgent",
        status: "completed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-agent-1"],
        receiverThreads: [
          {
            threadId: "thread-agent-1",
            thread: {
              nickname: "@research",
              model: "gpt-5.4-mini",
              agentRole: "worker",
            },
          },
        ],
        prompt: "Resume the parity audit.\nFocus on the multi-agent row body and prompt metadata.",
        agentsStates: {
          "thread-agent-1": {
            status: "completed",
            message: "Ready for the next instruction",
          },
        },
      },
    }),
  ],
};

export const THREAD_REQUEST_CARD_STORY_DATA = {
  approval: {
    type: "approval" as const,
    requestId: "approval_story_card",
    kind: "command" as const,
    projectId: STORY_PROJECT_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_request_approval",
    approvalReason: "Do you want to let me restage the thread Storybook files and verify the index state before committing?",
    reason: "Do you want to let me restage the thread Storybook files and verify the index state before committing?",
    command: [
      "git add docs/FRONTEND.md",
      "src/renderer/features/local-conversation/view/shared/request-cards/local-conversation-request-cards.stories.tsx",
      "src/renderer/features/local-conversation/view/shared/tools/thread-tool-calls.stories.tsx",
      "&& git status --short",
    ].join("\n"),
    cwd: STORY_WORKSPACE_PATH,
    cmd: [
      "git",
      "add",
      "docs/FRONTEND.md",
    ],
    proposedExecpolicyAmendment: ["git", "add"],
    createdAt: 1,
  },
  fileApproval: {
    type: "approval" as const,
    requestId: "file_approval_story_card",
    kind: "file" as const,
    projectId: STORY_PROJECT_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_file_approval",
    grantRoot: STORY_WORKSPACE_PATH,
    createdAt: 1,
  },
  fileApprovalItem: buildStoryConversationItem({
    turnId: "turn_story_request",
    itemId: "item_story_file_approval",
    entryId: "item_story_file_approval",
    type: "file_change",
    kind: "fileChange",
    semanticKind: "patch",
    status: "inProgress",
    approvalRequestId: "file_approval_story_card",
    fileChange: {
      changes: buildCodexFileChangeMap([
        { type: "add", path: "src/generated-preview.ts", content: "export const preview = true;\n" },
        {
          type: "update",
          path: "src/generated-preview.ts",
          movePath: null,
          unifiedDiff: [
            "@@ -1,1 +1,2 @@",
            "-export const preview = false;",
            "+export const preview = true;",
            "+export const ready = true;",
          ].join("\n"),
        },
      ]),
    },
    createdAt: 1,
    updatedAt: 1,
  }),
  userInput: {
    type: "userInput" as const,
    requestId: "user_input_story_card",
    projectId: STORY_PROJECT_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_request_user_input",
    questions: buildUserInputQuestions(),
    createdAt: 1,
  },
  userInputResponse: {
    userInputQuestions: buildUserInputQuestions(),
    userInputAnswers: {
      thread_scope: ["Both surfaces"],
      storybook_shape: ["Hybrid gallery"],
    },
    status: "completed" as const,
  },
  userInputResponseEmpty: {
    userInputQuestions: buildUserInputQuestions(),
    userInputAnswers: {},
    status: "completed" as const,
  },
  userInputResponseInProgress: {
    userInputQuestions: buildUserInputQuestions(),
    userInputAnswers: {},
    status: "inProgress" as const,
  },
  implementPlan: {
    type: "implementPlan" as const,
    requestId: "implement_plan_story_card",
    projectId: STORY_PROJECT_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_request_plan",
    createdAt: 1,
    planContent: [
      "1. Build reusable thread Storybook fixtures.",
      "2. Add a composed stage story plus focused leaf stories.",
      "3. Validate with build:storybook, typecheck, lint, and targeted Bun tests.",
    ].join("\n"),
  },
  permissionRequest: {
    type: "permissionRequest" as const,
    requestId: "permission_story_card",
    projectId: STORY_PROJECT_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_request_permission",
    cwd: STORY_WORKSPACE_PATH,
    reason: "Codex needs network access and read access to the generated Storybook output for this turn.",
    permissions: {
      network: {
        enabled: true,
      },
      fileSystem: {
        read: null,
        write: null,
        entries: [
          {
            path: {
              type: "path" as const,
              path: STORY_WORKSPACE_PATH,
            },
            access: "read" as const,
          },
        ],
      },
    },
    response: null,
    completed: false,
    createdAt: 1,
  },
  mcpServerElicitation: {
    type: "mcpServerElicitation" as const,
    requestId: "mcp_story_card",
    projectId: STORY_PROJECT_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_request_mcp",
    kind: "generic" as const,
    mode: "form" as const,
    serverName: "Context7",
    message: "Allow this MCP server call to continue?",
    requestedSchema: {
      type: "object",
      required: ["project"],
      properties: {
        project: {
          type: "string",
          title: "Project",
          description: "Repository or package name to inspect",
        },
        branch: {
          type: "string",
          title: "Branch",
          description: "Optional branch override",
        },
      },
    },
    createdAt: 1,
  },
};

function buildScenarioRuntime(controls: ThreadStageStoryControls): ThreadStageStoryScenario {
  const preset = resolveThreadStageStoryPreset(controls.preset);
  const transportCard = buildStoryCard();
  const permissionDescription = controls.permissionMode === "custom"
    ? "Custom policy: allow reads, searches, and tests; require approval for file writes."
    : "Custom policy is not active for this preset.";

  const completedConversation = buildPrimaryCompletedConversation();
  const collapsedAgentBodyByTurnId: Record<string, boolean> =
    controls.collapseAgentBody ? { turn_story_latest: true } : {};

  const baseRuntime: ThreadStageStoryRuntimeState = {
    isNewThreadTab: false,
    newThreadTarget: null,
    activeThreadId: STORY_THREAD_ID,
    activeThreadSummary: completedConversation,
    conversation: completedConversation,
    knownConversationsById: {
      [STORY_THREAD_ID]: completedConversation,
    },
    searchOpenTick: 0,
    composerIntent: null,
    threadStartProgress: null,
    logs: [],
  };

  if (controls.preset === "new-thread") {
    return {
      preset,
      runtime: {
        ...baseRuntime,
        isNewThreadTab: true,
        newThreadTarget: STORY_NEW_THREAD_TARGET,
        activeThreadId: null,
        activeThreadSummary: null,
        conversation: null,
        knownConversationsById: {},
      },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "session-starting-local") {
    const conversation = buildStoryConversation({
      statusType: "active",
      threadPreview: "Build a direct new-chat handoff.",
      turns: [
        buildStoryConversationTurn({
          turnId: "turn_story_first_local",
          status: "inProgress",
          items: [
            buildStoryConversationItem({
              turnId: "turn_story_first_local",
              itemId: "user_story_first_local",
              type: "user_message",
              kind: "userMessage",
              semanticKind: "userMessage",
              role: "user",
              markdownText: "Remove the extra new-chat start transitions.",
              createdAt: 12_000,
              updatedAt: 12_000,
            }),
          ],
        }),
      ],
      updatedAt: 12_000,
    });
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
        threadStartProgress: {
          runInTarget: "localProject",
          threadId: conversation.threadId,
          phase: "ready",
          message: "Message sent.",
          outputText: "",
          updatedAt: 12_001,
        },
      },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "session-starting-worktree") {
    const conversation = buildStoryConversation({
      statusType: "idle",
      turns: [],
      updatedAt: 12_000,
    });
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
        threadStartProgress: {
          runInTarget: "newWorktree",
          threadId: conversation.threadId,
          phase: "runningSetup",
          message: "Preparing worktree...",
          outputText: "bun install\nbun run setup:local\n",
          updatedAt: 12_001,
        },
      },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "existing-empty") {
    const conversation = buildStoryConversation({
      statusType: "idle",
      turns: [],
      updatedAt: 10_000,
    });
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "resuming") {
    const conversation = buildStoryConversation({
      resumeState: "resuming",
      turns: [],
      updatedAt: 14_000,
    });
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "streaming") {
    const conversation = buildStreamingConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "long-thread-streaming") {
    const conversation = buildLongThreadStreamingConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "long-thread-search-open") {
    const conversation = buildLongThreadStreamingConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
        searchOpenTick: 1,
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "approval-lane") {
    const conversation = buildApprovalRequestConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "tool-call-mixed") {
    const conversation = buildMixedToolCallConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "user-input-lane") {
    const conversation = buildUserInputRequestConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "implement-plan") {
    const conversation = buildImplementPlanConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: conversation,
        conversation,
        knownConversationsById: { [conversation.threadId]: conversation },
      },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "background-activity") {
    const background = buildBackgroundConversation();
    return {
      preset,
      runtime: {
        ...baseRuntime,
        activeThreadSummary: background.conversation,
        conversation: background.conversation,
        knownConversationsById: background.knownConversationsById,
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "search-open") {
    return {
      preset,
      runtime: {
        ...baseRuntime,
        searchOpenTick: 1,
      },
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "inline-edit-open") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
      autoAction: "openEdit",
    };
  }

  if (controls.preset === "inline-edit-failure") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
      autoAction: "submitEditFailure",
    };
  }

  if (controls.preset === "latest-turn-fork") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
      autoAction: "triggerLatestFork",
    };
  }

  if (controls.preset === "older-turn-fork") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: { collapsedAgentBodyByTurnId },
      transportCard,
      permissionDescription,
      autoAction: "openOlderFork",
    };
  }

  return {
    preset,
    runtime: baseRuntime,
    initialUiState: { collapsedAgentBodyByTurnId },
    transportCard,
    permissionDescription,
  };
}

export function buildThreadStageStoryScenario(controls: ThreadStageStoryControls): ThreadStageStoryScenario {
  return buildScenarioRuntime(controls);
}

function resolveStoryThreadTitle(
  runtime: ThreadStageStoryRuntimeState,
): string {
  return (
    runtime.conversation?.threadName ||
    runtime.conversation?.threadPreview ||
    runtime.activeThreadSummary?.threadName ||
    runtime.activeThreadSummary?.threadPreview ||
    (runtime.isNewThreadTab ? "New thread" : "No thread")
  );
}

export function buildThreadStageStorySurfaceModels(
  scenario: ThreadStageStoryScenario,
  controls: ThreadStageStoryControls,
  runtime: ThreadStageStoryRuntimeState,
): ThreadStageStorySurfaceModels {
  void scenario;
  const readyThreadId = runtime.threadStartProgress?.phase === "ready"
    ? runtime.threadStartProgress.threadId?.trim()
    : null;
  const activeThreadId = runtime.isNewThreadTab
    ? readyThreadId || null
    : runtime.activeThreadId;
  const conversation = runtime.conversation;
  const turns = conversation?.turns ?? [];
  const requests = conversation?.requests ?? [];
  const resumeState = conversation?.resumeState ?? null;
  const statusType = conversation?.statusType ?? null;
  const capabilityFlags = conversation?.capabilityFlags ?? {
    canEditLastUserTurn: false,
    canForkFromTurn: false,
    canSearch: false,
    canCollapseTurns: false,
  };
  const parentTurns: readonly CodexConversationTurn[] = [];
  const body = buildThreadBodyModel({
    activeThreadId,
    threadId: activeThreadId,
    turns,
    requests,
    resumeState,
    statusType,
    archived: conversation?.archived ?? false,
    capabilityFlags,
    parentTurns,
    isNewThreadTab: runtime.isNewThreadTab,
    newThreadTarget: runtime.newThreadTarget,
    isCloudNewThreadTarget: Boolean(
      runtime.isNewThreadTab && runtime.newThreadTarget?.runInTarget === "cloud",
    ),
    threadStartProgress: runtime.threadStartProgress,
  });

  const headerModel: ThreadStageHeaderModel = {
    projectId: conversation?.projectId ?? runtime.activeThreadSummary?.projectId ?? STORY_PROJECT_ID,
    threadId: conversation?.threadId ?? runtime.activeThreadSummary?.threadId ?? activeThreadId,
    title: resolveStoryThreadTitle(runtime),
    connection: DEFAULT_CONNECTION,
    account: controls.authenticatedAccount ? DEFAULT_ACCOUNT_AUTHENTICATED : DEFAULT_ACCOUNT_SIGNED_OUT,
  };

  const primaryRequest = selectPrimaryConversationRequest(conversation);
  const composerShell = buildComposerShellModel({
    threadId: activeThreadId,
    turns,
    requests,
    pendingSteers: conversation?.pendingSteers ?? [],
    queuedFollowUps: conversation?.queuedFollowUps ?? [],
    backgroundTerminalRows: conversation?.backgroundTerminalRows ?? [],
    childMemberships: conversation?.childMemberships ?? [],
    statusType,
    statusActiveFlags: conversation?.statusActiveFlags ?? [],
    knownConversationsById: runtime.knownConversationsById,
    primaryRequest,
  });

  const activeTurn = [...turns].reverse().find((turn) => turn.status === "inProgress") ?? null;
  const footerModel: ThreadFooterModel = {
    projectId: STORY_PROJECT_ID,
    projectWorkspacePath: STORY_WORKSPACE_PATH,
    threadId: activeThreadId,
    cwd: conversation?.cwd ?? null,
    account: controls.authenticatedAccount ? DEFAULT_ACCOUNT_AUTHENTICATED : DEFAULT_ACCOUNT_SIGNED_OUT,
    conversation,
    resumeState,
    activeTurn,
    isThreadRunning: Boolean(activeTurn || statusType === "active"),
    isNewThreadTab: runtime.isNewThreadTab,
    isCloudNewThreadTarget: Boolean(
      runtime.isNewThreadTab && runtime.newThreadTarget?.runInTarget === "cloud",
    ),
    newThreadTarget: runtime.newThreadTarget,
    composerShell,
    body,
    collaborationModes: DEFAULT_COLLABORATION_MODES,
    selectedCollaborationMode: "default",
    selectedModel: DEFAULT_MODELS[0]?.model ?? "",
    availableModels: DEFAULT_MODELS,
    selectedReasoningEffort: "high",
    reasoningEffortOptions: DEFAULT_REASONING_OPTIONS,
    permissionMode: controls.permissionMode,
    isQueueingEnabled: controls.isQueueingEnabled,
    composerEnterBehavior: "enter",
    composerIntent: runtime.composerIntent,
    dictation: DEFAULT_DICTATION_STATE,
  };

  const bodyModel: ThreadBodySurfaceModel = {
    projectId: STORY_PROJECT_ID,
    threadId: activeThreadId,
    isSideChat: false,
    cwd: conversation?.cwd ?? null,
    turns,
    requests,
    resumeState,
    statusType,
    capabilityFlags,
    body,
    parentTurns,
    projectWorkspacePath: STORY_WORKSPACE_PATH,
    searchOpenTick: runtime.searchOpenTick,
    threadStartProgress: runtime.threadStartProgress,
  };

  return {
    headerModel,
    bodyModel,
    footerModel,
  };
}

type StorybookBridge = Window["api"];

function createStorybookElectronBridge(input: {
  card: Card;
  permissionMode: CodexPermissionMode;
  permissionDescription: string;
}): StorybookBridge {
  const listeners: StorybookElectronBridgeListenerMap = {
    "git:branch:changed": [],
  };

  let branchState = {
    currentBranch: "codex/thread-storybook",
    defaultBranch: "main",
    branches: ["main", "codex/thread-storybook", "codex/thread-stage-gallery"],
  };

  const emit = (event: keyof StorybookElectronBridgeListenerMap, payload: { cwd: string }) => {
    for (const listener of listeners[event]) {
      listener(payload);
    }
  };

  return {
    invoke: async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "card:get": {
          const [, cardId] = args as [string, string];
          return cardId === input.card.id ? input.card : null;
        }
        case "codex:permission:custom-description:get":
          return input.permissionDescription;
        case "codex:permission:state:get":
        case "codex:permission:mode:set":
        case "codex:permission:config-value:set":
          return {
            mode: input.permissionMode,
            effectivePreset: input.permissionMode === "custom" ? "custom" : input.permissionMode,
            availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
            approvalPolicy: "on-request",
            approvalsReviewer: input.permissionMode === "guardian-approvals" ? "auto_review" : "user",
            sandboxMode: input.permissionMode === "full-access" ? "danger-full-access" : "workspace-write",
            sandbox: input.permissionMode === "full-access"
              ? { type: "dangerFullAccess" }
              : {
                  type: "workspaceWrite",
                  writableRoots: ["/tmp/project"],
                  readOnlyAccess: { type: "fullAccess" },
                  networkAccess: false,
                  excludeTmpdirEnvVar: false,
                  excludeSlashTmp: false,
                },
            guardianApprovalEnabled: true,
            configTarget: {
              source: "user",
              filePath: "/tmp/project/.codex/config.toml",
            },
            customDescription: input.permissionDescription,
          };
        case "git:branch:state":
          return branchState;
        case "git:branch:watch:start":
        case "git:branch:watch:stop":
          return true;
        case "git:branch:checkout": {
          const [payload] = args as [{ cwd: string; branch: string }];
          branchState = {
            ...branchState,
            currentBranch: payload.branch,
            branches: branchState.branches.includes(payload.branch)
              ? branchState.branches
              : [payload.branch, ...branchState.branches],
          };
          emit("git:branch:changed", { cwd: payload.cwd });
          return branchState;
        }
        case "git:branch:create": {
          const [payload] = args as [{ cwd: string; branch: string }];
          branchState = {
            ...branchState,
            currentBranch: payload.branch,
            branches: branchState.branches.includes(payload.branch)
              ? branchState.branches
              : [payload.branch, ...branchState.branches],
          };
          emit("git:branch:changed", { cwd: payload.cwd });
          return branchState;
        }
        default:
          return null;
      }
    },
    on: (event: string, callback: (...args: unknown[]) => void) => {
      if (event === "git:branch:changed") {
        const listener = (payload: { cwd: string }) => callback(payload);
        listeners["git:branch:changed"].push(listener);
        return () => {
          listeners["git:branch:changed"] = listeners["git:branch:changed"].filter(
            (candidate) => candidate !== listener,
          );
        };
      }
      return () => { };
    },
  } as StorybookBridge;
}

export function StorybookElectronTransportBoundary({
  card,
  permissionMode,
  permissionDescription,
  children,
}: {
  card: Card;
  permissionMode: CodexPermissionMode;
  permissionDescription: string;
  children: ReactNode;
}) {
  const bridge = useMemo(
    () => createStorybookElectronBridge({ card, permissionMode, permissionDescription }),
    [card, permissionDescription, permissionMode],
  );

  useEffect(() => {
    const previousBridge = window.api;
    window.api = bridge;
    initializeStorybookRendererDocument();
    return () => {
      window.api = previousBridge;
      initializeStorybookRendererDocument();
    };
  }, [bridge]);

  return <>{children}</>;
}
