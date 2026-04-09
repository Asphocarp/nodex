import { describe, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { AppProviders } from "@/app-providers";
import { render } from "@/test/dom";
import {
  installAsyncRequestAnimationFrame,
  installWindowApi,
} from "@/test/browser-globals";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import { ThreadComposer } from "./local-conversation-thread-composer";

const storageMap = new Map<string, string>();

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
  localStorageRef.removeItem("nodex-codex-default-service-tier-v1");
}

function installComposerWindowApi(): void {
  installWindowApi({
    invoke: async (channel: string) => {
      switch (channel) {
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
            guardianApprovalEnabled: true,
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
    on: () => () => {},
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
      cardId: "card_1",
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
    availableModels: [],
    collaborationModes: [],
    selectedCollaborationMode: "default",
    selectedModel: "gpt-5.3-codex",
    selectedReasoningEffort: "high",
    reasoningEffortOptions: [],
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
    onStartThreadForCard: async () => {},
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
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    onOpenCard: () => {},
    ...overrides,
  };
}

async function renderComposer(overrides?: Partial<ThreadFooterModel>) {
  installAsyncRequestAnimationFrame();
  document.documentElement.dataset.codexWindowType = "electron";
  installComposerWindowApi();

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <AppProviders>
        <ThreadComposer
          model={buildModel(overrides)}
          actions={buildActions()}
          errorMessage={null}
          onErrorMessage={() => {}}
        />
      </AppProviders>,
    );
  });

  return view;
}

describe("ThreadComposer speed menu", () => {
  test("shows the Codex-style fast indicator before the model label only when Fast is active", async () => {
    resetStorage();

    const standardView = await renderComposer();
    const standardModelTrigger = standardView.getByLabelText("Select Codex model");
    expect(Boolean(standardModelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeFalse();

    standardView.unmount();

    localStorageRef.setItem("nodex-codex-default-service-tier-v1", "fast");

    const fastView = await renderComposer();
    const fastModelTrigger = fastView.getByLabelText("Select Codex model");
    expect(Boolean(fastModelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeTrue();
  });

  test("writes the shared service tier setting from the add-context menu", async () => {
    resetStorage();
    const view = await renderComposer();

    const trigger = view.getByLabelText("Add files and more");
    const modelTrigger = view.getByLabelText("Select Codex model");

    expect(Boolean(modelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeFalse();

    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const speedTrigger = view.container.ownerDocument.body.querySelector('[data-radix-collection-item]');
    if (!(speedTrigger instanceof HTMLElement)) {
      throw new Error("Expected the composer speed submenu trigger.");
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
});
