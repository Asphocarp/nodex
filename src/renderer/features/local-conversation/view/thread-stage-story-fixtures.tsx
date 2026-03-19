import { useEffect, useMemo, type ReactNode } from "react";
import type {
  Card,
  CodexAccountSnapshot,
  CodexCollaborationModePreset,
  CodexCommandAction,
  CodexComposerIntent,
  CodexConnectionState,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexModelOption,
  CodexPermissionMode,
  CodexReasoningEffortOption,
  CodexThreadSummary,
  CodexTranscriptEntry,
  CodexUserInputRequest,
} from "@/lib/types";
import { buildThreadStageModel } from "../projection/build-thread-stage-model";
import type {
  ThreadBodyUiStateOverrides,
  ThreadStageModel,
  ThreadStageModelInput,
} from "../thread-stage-types";

export type ThreadStageStoryPresetId =
  | "new-thread"
  | "existing-empty"
  | "resuming"
  | "streaming"
  | "completed-collapsed"
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
  collapseToolCalls: boolean;
}

export interface ThreadStageStoryPreset {
  id: ThreadStageStoryPresetId;
  name: string;
  description: string;
}

export interface ThreadStageStoryRuntimeState {
  isNewThreadTab: boolean;
  newThreadTarget: ThreadStageModelInput["newThreadTarget"];
  activeThreadId: string | null;
  activeThreadSummary: CodexThreadSummary | null;
  conversation: CodexConversationSnapshot | null;
  knownConversationsById: Record<string, CodexConversationSnapshot>;
  dismissedPlanImplementationTurnIdByThread: Record<string, string>;
  searchOpenTick: number;
  composerIntent: CodexComposerIntent | null;
  threadStartProgress: ThreadStageModelInput["threadStartProgress"];
  logs: string[];
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
  const isElectronWindow = Boolean(window.api);

  root.dataset.codexWindowType = isElectronWindow ? "electron" : "browser";
  window.__NODEX_STORYBOOK__ = true;

  if (!isElectronWindow) {
    root.classList.remove("electron-dark", "electron-light");
    return;
  }

  const isDark = root.classList.contains("dark");
  root.classList.toggle("electron-dark", isDark);
  root.classList.toggle("electron-light", !isDark);
}

const STORY_PROJECT_ID = "storybook-local-conversation";
const STORY_CARD_ID = "card-thread-storybook";
const STORY_COLUMN_ID = "in-progress";
const STORY_WORKSPACE_PATH = "/workspace/nodex";
const STORY_THREAD_ID = "thread_storybook";
const STORY_NEW_THREAD_TARGET: NonNullable<ThreadStageModelInput["newThreadTarget"]> = {
  projectId: STORY_PROJECT_ID,
  projectName: "Nodex",
  cardId: STORY_CARD_ID,
  cardTitle: "Add Storybook coverage for thread surfaces",
  columnId: STORY_COLUMN_ID,
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

type StoryUserInputQuestion = CodexUserInputRequest["questions"][number];

export const THREAD_STAGE_STORY_PRESETS: ThreadStageStoryPreset[] = [
  {
    id: "new-thread",
    name: "New Thread",
    description: "Empty new-thread state with the real footer and branch controls still mounted.",
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
    id: "completed-collapsed",
    name: "Completed Collapsed",
    description: "Completed turn with prior agent work collapsed ahead of the final answer.",
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
    cardId: STORY_CARD_ID,
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

function buildApprovalRequestConversation(): CodexConversationSnapshot {
  return buildStreamingConversation({
    requests: [
      {
        type: "approval",
        requestId: "approval_story_active",
        kind: "command",
        projectId: STORY_PROJECT_ID,
        cardId: STORY_CARD_ID,
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
        cardId: STORY_CARD_ID,
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
              "1. Add story fixtures on top of buildThreadStageModel.",
              "2. Cover tool-call families and request cards with focused stories.",
              "3. Extract the threadSection row for editor and Storybook reuse.",
            ].join("\n"),
            createdAt: 25_000,
            updatedAt: 29_000,
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
        cardId: STORY_CARD_ID,
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
      },
    ],
    backgroundTerminalRows: [
      {
        rowId: "background_row_story_1",
        threadId: backgroundThreadId,
        stream: "stdout",
        text: "worker is still comparing leaf-story density",
        createdAt: 29_000,
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
        cardId: STORY_CARD_ID,
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

export const THREAD_TOOL_CALL_STORY_ITEMS = {
  command: buildToolItemBase({
    itemId: "tool_story_command",
    type: "command_execution",
    kind: "commandExecution",
    semanticKind: "exec",
    status: "completed",
    toolCall: {
      subtype: "command",
      toolName: "exec_command",
      args: {
        command: "rg --files src/renderer/features/local-conversation",
        cwd: STORY_WORKSPACE_PATH,
        summaryLabel: "Explored thread renderer files",
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
      },
      result: "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx\nsrc/renderer/features/local-conversation/view/local-conversation-thread-body.tsx",
    },
  }),
  fileChange: buildToolItemBase({
    itemId: "tool_story_file_change",
    type: "file_change",
    kind: "fileChange",
    semanticKind: "patch",
    toolCall: {
      subtype: "fileChange",
      toolName: "file_change",
      args: {
        changes: [
          {
            path: "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
            diff: [
              "@@ -1,5 +1,7 @@",
              " import { useState } from \"react\";",
              "+import { StoryShell } from \"./thread-stage-dev-story\";",
              "",
              " export function LocalConversationStageScreen() {",
              "+  return <StoryShell />;",
              " }",
            ].join("\n"),
          },
        ],
      },
      result: {
        diff: [
          "--- a/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
          "+++ b/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
          "@@ -1,5 +1,7 @@",
          " import { useState } from \"react\";",
          "+import { StoryShell } from \"./thread-stage-dev-story\";",
          "",
          " export function LocalConversationStageScreen() {",
          "+  return <StoryShell />;",
          " }",
        ].join("\n"),
      },
    },
  }),
  turnDiff: buildToolItemBase({
    itemId: "tool_story_turn_diff",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    rawItem: {
      type: "turn-diff",
      unifiedDiff: [
        "--- a/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
        "+++ b/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
        "@@ -1,5 +1,7 @@",
        " import { useState } from \"react\";",
        "+import { StoryShell } from \"./thread-stage-dev-story\";",
        "",
        " export function LocalConversationStageScreen() {",
        "+  return <StoryShell />;",
        " }",
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
  }),
  generic: buildToolItemBase({
    itemId: "tool_story_generic",
    type: "tool_call",
    semanticKind: "toolCall",
    toolCall: {
      subtype: "generic",
      server: "internal",
      toolName: "summarize_stage_shell",
      args: { section: "footer" },
      result: { summary: "The composer hides behind blocking request surfaces." },
    },
  }),
  genericRawOnly: buildToolItemBase({
    itemId: "tool_story_generic_raw_only",
    type: "tool_call",
    semanticKind: "toolCall",
    markdownText: "Unknown tool payload",
    rawItem: {
      type: "opaque_tool_call",
      tool: "workspace.snapshot_shell",
      payload: {
        panel: "footer",
        lines: 3,
      },
    },
  }),
  multiAgent: [
    buildToolItemBase({
      itemId: "tool_story_multi_agent_command",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      toolCall: {
        subtype: "command",
        toolName: "exec_command",
        args: {
          command: "bun test src/renderer/features/local-conversation/view/local-conversation-thread-body.test.tsx",
          cwd: STORY_WORKSPACE_PATH,
        },
        result: "4 passed",
      },
    }),
    buildToolItemBase({
      itemId: "tool_story_multi_agent_web",
      type: "web_search",
      semanticKind: "webSearch",
      toolCall: {
        subtype: "webSearch",
        toolName: "web_search",
        args: { query: "storybook canvas-first control-driven stories" },
        result: { hitCount: 2 },
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
    cardId: STORY_CARD_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_request_approval",
    reason: "Approve the final Storybook build before packaging.",
    command: "bun run build:storybook",
    cwd: STORY_WORKSPACE_PATH,
    createdAt: 1,
  },
  userInput: {
    type: "userInput" as const,
    requestId: "user_input_story_card",
    projectId: STORY_PROJECT_ID,
    cardId: STORY_CARD_ID,
    threadId: STORY_THREAD_ID,
    turnId: "turn_story_request",
    itemId: "item_story_request_user_input",
    questions: buildUserInputQuestions(),
    createdAt: 1,
  },
  answeredUserInput: {
    userInputQuestions: buildUserInputQuestions(),
    userInputAnswers: {
      thread_scope: ["Both surfaces"],
      storybook_shape: ["Hybrid gallery"],
    },
    status: "completed" as const,
  },
  answeredUserInputEmpty: {
    userInputQuestions: buildUserInputQuestions(),
    userInputAnswers: {},
    status: "completed" as const,
  },
  answeredUserInputInProgress: {
    userInputQuestions: buildUserInputQuestions(),
    userInputAnswers: {},
    status: "inProgress" as const,
  },
  implementPlan: {
    type: "implementPlan" as const,
    requestId: "implement_plan_story_card",
    projectId: STORY_PROJECT_ID,
    cardId: STORY_CARD_ID,
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
  const collapsedToolItemIds = controls.collapseToolCalls ? ["exec_story_latest", "exec_story_streaming"] : [];

  const baseRuntime: ThreadStageStoryRuntimeState = {
    isNewThreadTab: false,
    newThreadTarget: null,
    activeThreadId: STORY_THREAD_ID,
    activeThreadSummary: completedConversation,
    conversation: completedConversation,
    knownConversationsById: {
      [STORY_THREAD_ID]: completedConversation,
    },
    dismissedPlanImplementationTurnIdByThread: {},
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
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
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
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
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
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
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
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
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
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
      transportCard,
      permissionDescription,
    };
  }

  if (controls.preset === "inline-edit-open") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
      transportCard,
      permissionDescription,
      autoAction: "openEdit",
    };
  }

  if (controls.preset === "inline-edit-failure") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
      transportCard,
      permissionDescription,
      autoAction: "submitEditFailure",
    };
  }

  if (controls.preset === "latest-turn-fork") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
      transportCard,
      permissionDescription,
      autoAction: "triggerLatestFork",
    };
  }

  if (controls.preset === "older-turn-fork") {
    return {
      preset,
      runtime: baseRuntime,
      initialUiState: {
        collapsedAgentBodyByTurnId,
        collapsedToolItemIds,
      },
      transportCard,
      permissionDescription,
      autoAction: "openOlderFork",
    };
  }

  return {
    preset,
    runtime: baseRuntime,
    initialUiState: {
      collapsedAgentBodyByTurnId,
      collapsedToolItemIds,
    },
    transportCard,
    permissionDescription,
  };
}

export function buildThreadStageStoryScenario(controls: ThreadStageStoryControls): ThreadStageStoryScenario {
  return buildScenarioRuntime(controls);
}

export function buildThreadStageStoryModel(
  scenario: ThreadStageStoryScenario,
  controls: ThreadStageStoryControls,
  runtime: ThreadStageStoryRuntimeState,
): ThreadStageModel {
  const input: ThreadStageModelInput = {
    projectId: STORY_PROJECT_ID,
    projectWorkspacePath: STORY_WORKSPACE_PATH,
    isNewThreadTab: runtime.isNewThreadTab,
    newThreadTarget: runtime.newThreadTarget,
    activeThreadCardColumnId: STORY_COLUMN_ID,
    threadStartProgress: runtime.threadStartProgress,
    activeThreadId: runtime.activeThreadId,
    activeThreadSummary: runtime.activeThreadSummary,
    conversation: runtime.conversation,
    knownConversationsById: runtime.knownConversationsById,
    dismissedPlanImplementationTurnIdByThread: runtime.dismissedPlanImplementationTurnIdByThread,
    connection: DEFAULT_CONNECTION,
    account: controls.authenticatedAccount ? DEFAULT_ACCOUNT_AUTHENTICATED : DEFAULT_ACCOUNT_SIGNED_OUT,
    availableModels: DEFAULT_MODELS,
    collaborationModes: DEFAULT_COLLABORATION_MODES,
    selectedCollaborationMode: "default",
    selectedModel: DEFAULT_MODELS[0]?.model ?? "gpt-5.3-codex",
    selectedReasoningEffort: "high",
    reasoningEffortOptions: DEFAULT_REASONING_OPTIONS,
    permissionMode: controls.permissionMode,
    isQueueingEnabled: controls.isQueueingEnabled,
    promptSubmitShortcut: "enter",
    searchOpenTick: runtime.searchOpenTick,
    composerIntent: runtime.composerIntent,
  };

  return buildThreadStageModel(input);
}

type StorybookBridge = Window["api"];

function createStorybookElectronBridge(input: {
  card: Card;
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
      return () => {};
    },
  } as StorybookBridge;
}

export function StorybookElectronTransportBoundary({
  card,
  permissionDescription,
  children,
}: {
  card: Card;
  permissionDescription: string;
  children: ReactNode;
}) {
  const bridge = useMemo(
    () => createStorybookElectronBridge({ card, permissionDescription }),
    [card, permissionDescription],
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
