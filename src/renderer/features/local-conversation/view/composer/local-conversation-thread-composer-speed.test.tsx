import { describe, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { AppProviders } from "@/app-providers";
import { render } from "@/test/dom";
import {
  installAsyncRequestAnimationFrame,
  installWindowApi,
} from "@/test/browser-globals";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import { ThreadComposer, __composerAddContextTestUtils } from "./local-conversation-thread-composer";

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

function installPromptTextareaScrollHeight(input: {
  emptyScrollHeight: number;
  filledScrollHeight: number;
}): void {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      if (this instanceof HTMLTextAreaElement) {
        return this.value.length === 0 ? input.emptyScrollHeight : input.filledScrollHeight;
      }

      return input.filledScrollHeight;
    },
  });
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
    onUnarchiveThread: async () => { },
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    onOpenCard: () => {},
    ...overrides,
  };
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

  return view;
}

describe("ThreadComposer speed menu", () => {
  test("shows the Codex-style fast indicator before the model label only when Fast is active", async () => {
    resetStorage();

    const standardView = await renderComposer();
    const standardModelTrigger = standardView.getByLabelText("Select Codex model and reasoning");
    expect(Boolean(standardModelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeFalse();

    standardView.unmount();

    localStorageRef.setItem("nodex-codex-default-service-tier-v1", "fast");

    const fastView = await renderComposer();
    const fastModelTrigger = fastView.getByLabelText("Select Codex model and reasoning");
    expect(Boolean(fastModelTrigger.querySelector('[data-fast-mode-indicator="true"]'))).toBeTrue();
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
    const view = await renderComposer(undefined, {
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

  test("add-context prompt input keeps file mentions, images, and plugin skills distinct", () => {
    const promptInput = __composerAddContextTestUtils.buildComposerPromptInput({
      prompt: "Use these",
      attachments: {
        fileAttachments: [{ id: "file_1", label: "notes.md", path: "/tmp/notes.md" }],
        imageAttachments: [{ id: "image_1", filename: "diagram.png", path: "/tmp/diagram.png", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
        skillMentions: [{ id: "skill_1", name: "Computer Use", path: "/plugins/computer-use" }],
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
              workspacePath: "/tmp/project",
              searchText: "project_1 nodex /tmp/project",
            },
            {
              id: "project_2",
              label: "Devtools Codex",
              description: "/tmp/devtools-codex",
              workspacePath: "/tmp/devtools-codex",
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
    const lowerStatusRow = view.container.querySelector('[data-composer-lower-status-row="true"]');
    const formFooter = view.container.querySelector('[data-composer-form-footer="true"]');
    const lowerText = lowerStatusRow?.textContent ?? "";

    expect(lowerStatusRow !== null).toBeTrue();
    expect(formFooter !== null).toBeTrue();
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
    const formFooter = view.container.querySelector('[data-composer-form-footer="true"]');

    expect(formFooter !== null).toBeTrue();
    expect(lowerStatusRow === null).toBeTrue();
  });

  test("keeps the composer shell chrome stable on focus", async () => {
    resetStorage();
    const view = await renderComposer();
    const composerForm = view.container.querySelector("form");

    expect(composerForm !== null).toBeTrue();
    expect(Boolean(composerForm?.className.includes("focus-within"))).toBeFalse();
    expect(Boolean(composerForm?.className.includes("ring-black/10"))).toBeTrue();
    expect(Boolean(composerForm?.className.includes("backdrop-blur-lg"))).toBeTrue();
  });

  test("keeps prompt scrolling owned by the textarea", async () => {
    resetStorage();
    const longPrompt = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");
    const view = await renderComposer({
      composerIntent: {
        prompt: longPrompt,
        focusNonce: 1,
      },
    });
    const textarea = view.container.querySelector("textarea");
    const composerForm = textarea?.closest("form");
    const promptFrame = view.container.querySelector<HTMLElement>('[data-composer-prompt-frame="true"]');
    const wrapperScrollContainers = Array.from(composerForm?.querySelectorAll<HTMLElement>(".overflow-y-auto") ?? [])
      .filter((element) => element !== textarea);

    expect(textarea !== null).toBeTrue();
    expect(promptFrame !== null).toBeTrue();
    expect(Boolean(textarea?.className.includes("scrollbar-token"))).toBeTrue();
    expect(Boolean(textarea?.className.includes("overflow-y-auto"))).toBeTrue();
    expect(Boolean(promptFrame?.className.includes("max-h-[25dvh]"))).toBeTrue();
    expect(Boolean(promptFrame?.className.includes("overflow-hidden"))).toBeTrue();
    expect(wrapperScrollContainers.length).toBe(0);
  });

  test("does not let placeholder measurement inflate empty prompt height after mount", async () => {
    resetStorage();
    installPromptTextareaScrollHeight({
      emptyScrollHeight: 220,
      filledScrollHeight: 40,
    });
    const view = await renderComposer();
    const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement | null;

    expect(textarea !== null).toBeTrue();
    expect(textarea?.style.height ?? "").toBe("");

    const filledView = await renderComposer({
      composerIntent: {
        prompt: "x",
        focusNonce: 1,
      },
    });
    const filledTextarea = filledView.container.querySelector("textarea") as HTMLTextAreaElement | null;

    await waitFor(() => {
      expect(filledTextarea?.style.height ?? "").toBe("40px");
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
    const planButton = view.getByLabelText("Plan");

    expect(formFooter !== null).toBeTrue();
    expect(formFooter?.contains(planButton)).toBeTrue();
    expect(planButton.hasAttribute("aria-haspopup")).toBeFalse();
    expect(planButton.getAttribute("data-slot") === "dropdown-trigger").toBeFalse();
    expect(planButton.querySelector('[data-plan-mode-icon="plan"]') !== null).toBeTrue();
    expect(planButton.querySelector('[data-plan-mode-icon="close"]') !== null).toBeTrue();

    await act(async () => {
      fireEvent.click(planButton);
      await Promise.resolve();
    });

    expect(selectedModes[0]).toBe("default");
  });
});
