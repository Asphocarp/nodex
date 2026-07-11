import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { installAsyncRequestAnimationFrame, installWindowApi } from "../../../../test/browser-globals";
import { render } from "../../../../test/dom";
import { NodexTooltipProvider as TooltipProvider } from "../../../../components/ui/tooltip";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import { ThreadComposer } from "./local-conversation-thread-composer";

class MockMediaRecorder {
  public mimeType = "audio/webm";
  public state: "inactive" | "recording" = "inactive";
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onstop: (() => void) | null = null;

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio-bytes"], { type: "audio/webm" }),
    } as BlobEvent);
    this.onstop?.();
  }
}

class MockAudioContext {
  createMediaStreamSource() {
    return {
      connect: () => {},
      disconnect: () => {},
    };
  }

  createScriptProcessor() {
    return {
      onaudioprocess: null,
      connect: () => {},
      disconnect: () => {},
    };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
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
      isEnabled: true,
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
    onUnarchiveThread: async () => { },
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    ...overrides,
  };
}

async function renderThreadComposer(input?: {
  model?: Partial<ThreadFooterModel>;
  actions?: Partial<ThreadStageActions>;
}) {
  const rendered = render(
    <TooltipProvider>
      <ThreadComposer
        model={buildModel(input?.model)}
        actions={buildActions(input?.actions)}
        errorMessage={null}
        onErrorMessage={() => {}}
      />
    </TooltipProvider>,
  );

  await act(async () => {
    await Promise.resolve();
  });

  return rendered;
}

describe("ThreadComposer dictation", () => {
  const nativeFetch = globalThis.fetch;
  const nativeMediaRecorder = globalThis.MediaRecorder;
  const nativeAudioContext = globalThis.AudioContext;

  beforeEach(() => {
    installAsyncRequestAnimationFrame();
    document.documentElement.dataset.codexWindowType = "electron";
    installWindowApi({
      invoke: async () => null,
      on: () => () => {},
      requestMicrophonePermission: () => {},
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => {} }],
        }),
      },
    });

    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      writable: true,
      value: MockAudioContext,
    });
  });

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    globalThis.fetch = nativeFetch;
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: nativeMediaRecorder,
    });
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      writable: true,
      value: nativeAudioContext,
    });
  });

  test("hides dictation when dictation support is unavailable", async () => {
    const { queryByLabelText } = await renderThreadComposer({
      model: {
        dictation: {
          isEnabled: false,
          authMethod: null,
          isRealtimeVoiceActive: false,
          shortcutLabel: "Ctrl+M",
        },
      },
    });

    expect(queryByLabelText("Dictate")).toBe(null);
  });

  test("disables the dictation button while realtime voice is active", async () => {
    const { getByLabelText } = await renderThreadComposer({
      model: {
        dictation: {
          isEnabled: true,
          authMethod: "chatgpt",
          isRealtimeVoiceActive: true,
          shortcutLabel: "Ctrl+M",
        },
      },
    });

    expect((getByLabelText("Dictate") as HTMLButtonElement).disabled).toBe(true);
  });

  test("starts on click and inserts the transcript on stop", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ text: "transcribed text" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const { container, getByLabelText } = await renderThreadComposer();

    await act(async () => {
      fireEvent.click(getByLabelText("Dictate"));
    });
    await waitFor(() => {
      expect(Boolean(document.querySelector('[aria-label="Stop dictation"]'))).toBe(true);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    await act(async () => {
      fireEvent.click(getByLabelText("Stop dictation"));
    });

    await waitFor(() => {
      const editor = container.querySelector<HTMLElement>("[data-codex-composer='true']");
      expect(editor?.textContent ?? "").toBe("transcribed text");
    });
  });

  test("uses Ctrl+M hold to start and keyup to stop with insert", async () => {
    let fetchCallCount = 0;
    globalThis.fetch = (async () => {
      fetchCallCount += 1;
      return new Response(JSON.stringify({ text: "send me" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const { container } = await renderThreadComposer();

    await act(async () => {
      fireEvent.keyDown(document, { key: "m", ctrlKey: true });
    });
    await waitFor(() => {
      expect(Boolean(document.querySelector('[aria-label="Stop dictation"]'))).toBe(true);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    await act(async () => {
      fireEvent.keyUp(document, { key: "m", ctrlKey: true });
    });
    await waitFor(() => {
      expect(fetchCallCount).toBe(1);
    });
    await waitFor(() => {
      const editor = container.querySelector<HTMLElement>("[data-codex-composer='true']");
      expect(editor?.textContent ?? "").toBe("send me");
    });
  });

  test("sends the transcript on explicit send stop mode", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ text: "send me" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    const onSendPromptCalls: string[] = [];
    const { getByLabelText } = await renderThreadComposer({
      actions: {
        onSendPrompt: async (prompt) => {
          onSendPromptCalls.push(prompt);
        },
      },
    });

    await act(async () => {
      fireEvent.click(getByLabelText("Dictate"));
    });
    await waitFor(() => {
      expect(Boolean(document.querySelector('[aria-label="Transcribe and send"]'))).toBe(true);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    await act(async () => {
      fireEvent.click(getByLabelText("Transcribe and send"));
    });

    await waitFor(() => {
      expect(onSendPromptCalls.length).toBe(1);
    });
    expect(onSendPromptCalls[0]).toBe("send me");
  });
});
