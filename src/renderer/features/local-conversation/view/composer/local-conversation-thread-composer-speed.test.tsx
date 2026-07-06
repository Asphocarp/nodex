import { beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { AppProviders } from "@/app-providers";
import {
  __getNodexToastSnapshotForTests,
  __resetNodexToastStoreForTests,
} from "@/components/ui/toast";
import { render, settleAsyncRender } from "@/test/dom";
import {
  installAsyncRequestAnimationFrame,
  installWindowApi,
} from "@/test/browser-globals";
import { clearPersistedAtomStoreForTests } from "@/lib/persisted-atom-store";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import { ThreadComposer, __composerAddContextTestUtils } from "./local-conversation-thread-composer";

const CODEX_FAST_MODE_ICON_PATH =
  "M9.80999 17.8302C9.49666 18.1969 9.08999 18.3869 8.58999 18.4002C8.09666 18.4136 7.69666 18.2436 7.38999 17.8902C7.08999 17.5436 7.02666 17.0636 7.19999 16.4502L8.06999 13.2902H3.89999C3.43333 13.2902 3.06999 13.1602 2.80999 12.9002C2.55666 12.6336 2.42999 12.3136 2.42999 11.9402C2.42999 11.5602 2.55666 11.2169 2.80999 10.9102L10.16 2.18022C10.4733 1.81356 10.8767 1.62356 11.37 1.61022C11.87 1.59689 12.27 1.76689 12.57 2.12022C12.8767 2.47356 12.9433 2.95356 12.77 3.56023L11.87 6.78023H16.05C16.51 6.78023 16.87 6.91356 17.13 7.18023C17.3967 7.44023 17.53 7.76023 17.53 8.14023C17.53 8.52023 17.4 8.86023 17.14 9.16023L9.80999 17.8302ZM15.89 8.50023C15.93 8.44689 15.95 8.39356 15.95 8.34023C15.9567 8.28689 15.94 8.24356 15.9 8.21023C15.86 8.17023 15.8033 8.15023 15.73 8.15023H11.1C10.9133 8.15023 10.7533 8.10356 10.62 8.01023C10.4933 7.91689 10.4067 7.79023 10.36 7.63023C10.3133 7.47023 10.3167 7.29023 10.37 7.09023L11.33 3.62022C11.3567 3.52022 11.3467 3.44356 11.3 3.39022C11.2533 3.33022 11.19 3.30356 11.11 3.31022C11.0367 3.31689 10.9733 3.35356 10.92 3.42023L4.04999 11.5702C4.00999 11.6236 3.98666 11.6769 3.97999 11.7302C3.97999 11.7836 3.99999 11.8269 4.03999 11.8602C4.07999 11.8936 4.13999 11.9102 4.21999 11.9102H8.78999C9.00333 11.9102 9.17666 11.9569 9.30999 12.0502C9.44999 12.1436 9.54333 12.2736 9.58999 12.4402C9.63666 12.6002 9.63333 12.7802 9.57999 12.9802L8.63999 16.3902C8.61333 16.4902 8.62333 16.5702 8.66999 16.6302C8.71666 16.6836 8.77666 16.7069 8.84999 16.7002C8.92999 16.6936 8.99666 16.6602 9.04999 16.6002L15.89 8.50023Z";

const storageMap = new Map<string, string>();
const persistedAtomState = new Map<string, unknown>();
type PersistedAtomListener = (...args: unknown[]) => void;
const persistedAtomListeners = new Set<PersistedAtomListener>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key) ?? null : null;
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, value);
  },
  removeItem(key: string): void {
    storageMap.delete(key);
  },
};

if (!(globalThis as { localStorage?: unknown }).localStorage) {
  (globalThis as { localStorage: typeof mockStorage }).localStorage = mockStorage;
}

const localStorageRef = (globalThis as { localStorage: typeof mockStorage }).localStorage;

function resetStorage(): void {
  storageMap.clear();
  persistedAtomState.clear();
  persistedAtomListeners.clear();
  clearPersistedAtomStoreForTests();
  localStorageRef.removeItem("nodex-codex-default-service-tier-v1");
}

type TestInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

function installComposerWindowApi(testInvoke?: TestInvoke): void {
  installWindowApi({
    invoke: async (channel: string, ...args: unknown[]) => {
      if (testInvoke) {
        const result = await testInvoke(channel, ...args);
        if (result !== undefined) return result;
      }
      switch (channel) {
        case "persisted-atom:sync-request":
          return Object.fromEntries(persistedAtomState.entries());
        case "persisted-atom:update": {
          const update = args[0] as { key?: unknown; value?: unknown };
          if (typeof update.key === "string") {
            persistedAtomState.set(update.key, update.value);
            for (const listener of persistedAtomListeners) {
              listener({ key: update.key, value: update.value });
            }
          }
          return Object.fromEntries(persistedAtomState.entries());
        }
        case "codex:permission:state:get":
          return {
            mode: "auto",
            effectivePreset: "auto",
            availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxMode: "workspace-write",
            sandbox: {
              type: "workspaceWrite",
              writableRoots: ["/tmp/project"],
              readOnlyAccess: { type: "fullAccess" },
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
            autoReviewAvailable: true,
            configTarget: {
              source: "user",
              filePath: "/tmp/project/.codex/config.toml",
            },
            customDescription: null,
          };
        case "git:branch:state":
          return {
            currentBranch: "main",
            defaultBranch: "main",
            branches: ["main"],
          };
        case "git:branch:watch:start":
        case "git:branch:watch:stop":
          return true;
        default:
          return null;
      }
    },
    on: (channel: string, listener: PersistedAtomListener) => {
      if (channel !== "persisted-atom:updated") return () => {};
      persistedAtomListeners.add(listener);
      return () => {
        persistedAtomListeners.delete(listener);
      };
    },
  });
}

function buildModel(overrides?: Partial<ThreadFooterModel>): ThreadFooterModel {
  return {
    projectId: "project_1",
    projectWorkspacePath: "/tmp/project",
    threadId: "thread_1",
    cwd: "/tmp/project",
    account: {
      account: {
        type: "chatgpt",
        email: "asc@example.com",
        planType: "Pro",
      },
      requiresOpenAiAuth: false,
      pendingLogin: null,
      rateLimits: null,
    },
    conversation: {
      threadId: "thread_1",
      projectId: "project_1",
      source: null,
      threadName: "Thread",
      threadPreview: "Preview",
      modelProvider: "openai",
      cwd: "/tmp/project",
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      createdAt: 1,
      updatedAt: 2,
      linkedAt: "2026-04-06T00:00:00.000Z",
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
    },
    resumeState: "resumed",
    activeTurn: null,
    isThreadRunning: false,
    isNewThreadTab: false,
    isCloudNewThreadTarget: false,
    newThreadTarget: null,
    collaborationModes: [
      { mode: "default", name: "Default", model: null },
      { mode: "plan", name: "Plan", model: null },
    ],
    selectedCollaborationMode: "default",
    availableModels: [
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        description: "Balanced Codex model.",
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "high", description: "Spend more time reasoning before answering." },
          { reasoningEffort: "medium", description: "Balance speed and deeper reasoning." },
        ],
      },
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "Latest Codex model.",
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "high", description: "Spend more time reasoning before answering." },
        ],
      },
    ],
    selectedModel: "gpt-5.3-codex",
    selectedReasoningEffort: "high",
    reasoningEffortOptions: [
      { reasoningEffort: "high", description: "Spend more time reasoning before answering." },
      { reasoningEffort: "medium", description: "Balance speed and deeper reasoning." },
    ],
    permissionMode: "auto",
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    composerIntent: null,
    dictation: {
      isEnabled: false,
      authMethod: "chatgpt",
      isRealtimeVoiceActive: false,
      shortcutLabel: "Ctrl+M",
    },
    body: {
      threadId: "thread_1",
      turnCount: 1,
      hasAboveComposerBlocks: false,
      isThreadRunning: false,
      activeTurnId: null,
      latestTurnId: "turn_1",
      emptyState: { type: "none" },
      showThreadStartProgressPanel: false,
    },
    composerShell: {
      activeRequest: null,
      backgroundRequest: null,
      pendingSteerRows: [],
      queuedFollowUpRows: [],
      backgroundAgentRows: [],
      backgroundTerminalRows: [],
      showRequestCards: false,
      showComposer: true,
      showApprovalMode: false,
    },
    ...overrides,
  };
}

function buildActions(overrides?: Partial<ThreadStageActions>): ThreadStageActions {
  return {
    onCollaborationModeChange: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPermissionModeChange: () => {},
    onQueueingEnabledChange: () => {},
    onRefreshAccount: async () => ({
      account: null,
      requiresOpenAiAuth: false,
      pendingLogin: null,
      rateLimits: null,
    }),
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => {},
    onLogout: async () => {},
    onSendPrompt: async () => {},
    onSteerPrompt: async () => {},
    onInterruptTurn: async () => {},
    onRespondApproval: async () => {},
    onRespondUserInput: async () => {},
    onRespondMcpElicitation: async () => {},
    onResolvePlanImplementationRequest: async () => {},
    onEnqueueQueuedFollowUp: async () => {},
    onRemoveQueuedFollowUp: async () => {},
    onReorderQueuedFollowUps: async () => {},
    onSendQueuedFollowUpNow: async () => {},
    onEditQueuedFollowUp: async () => {},
    onEditLastUserTurn: async () => {},
    onForkFromTurn: async () => {},
    onCompactThread: async () => {},
    onGetThreadGoal: async () => null,
    onSetThreadGoal: async () => null,
    onClearThreadGoal: async () => {},
    onSetThreadMemoryMode: async () => {},
    onUploadFeedback: async () => {},
    onUnarchiveThread: async () => { },
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    ...overrides,
  };
}

async function settleComposerFrame(): Promise<void> {
  await settleAsyncRender();
  await settleAsyncRender();
}

async function renderComposer(
  overrides?: Partial<ThreadFooterModel>,
  actionOverrides?: Partial<ThreadStageActions>,
  testInvoke?: TestInvoke,
) {
  installAsyncRequestAnimationFrame();
  document.documentElement.dataset.codexWindowType = "electron";
  installComposerWindowApi(testInvoke);

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <AppProviders>
          <ThreadComposer
            model={buildModel(overrides)}
            actions={buildActions(actionOverrides)}
            errorMessage={null}
            onErrorMessage={() => {}}
          />
      </AppProviders>,
    );
  });
  await settleComposerFrame();

  return view;
}

async function submitCurrentComposerDraft(view: ReturnType<typeof render>): Promise<void> {
  const sendButton = view.getByLabelText("Send prompt");
  await waitFor(() => {
    expect((sendButton as HTMLButtonElement).disabled).toBeFalse();
  });
  await act(async () => {
    fireEvent.click(sendButton);
    await Promise.resolve();
  });
}

function buildActiveTurn(): NonNullable<ThreadFooterModel["activeTurn"]> {
  return {
    threadId: "thread_1",
    turnId: "turn_active",
    status: "inProgress",
    itemIds: [],
    items: [],
  };
}

function buildRunningComposerModel(
  overrides?: Partial<ThreadFooterModel>,
): Partial<ThreadFooterModel> {
  return {
    isThreadRunning: true,
    activeTurn: buildActiveTurn(),
    composerIntent: {
      prompt: "Follow up",
      focusNonce: 1,
    },
    body: {
      ...buildModel().body,
      isThreadRunning: true,
      activeTurnId: "turn_active",
    },
    ...overrides,
  };
}

async function keyDownComposer(
  view: ReturnType<typeof render>,
  init: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  options?: { waitForContent?: boolean },
): Promise<boolean> {
  const composer = view.container.querySelector<HTMLElement>('[data-codex-composer="true"]');
  if (!(composer instanceof HTMLElement)) {
    throw new Error("Expected composer editor.");
  }

  if (options?.waitForContent !== false) {
    await waitFor(() => {
      expect(Boolean(composer.textContent ?? "")).toBeTrue();
    });
  }
  composer.focus();
  let wasNotCanceled = true;
  await act(async () => {
    wasNotCanceled = fireEvent.keyDown(composer, init);
    await Promise.resolve();
  });
  return wasNotCanceled;
}

describe("ThreadComposer speed menu", () => {
  beforeEach(() => {
    __resetNodexToastStoreForTests();
  });

  test("cmd-enter queues instead of steering while running in enter mode with queueing disabled", async () => {
    resetStorage();
    const queuedPrompts: string[] = [];
    const steeredPrompts: string[] = [];
    const view = await renderComposer(
      buildRunningComposerModel({
        isQueueingEnabled: false,
        composerEnterBehavior: "enter",
      }),
      {
        onEnqueueQueuedFollowUp: async (_threadId, prompt) => {
          queuedPrompts.push(prompt);
        },
        onSteerPrompt: async (input) => {
          steeredPrompts.push(input.prompt);
        },
      },
    );

    await keyDownComposer(view, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(queuedPrompts.length).toBe(1);
    });
    expect(queuedPrompts[0]).toBe("Follow up");
    expect(steeredPrompts.length).toBe(0);
  });

  test("enter queues and cmd-enter steers while running in enter mode with queueing enabled", async () => {
    resetStorage();
    const primaryQueuedPrompts: string[] = [];
    const primarySteeredPrompts: string[] = [];
    const primaryView = await renderComposer(
      buildRunningComposerModel({
        isQueueingEnabled: true,
        composerEnterBehavior: "enter",
      }),
      {
        onEnqueueQueuedFollowUp: async (_threadId, prompt) => {
          primaryQueuedPrompts.push(prompt);
        },
        onSteerPrompt: async (input) => {
          primarySteeredPrompts.push(input.prompt);
        },
      },
    );

    await keyDownComposer(primaryView, { key: "Enter" });

    await waitFor(() => {
      expect(primaryQueuedPrompts.length).toBe(1);
    });
    expect(primarySteeredPrompts.length).toBe(0);
    primaryView.unmount();

    const alternateQueuedPrompts: string[] = [];
    const alternateSteeredPrompts: string[] = [];
    const alternateView = await renderComposer(
      buildRunningComposerModel({
        isQueueingEnabled: true,
        composerEnterBehavior: "enter",
      }),
      {
        onEnqueueQueuedFollowUp: async (_threadId, prompt) => {
          alternateQueuedPrompts.push(prompt);
        },
        onSteerPrompt: async (input) => {
          alternateSteeredPrompts.push(input.prompt);
        },
      },
    );

    await keyDownComposer(alternateView, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(alternateSteeredPrompts.length).toBe(1);
    });
    expect(alternateSteeredPrompts[0]).toBe("Follow up");
    expect(alternateQueuedPrompts.length).toBe(0);
  });

  test("cmdIfMultiline keeps cmd-enter primary and cmd-shift-enter alternate for multiline drafts", async () => {
    resetStorage();
    const primaryQueuedPrompts: string[] = [];
    const primarySteeredPrompts: string[] = [];
    const primaryView = await renderComposer(
      buildRunningComposerModel({
        composerIntent: {
          prompt: "Line one\nLine two",
          focusNonce: 1,
        },
        isQueueingEnabled: false,
        composerEnterBehavior: "cmdIfMultiline",
      }),
      {
        onEnqueueQueuedFollowUp: async (_threadId, prompt) => {
          primaryQueuedPrompts.push(prompt);
        },
        onSteerPrompt: async (input) => {
          primarySteeredPrompts.push(input.prompt);
        },
      },
    );

    await keyDownComposer(primaryView, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(primarySteeredPrompts.length).toBe(1);
    });
    expect(primarySteeredPrompts[0]).toBe("Line one\nLine two");
    expect(primaryQueuedPrompts.length).toBe(0);
    primaryView.unmount();

    const alternateQueuedPrompts: string[] = [];
    const alternateSteeredPrompts: string[] = [];
    const alternateView = await renderComposer(
      buildRunningComposerModel({
        composerIntent: {
          prompt: "Line one\nLine two",
          focusNonce: 1,
        },
        isQueueingEnabled: false,
        composerEnterBehavior: "cmdIfMultiline",
      }),
      {
        onEnqueueQueuedFollowUp: async (_threadId, prompt) => {
          alternateQueuedPrompts.push(prompt);
        },
        onSteerPrompt: async (input) => {
          alternateSteeredPrompts.push(input.prompt);
        },
      },
    );

    await keyDownComposer(alternateView, { key: "Enter", metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(alternateQueuedPrompts.length).toBe(1);
    });
    expect(alternateQueuedPrompts[0]).toBe("Line one\nLine two");
    expect(alternateSteeredPrompts.length).toBe(0);
  });

  test("primary submit button follows primary action instead of alternate action", async () => {
    resetStorage();
    const queuedPrompts: string[] = [];
    const steeredPrompts: string[] = [];
    const view = await renderComposer(
      buildRunningComposerModel({
        isQueueingEnabled: false,
        composerEnterBehavior: "enter",
      }),
      {
        onEnqueueQueuedFollowUp: async (_threadId, prompt) => {
          queuedPrompts.push(prompt);
        },
        onSteerPrompt: async (input) => {
          steeredPrompts.push(input.prompt);
        },
      },
    );

    const primaryButton = view.getByLabelText("Steer follow-up");
    await waitFor(() => {
      expect((primaryButton as HTMLButtonElement).disabled).toBeFalse();
    });
    await act(async () => {
      fireEvent.click(primaryButton);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(steeredPrompts.length).toBe(1);
    });
    expect(steeredPrompts[0]).toBe("Follow up");
    expect(queuedPrompts.length).toBe(0);
  });

  test("/side command opens a side chat instead of sending a parent-thread prompt", async () => {
    resetStorage();
    const sentPrompts: string[] = [];
    const sideChatInputs: string[] = [];
    const view = await renderComposer(
      {
        composerIntent: {
          prompt: "/side investigate this",
          focusNonce: 1,
        },
      },
      {
        onSendPrompt: async (prompt) => {
          sentPrompts.push(prompt);
        },
        onOpenSideChat: async (input) => {
          sideChatInputs.push(JSON.stringify(input ?? null));
        },
      },
    );

    await submitCurrentComposerDraft(view);

    await waitFor(() => {
      expect(sideChatInputs.length).toBe(1);
    });
    expect(sideChatInputs[0]).toBe("{\"prompt\":\"investigate this\"}");
    expect(sentPrompts.length).toBe(0);
  });

  test("/side is unavailable inside an existing side chat", async () => {
    resetStorage();
    const baseConversation = buildModel().conversation;
    if (!baseConversation) {
      throw new Error("Expected the base conversation fixture.");
    }

    const sentPrompts: string[] = [];
    const sideChatInputs: string[] = [];
    const view = await renderComposer(
      {
        conversation: {
          ...baseConversation,
          ephemeral: true,
          source: {
            parentThreadId: "thread_1",
            sideConversation: true,
            sideConversationParentNavigationPath: "session:session_1/thread:thread_1",
          },
        },
        composerIntent: {
          prompt: "/side nested check",
          focusNonce: 1,
        },
      },
      {
        onSendPrompt: async (prompt) => {
          sentPrompts.push(prompt);
        },
        onOpenSideChat: async (input) => {
          sideChatInputs.push(JSON.stringify(input ?? null));
        },
      },
    );

    await submitCurrentComposerDraft(view);

    const snapshot = __getNodexToastSnapshotForTests();
    expect(sideChatInputs.length).toBe(0);
    expect(sentPrompts.length).toBe(0);
    expect(snapshot.length).toBe(1);
    expect(String((snapshot[0] as { title?: unknown }).title ?? "")).toBe(
      "'/side' is unavailable in side chats. Return to the main thread first",
    );
  });

  test("shows the Codex-style fast indicator before the model label only when Fast is active", async () => {
    resetStorage();

    const standardView = await renderComposer();
    const standardModelTrigger = standardView.getByLabelText("Select Codex model and reasoning");
    expect(Boolean(standardModelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeFalse();

    standardView.unmount();

    localStorageRef.setItem("nodex-codex-default-service-tier-v1", "fast");

    const fastView = await renderComposer();
    const fastModelTrigger = fastView.getByLabelText("Select Codex model and reasoning");
    const fastIndicator = fastModelTrigger.querySelector('[data-fast-mode-indicator="true"]');
    expect(Boolean(fastIndicator)).toBeTrue();

    const fastIcon = fastIndicator?.querySelector("svg");
    if (!(fastIcon instanceof SVGSVGElement)) {
      throw new Error("Expected the Fast indicator to render an SVG icon.");
    }
    expect(fastIcon.getAttribute("width")).toBe("20");
    expect(fastIcon.getAttribute("height")).toBe("20");
    expect(fastIcon.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(fastIcon.getAttribute("class")).toBe("icon-2xs text-token-link-foreground shrink-0");

    const fastIconPath = fastIcon.querySelector("path");
    if (!(fastIconPath instanceof SVGPathElement)) {
      throw new Error("Expected the Fast indicator SVG to include a path.");
    }
    expect(fastIconPath.getAttribute("d")).toBe(CODEX_FAST_MODE_ICON_PATH);
    expect(fastIconPath.getAttribute("fill")).toBe("currentColor");
  });

  test("writes the shared service tier setting from the Intelligence menu", async () => {
    resetStorage();
    const view = await renderComposer();

    const modelTrigger = view.getByLabelText("Select Codex model and reasoning");

    expect(Boolean(modelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeFalse();

    await act(async () => {
      fireEvent.pointerDown(modelTrigger, { button: 0, ctrlKey: false });
      fireEvent.click(modelTrigger);
      await Promise.resolve();
    });

    expect(Boolean(view.container.ownerDocument.body.textContent?.includes("Intelligence"))).toBeTrue();

    const speedTrigger = Array.from(view.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'))
      .find((node) => node.textContent?.includes("Speed"));
    if (!(speedTrigger instanceof HTMLElement)) {
      throw new Error("Expected the Intelligence menu to include the Speed submenu trigger.");
    }

    await act(async () => {
      fireEvent.click(speedTrigger);
      await Promise.resolve();
    });

    const fastOption = view.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]');
    const fastItem = Array.from(fastOption).find((node) => node.textContent?.includes("Fast"));
    if (!(fastItem instanceof HTMLElement)) {
      throw new Error("Expected the Fast speed option.");
    }

    await act(async () => {
      fireEvent.click(fastItem);
      await Promise.resolve();
    });

    expect(localStorageRef.getItem("nodex-codex-default-service-tier-v1")).toBe("fast");
    expect(Boolean(modelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeTrue();
  });

  test("keeps Speed out of the add-context menu", async () => {
    resetStorage();
    const view = await renderComposer();

    const trigger = view.getByLabelText("Add files and more");

    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const menuItems = Array.from(view.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'));
    expect(menuItems.some((node) => node.textContent?.includes("Speed"))).toBeFalse();
  });

  test("add-context menu uses Codex row order without a title row", async () => {
    resetStorage();
    const selectedModes: string[] = [];
    const view = await renderComposer({
      composerIntent: {
        prompt: "toggle mode",
        focusNonce: 1,
      },
    }, {
      onCollaborationModeChange: (mode) => {
        selectedModes.push(mode);
      },
    });

    const trigger = view.getByLabelText("Add files and more");

    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const bodyText = view.container.ownerDocument.body.textContent ?? "";
    expect(Boolean(bodyText.includes("Add files and more"))).toBeFalse();
    expect(Boolean(bodyText.includes("Add photos & files"))).toBeTrue();
    expect(Boolean(bodyText.includes("Plan mode"))).toBeTrue();
    expect(Boolean(bodyText.includes("Speed"))).toBeFalse();
    expect(Boolean(bodyText.includes("Plugins"))).toBeFalse();

    const planRow = view.container.ownerDocument.body.querySelector('[data-add-context-row="plan-mode"]');
    if (!(planRow instanceof HTMLElement)) {
      throw new Error("Expected the Plan mode row.");
    }

    await act(async () => {
      fireEvent.click(planRow);
      await Promise.resolve();
    });

    expect(selectedModes[0]).toBe("plan");
  });

  test("shift-tab toggles Plan mode and blocks focus traversal", async () => {
    resetStorage();
    const selectedModes: string[] = [];
    const view = await renderComposer(undefined, {
      onCollaborationModeChange: (mode) => {
        selectedModes.push(mode);
      },
    });

    const wasNotCanceled = await keyDownComposer(view, { key: "Tab", shiftKey: true }, { waitForContent: false });

    expect(wasNotCanceled).toBeFalse();
    expect(selectedModes[0]).toBe("plan");
  });

  test("Plan mode changes the composer placeholder", async () => {
    resetStorage();
    const view = await renderComposer({
      selectedCollaborationMode: "plan",
    });

    await waitFor(() => {
      const placeholder = view.container.querySelector<HTMLElement>('[data-placeholder="Describe your task to generate a plan..."]');
      if (!placeholder) {
        throw new Error("Expected Plan mode placeholder.");
      }
      expect(placeholder.classList.contains("placeholder")).toBeTrue();
    });
  });

  test("plan keyword suggestion can use or dismiss Plan mode", async () => {
    resetStorage();
    const selectedModes: string[] = [];
    const view = await renderComposer({
      composerIntent: {
        prompt: "please plan the migration",
        focusNonce: 1,
      },
    }, {
      onCollaborationModeChange: (mode) => {
        selectedModes.push(mode);
      },
    });

    await waitFor(() => {
      const suggestion = view.container.querySelector('[data-plan-keyword-suggestion="true"]');
      if (!suggestion) {
        throw new Error("Expected plan keyword suggestion.");
      }
      expect(Boolean(suggestion.textContent?.includes("Create a plan"))).toBeTrue();
    });

    const usePlanButton = view.container.querySelector('[data-codex-above-composer-suggestion-action="true"]');
    if (!(usePlanButton instanceof HTMLElement)) {
      throw new Error("Expected Use plan mode button.");
    }

    await act(async () => {
      fireEvent.click(usePlanButton);
      await Promise.resolve();
    });

    expect(selectedModes[0]).toBe("plan");
    expect(Boolean(view.container.querySelector('[data-codex-above-composer-suggestion="keyword-plan-mode"]'))).toBeTrue();
    view.unmount();

    const dismissView = await renderComposer({
      composerIntent: {
        prompt: "please plan the migration",
        focusNonce: 2,
      },
    });
    const dismissButton = await waitFor(() => {
      const button = dismissView.container.querySelector('[aria-label="Dismiss suggestion"]');
      if (!(button instanceof HTMLElement)) {
        throw new Error("Expected dismiss plan suggestion button.");
      }
      return button;
    });
    await act(async () => {
      fireEvent.click(dismissButton);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(Boolean(dismissView.container.querySelector('[data-plan-keyword-suggestion="true"]'))).toBeFalse();
    });
  });

  test("add-context prompt input keeps file mentions, images, and plugin skills distinct", () => {
    const promptInput = __composerAddContextTestUtils.buildComposerPromptInput({
      prompt: "Use these",
      attachments: {
        fileAttachments: [{ id: "file_1", label: "notes.md", path: "/tmp/notes.md" }],
        imageAttachments: [{ id: "image_1", filename: "diagram.png", path: "/tmp/diagram.png", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
        skillMentions: [{ id: "skill_1", name: "Computer Use", path: "/plugins/computer-use" }],
        commentAttachments: [],
      },
    });

    expect(JSON.stringify(promptInput)).toBe(
      "{\"text\":\"Use these\",\"images\":[{\"source\":\"data:image/png;base64,aW1hZ2U=\",\"caption\":\"diagram.png\"}],\"mentions\":[{\"name\":\"notes.md\",\"path\":\"/tmp/notes.md\"}],\"skills\":[{\"name\":\"Computer Use\",\"path\":\"/plugins/computer-use\"}]}",
    );
    expect(__composerAddContextTestUtils.isComposerImageFile({ label: "diagram.png", path: "/tmp/diagram.png" })).toBeTrue();
    expect(__composerAddContextTestUtils.isComposerImageFile({ label: "notes.md", path: "/tmp/notes.md" })).toBeFalse();
  });

  test("plugin flyout inserts a structured skill mention", async () => {
    resetStorage();
    const sentPromptInputs: string[] = [];
    const view = await renderComposer(
      {
        composerPlugins: [{ name: "Computer Use", path: "/plugins/computer-use" }],
      },
      {
        onSendPrompt: async (_prompt, opts) => {
          sentPromptInputs.push(JSON.stringify(opts?.promptInput ?? null));
        },
      },
    );

    const trigger = view.getByLabelText("Add files and more");
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const pluginTrigger = Array.from(view.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'))
      .find((node) => node.textContent?.includes("Plugins"));
    if (!(pluginTrigger instanceof HTMLElement)) {
      throw new Error("Expected the Plugins flyout trigger.");
    }

    await act(async () => {
      fireEvent.click(pluginTrigger);
      await Promise.resolve();
    });

    const pluginItem = view.container.ownerDocument.body.querySelector('[data-add-context-plugin="Computer Use"]');
    if (!(pluginItem instanceof HTMLElement)) {
      throw new Error("Expected the Computer Use plugin row.");
    }

    await act(async () => {
      fireEvent.click(pluginItem);
      await Promise.resolve();
    });

    expect(Boolean(view.container.textContent?.includes("Computer Use"))).toBeTrue();
    const sendButton = view.getByLabelText("Send prompt");
    await act(async () => {
      fireEvent.click(sendButton);
      await Promise.resolve();
    });

    expect(Boolean((sentPromptInputs[0] ?? "").includes("\"skills\":[{\"name\":\"Computer Use\",\"path\":\"/plugins/computer-use\"}]"))).toBeTrue();
  });

  test("opens the Codex-style inline slash command menu above the composer", async () => {
    resetStorage();
    const view = await renderComposer({
      composerIntent: {
        prompt: "/",
        focusNonce: 1,
      },
    });

    await waitFor(() => {
      const menu = view.container.querySelector('[data-slash-command-menu="true"]');
      if (!menu) throw new Error("Expected the slash command menu.");
      expect(Boolean(menu.textContent?.includes("Compact"))).toBeTrue();
      expect(Boolean(menu.textContent?.includes("Fast"))).toBeTrue();
      expect(Boolean(menu.textContent?.includes("Feedback"))).toBeTrue();
      expect(Boolean(menu.textContent?.includes("MCP"))).toBeTrue();
      expect(Boolean(menu.textContent?.includes("Model"))).toBeTrue();
      expect(Boolean(menu.textContent?.includes("No commands"))).toBeFalse();
    });
  });

  test("slash Plan command toggles through the shared Plan mode action", async () => {
    resetStorage();
    const selectedModes: string[] = [];
    const view = await renderComposer({
      composerIntent: {
        prompt: "/plan",
        focusNonce: 1,
      },
    }, {
      onCollaborationModeChange: (mode) => {
        selectedModes.push(mode);
      },
    });

    await waitFor(() => {
      const planRow = view.container.querySelector('[data-slash-command-row="plan-mode"]');
      if (!planRow) throw new Error("Expected Plan slash command row.");
      expect(Boolean(planRow.textContent?.includes("Switch to plan mode"))).toBeTrue();
    });

    await keyDownComposer(view, { key: "Enter" });

    expect(selectedModes[0]).toBe("plan");

    const offView = await renderComposer({
      selectedCollaborationMode: "plan",
      composerIntent: {
        prompt: "/plan",
        focusNonce: 2,
      },
    }, {
      onCollaborationModeChange: (mode) => {
        selectedModes.push(mode);
      },
    });

    await waitFor(() => {
      const planRow = offView.container.querySelector('[data-slash-command-row="plan-mode"]');
      if (!planRow) throw new Error("Expected Plan slash command row.");
      expect(Boolean(planRow.textContent?.includes("Switch off plan mode"))).toBeTrue();
    });

    await keyDownComposer(offView, { key: "Enter" });

    expect(selectedModes[1]).toBe("default");
  });

  test("keeps slash menu scroll position stable across hover and item recompute", async () => {
    resetStorage();
    const elementPrototype = HTMLElement.prototype as unknown as {
      scrollIntoView?: (options?: unknown) => void;
    };
    const originalScrollIntoView = elementPrototype.scrollIntoView;
    let scrollIntoViewCalls = 0;

    elementPrototype.scrollIntoView = function scrollIntoViewMock(this: HTMLElement) {
      scrollIntoViewCalls += 1;
      const list = this.closest('[role="listbox"]');
      if (list instanceof HTMLElement) {
        list.scrollTop = 0;
      }
    };

    try {
      const initialModel = buildModel({
        composerIntent: {
          prompt: "/",
          focusNonce: 1,
        },
      });
      const view = await renderComposer(initialModel);
      const modelRow = await waitFor(() => {
        const row = view.container.querySelector('[data-slash-command-row="model"]');
        if (!(row instanceof HTMLElement)) throw new Error("Expected Model slash command row.");
        return row;
      });
      const compactRow = view.container.querySelector('[data-slash-command-row="compact"]');
      const list = view.container.querySelector('[role="listbox"]');
      if (!(compactRow instanceof HTMLElement) || !(list instanceof HTMLElement)) {
        throw new Error("Expected slash command list rows.");
      }

      scrollIntoViewCalls = 0;
      list.scrollTop = 180;
      await act(async () => {
        fireEvent.mouseEnter(modelRow);
        await Promise.resolve();
      });

      expect(scrollIntoViewCalls).toBe(0);
      expect(list.scrollTop).toBe(180);
      expect(modelRow.getAttribute("aria-selected")).toBe("true");

      scrollIntoViewCalls = 0;
      list.scrollTop = 180;
      await act(async () => {
        view.rerender(
          <AppProviders>
            <ThreadComposer
              model={buildModel({
                composerIntent: {
                  prompt: "/",
                  focusNonce: 1,
                },
                selectedModel: "gpt-5.5",
              })}
              actions={buildActions()}
              errorMessage={null}
              onErrorMessage={() => {}}
            />
          </AppProviders>,
        );
        await Promise.resolve();
      });
      await settleComposerFrame();

      const nextModelRow = view.container.querySelector('[data-slash-command-row="model"]');
      const nextCompactRow = view.container.querySelector('[data-slash-command-row="compact"]');
      if (!(nextModelRow instanceof HTMLElement) || !(nextCompactRow instanceof HTMLElement)) {
        throw new Error("Expected slash command rows after rerender.");
      }

      expect(scrollIntoViewCalls).toBe(0);
      expect(list.scrollTop).toBe(180);
      expect(nextModelRow.getAttribute("aria-selected")).toBe("true");
      expect(nextCompactRow.getAttribute("aria-selected")).toBe("false");
    } finally {
      if (originalScrollIntoView) {
        elementPrototype.scrollIntoView = originalScrollIntoView;
      } else {
        delete elementPrototype.scrollIntoView;
      }
    }
  });

  test("filters slash commands and selects Fast from the inline menu", async () => {
    resetStorage();
    const view = await renderComposer({
      composerIntent: {
        prompt: "/fa",
        focusNonce: 1,
      },
    });

    await waitFor(() => {
      const fastRow = view.container.querySelector('[data-slash-command-row="service-tier:fast"]');
      if (!(fastRow instanceof HTMLElement)) throw new Error("Expected Fast slash command row.");
      expect(Boolean(view.container.textContent?.includes("Compact"))).toBeFalse();
    });

    const fastRow = view.container.querySelector('[data-slash-command-row="service-tier:fast"]');
    if (!(fastRow instanceof HTMLElement)) {
      throw new Error("Expected Fast slash command row.");
    }

    await act(async () => {
      fireEvent.click(fastRow);
      await Promise.resolve();
    });

    expect(localStorageRef.getItem("nodex-codex-default-service-tier-v1")).toBe("fast");
    expect(view.container.querySelector('[data-slash-command-menu="true"]') === null).toBeTrue();
  });

  test("runs the Compact slash command through the thread action boundary", async () => {
    resetStorage();
    const compactedThreadIds: string[] = [];
    const view = await renderComposer(
      {
        composerIntent: {
          prompt: "/compact",
          focusNonce: 1,
        },
      },
      {
        onCompactThread: async (threadId) => {
          compactedThreadIds.push(threadId);
        },
      },
    );

    const compactRow = await waitFor(() => {
      const row = view.container.querySelector('[data-slash-command-row="compact"]');
      if (!(row instanceof HTMLElement)) throw new Error("Expected Compact slash command row.");
      return row;
    });

    await act(async () => {
      fireEvent.click(compactRow);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(compactedThreadIds[0]).toBe("thread_1");
    });
  });

  test("opens nested Model content and selects a model from the slash menu", async () => {
    resetStorage();
    const selectedModels: string[] = [];
    const view = await renderComposer(
      {
        composerIntent: {
          prompt: "/model",
          focusNonce: 1,
        },
      },
      {
        onModelChange: (model) => {
          selectedModels.push(model);
        },
      },
    );

    const modelRow = await waitFor(() => {
      const row = view.container.querySelector('[data-slash-command-row="model"]');
      if (!(row instanceof HTMLElement)) throw new Error("Expected Model slash command row.");
      return row;
    });

    await act(async () => {
      fireEvent.click(modelRow);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(Boolean(view.container.textContent?.includes("GPT-5.5"))).toBeTrue();
    });

    const nextModelButton = Array.from(view.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("GPT-5.5"));
    if (!(nextModelButton instanceof HTMLElement)) {
      throw new Error("Expected GPT-5.5 model option.");
    }

    await act(async () => {
      fireEvent.click(nextModelButton);
      await Promise.resolve();
    });

    expect(selectedModels[0]).toBe("gpt-5.5");
  });

  test("places permissions and context inside the existing-thread composer footer without a lower status row", async () => {
    resetStorage();
    const invokedChannels: string[] = [];
    const view = await renderComposer(undefined, undefined, async (channel) => {
      invokedChannels.push(channel);
      return undefined;
    });

    const permissionTrigger = view.getByLabelText("Permission mode");
    const contextTrigger = view.getByLabelText(/Context window/);
    const lowerStatusRow = view.container.querySelector('[data-composer-lower-status-row="true"]');
    const formFooter = view.container.querySelector('[data-composer-form-footer="true"]');

    expect(formFooter !== null).toBeTrue();
    expect(lowerStatusRow === null).toBeTrue();
    expect(formFooter?.contains(permissionTrigger)).toBeTrue();
    expect(formFooter?.contains(contextTrigger)).toBeTrue();
    expect(invokedChannels.some((channel) => channel.startsWith("git:branch:"))).toBeFalse();
  });

  test("places the new-chat project selector in the lower status row before run target", async () => {
    resetStorage();
    const view = await renderComposer(
      {
        conversation: null,
        isNewThreadTab: true,
        newThreadTarget: {
          projectId: "project_1",
          projectName: "Nodex",
          sessionId: "session_1",
          threadTitle: "New thread",
          runInTarget: "localProject",
        },
        newThreadProjectSelector: {
          selectedProjectId: "project_1",
          disabled: false,
          canAddProject: true,
          projects: [
            {
              id: "project_1",
              label: "Nodex",
              description: "/tmp/project",
              primaryWorkspaceRoot: "/tmp/project",
              searchText: "project_1 nodex /tmp/project",
            },
            {
              id: "project_2",
              label: "Devtools Codex",
              description: "/tmp/devtools-codex",
              primaryWorkspaceRoot: "/tmp/devtools-codex",
              searchText: "project_2 devtools codex /tmp/devtools-codex",
            },
          ],
        },
      },
      {
        onNewThreadProjectChange: () => {},
        onRequestNewChatProjectCreate: () => {},
      },
    );

    const projectSelector = view.getByLabelText("Select project");
    const lowerStatusRow = view.container.querySelector<HTMLElement>('[data-composer-lower-status-row="true"]');
    const externalFooterSlot = view.container.querySelector<HTMLElement>('[data-composer-external-footer-slot="true"]');
    const formFooter = view.container.querySelector<HTMLElement>('[data-composer-form-footer="true"]');
    const composerSurface = view.container.querySelector<HTMLElement>(".composer-surface-chrome");
    const composerFrame = composerSurface?.parentElement;
    const lowerText = lowerStatusRow?.textContent ?? "";

    expect(lowerStatusRow !== null).toBeTrue();
    expect(externalFooterSlot !== null).toBeTrue();
    expect(formFooter !== null).toBeTrue();
    expect(externalFooterSlot?.contains(lowerStatusRow)).toBeTrue();
    expect(composerFrame?.nextElementSibling === externalFooterSlot).toBeTrue();
    expect(lowerStatusRow?.contains(projectSelector)).toBeTrue();
    expect(formFooter?.contains(projectSelector)).toBeFalse();
    expect(lowerText.indexOf("Nodex") >= 0).toBeTrue();
    expect(lowerText.indexOf("Work locally") >= 0).toBeTrue();
    expect(lowerText.indexOf("Nodex") < lowerText.indexOf("Work locally")).toBeTrue();
  });

  test("hides the lower status row after a new-chat tab materializes a conversation", async () => {
    resetStorage();
    const view = await renderComposer({
      isNewThreadTab: true,
      newThreadTarget: {
        projectId: "project_1",
        projectName: "Nodex",
        sessionId: "session_1",
        threadTitle: "New thread",
        runInTarget: "localProject",
      },
    });

    const lowerStatusRow = view.container.querySelector('[data-composer-lower-status-row="true"]');
    const externalFooterSlot = view.container.querySelector('[data-composer-external-footer-slot="true"]');
    const formFooter = view.container.querySelector('[data-composer-form-footer="true"]');

    expect(formFooter !== null).toBeTrue();
    expect(lowerStatusRow === null).toBeTrue();
    expect(externalFooterSlot === null).toBeTrue();
  });

  test("keeps prompt scrolling owned by the ProseMirror prompt editor", async () => {
    resetStorage();
    const longPrompt = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");
    const view = await renderComposer({
      composerIntent: {
        prompt: longPrompt,
        focusNonce: 1,
      },
    });
    const composer = view.container.querySelector<HTMLElement>('[data-codex-composer="true"]');
    const composerSurface = view.container.querySelector<HTMLElement>(".composer-surface-chrome");
    const promptFrame = view.container.querySelector<HTMLElement>('[data-composer-prompt-frame="true"]');
    const editorScrollContainer = composer?.parentElement;
    const attachmentStrip = view.container.querySelector<HTMLElement>('[data-composer-attachments="true"]');
    const formFooter = view.container.querySelector<HTMLElement>('[data-composer-form-footer="true"]');

    expect(composer !== null).toBeTrue();
    expect(composer?.classList.contains("ProseMirror") ?? false).toBeTrue();
    expect(composer?.getAttribute("contenteditable")).toBe("true");
    expect(composer?.getAttribute("data-virtualkeyboard")).toBe("true");
    expect(composer?.getAttribute("translate")).toBe("no");
    expect(composer?.getAttribute("spellcheck")).toBe("true");
    expect(Boolean(composer?.getAttribute("style")?.includes("min-height: 2.75rem"))).toBeTrue();
    expect(promptFrame !== null).toBeTrue();
    expect(promptFrame?.contains(composer)).toBeTrue();
    expect(promptFrame?.classList.contains("text-size-chat") ?? false).toBeTrue();
    expect(promptFrame?.classList.contains("text-base") ?? false).toBeTrue();
    expect(composerSurface !== null).toBeTrue();
    expect(composerSurface?.tagName).toBe("DIV");
    expect(composerSurface?.classList.contains("_multilineSurface_1u8sk_2") ?? false).toBeTrue();
    expect(attachmentStrip?.classList.contains("_attachmentsDefault_1u8sk_2") ?? false).toBeTrue();
    expect(attachmentStrip?.classList.contains("empty:hidden") ?? true).toBeFalse();
    expect(formFooter?.classList.contains("_footer_1u8sk_2") ?? false).toBeTrue();
    expect(editorScrollContainer?.contains(composer)).toBeTrue();
  });

  test("renders the Codex new-chat placeholder inside the ProseMirror document", async () => {
    resetStorage();
    const view = await renderComposer({
      threadId: null,
      conversation: null,
      isNewThreadTab: true,
      newThreadTarget: {
        projectId: "project_1",
        projectName: "Nodex",
        sessionId: "session_1",
        threadTitle: "New thread",
        runInTarget: "localProject",
      },
      body: {
        threadId: null,
        turnCount: 0,
        hasAboveComposerBlocks: false,
        isThreadRunning: false,
        activeTurnId: null,
        latestTurnId: null,
        emptyState: { type: "newThread", title: "Start a new thread", description: "" },
        showThreadStartProgressPanel: false,
      },
    });
    const composer = view.container.querySelector<HTMLElement>('[data-codex-composer="true"]');

    expect(composer !== null).toBeTrue();
    await waitFor(() => {
      const placeholder = view.container.querySelector<HTMLElement>('[data-placeholder="Do anything"]');
      if (!placeholder) {
        throw new Error("Expected Codex placeholder.");
      }
      expect(placeholder.classList.contains("placeholder")).toBeTrue();
    });
  });

  test("Intelligence menu preserves reasoning and model selectors", async () => {
    resetStorage();
    const selectedModels: string[] = [];
    const selectedReasoning: string[] = [];
    const modelView = await renderComposer(undefined, {
      onModelChange: (model) => {
        selectedModels.push(model);
      },
    });

    const trigger = modelView.getByLabelText("Select Codex model and reasoning");
    expect(Boolean(trigger.textContent?.includes("5.3"))).toBeTrue();
    expect(Boolean(trigger.textContent?.includes("High"))).toBeTrue();

    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const menuItems = Array.from(modelView.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'));
    expect(Boolean(modelView.container.ownerDocument.body.textContent?.includes("Intelligence"))).toBeTrue();
    expect(Boolean(modelView.container.ownerDocument.body.querySelector('[data-intelligence-option="high"]'))).toBeTrue();
    expect(Boolean(modelView.container.ownerDocument.body.querySelector('[data-intelligence-option="medium"]'))).toBeTrue();
    expect(Boolean(modelView.container.ownerDocument.body.querySelector('[data-intelligence-option="low"]'))).toBeFalse();

    const modelTrigger = menuItems.find((node) => node.textContent?.includes("GPT-5.3 Codex"));
    if (!(modelTrigger instanceof HTMLElement)) {
      throw new Error("Expected the Intelligence menu to include the Model submenu trigger.");
    }

    await act(async () => {
      fireEvent.click(modelTrigger);
      await Promise.resolve();
    });

    const modelItem = Array.from(modelView.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'))
      .find((node) => node.textContent?.includes("GPT-5.5"));
    if (!(modelItem instanceof HTMLElement)) {
      throw new Error("Expected the Intelligence model flyout to include GPT-5.5.");
    }

    await act(async () => {
      fireEvent.click(modelItem);
      await Promise.resolve();
    });

    expect(selectedModels[0]).toBe("gpt-5.5");
    modelView.unmount();

    const reasoningView = await renderComposer(undefined, {
      onReasoningEffortChange: (reasoningEffort) => {
        selectedReasoning.push(reasoningEffort);
      },
    });
    const reasoningTrigger = reasoningView.getByLabelText("Select Codex model and reasoning");

    await act(async () => {
      fireEvent.pointerDown(reasoningTrigger, { button: 0, ctrlKey: false });
      fireEvent.click(reasoningTrigger);
      await Promise.resolve();
    });

    const nextMenuItems = Array.from(reasoningView.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'));
    const reasoningItem = nextMenuItems.find((node) => node.textContent?.includes("Medium"));
    if (!(reasoningItem instanceof HTMLElement)) {
      throw new Error("Expected the Intelligence menu to include Medium reasoning.");
    }

    await act(async () => {
      fireEvent.click(reasoningItem);
      await Promise.resolve();
    });

    expect(selectedReasoning[0]).toBe("medium");
  });

  test("selecting a model coerces unsupported reasoning to that model's supported default", async () => {
    resetStorage();
    const selectedModels: string[] = [];
    const selectedReasoning: string[] = [];
    const view = await renderComposer(
      {
        selectedReasoningEffort: "medium",
      },
      {
        onModelChange: (model) => {
          selectedModels.push(model);
        },
        onReasoningEffortChange: (reasoningEffort) => {
          selectedReasoning.push(reasoningEffort);
        },
      },
    );

    const trigger = view.getByLabelText("Select Codex model and reasoning");

    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const modelTrigger = Array.from(view.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'))
      .find((node) => node.textContent?.includes("GPT-5.3 Codex"));
    if (!(modelTrigger instanceof HTMLElement)) {
      throw new Error("Expected the Intelligence menu to include the current model row.");
    }

    await act(async () => {
      fireEvent.click(modelTrigger);
      await Promise.resolve();
    });

    const modelItem = Array.from(view.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'))
      .find((node) => node.textContent?.includes("GPT-5.5"));
    if (!(modelItem instanceof HTMLElement)) {
      throw new Error("Expected the Intelligence model flyout to include GPT-5.5.");
    }

    await act(async () => {
      fireEvent.click(modelItem);
      await Promise.resolve();
    });

    expect(selectedModels[0]).toBe("gpt-5.5");
    expect(selectedReasoning[0]).toBe("high");
  });

  test("model flyout keeps rows concise and moves overflow models behind Other models", async () => {
    resetStorage();
    const view = await renderComposer({
      selectedModel: "gpt-5.5",
      availableModels: [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          description: "Latest Codex model.",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "high", description: "Spend more time reasoning before answering." },
          ],
        },
        {
          id: "gpt-5.4",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          description: "Previous stable Codex model.",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "high", description: "Spend more time reasoning before answering." },
          ],
        },
        {
          id: "gpt-5.4-mini",
          model: "gpt-5.4-mini",
          displayName: "GPT-5.4-Mini",
          description: "Small fast Codex model.",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Balance speed and deeper reasoning." },
          ],
        },
        {
          id: "gpt-5.3-codex-spark",
          model: "gpt-5.3-codex-spark",
          displayName: "GPT-5.3-Codex-Spark",
          description: "Ultra fast Codex model.",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Balance speed and deeper reasoning." },
          ],
        },
      ],
    });

    const trigger = view.getByLabelText("Select Codex model and reasoning");

    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const modelTrigger = Array.from(view.container.ownerDocument.body.querySelectorAll('[data-radix-collection-item]'))
      .find((node) => node.textContent?.includes("GPT-5.5"));
    if (!(modelTrigger instanceof HTMLElement)) {
      throw new Error("Expected the Intelligence menu to include the current model row.");
    }

    await act(async () => {
      fireEvent.click(modelTrigger);
      await Promise.resolve();
    });

    const modelMenuText = view.container.ownerDocument.body.textContent ?? "";
    expect(Boolean(modelMenuText.includes("Change model"))).toBeTrue();
    expect(Boolean(modelMenuText.includes("Other models"))).toBeTrue();
    expect(Boolean(modelMenuText.includes("Latest Codex model"))).toBeFalse();
    expect(Boolean(modelMenuText.includes("Previous stable Codex model"))).toBeFalse();
  });

  test("renders active Plan mode as a direct toggle chip", async () => {
    resetStorage();
    const selectedModes: string[] = [];
    const view = await renderComposer(
      { selectedCollaborationMode: "plan" },
      {
        onCollaborationModeChange: (mode) => {
          selectedModes.push(mode);
        },
      },
    );

    const formFooter = view.container.querySelector('[data-composer-form-footer="true"]');
    const addContextButton = view.getByLabelText("Add files and more");
    const permissionTrigger = view.getByLabelText("Permission mode");
    const planButton = view.getByLabelText("Plan");
    const planAccessoryDivider = formFooter?.querySelector('[data-composer-footer-accessory-divider="true"]');

    expect(formFooter !== null).toBeTrue();
    expect(formFooter?.contains(addContextButton)).toBeTrue();
    expect(formFooter?.contains(permissionTrigger)).toBeTrue();
    expect(formFooter?.contains(planButton)).toBeTrue();
    expect(planButton.hasAttribute("aria-haspopup")).toBeFalse();
    expect(planButton.getAttribute("data-slot") === "dropdown-trigger").toBeFalse();
    expect(planAccessoryDivider !== null).toBeTrue();
    expect(Boolean(addContextButton.compareDocumentPosition(permissionTrigger) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
    expect(Boolean(permissionTrigger.compareDocumentPosition(planButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
    expect(permissionTrigger.nextElementSibling === planAccessoryDivider).toBeTrue();
    expect(planAccessoryDivider?.nextElementSibling === planButton).toBeTrue();

    await act(async () => {
      fireEvent.click(planButton);
      await Promise.resolve();
    });

    expect(selectedModes[0]).toBe("default");
  });
});
