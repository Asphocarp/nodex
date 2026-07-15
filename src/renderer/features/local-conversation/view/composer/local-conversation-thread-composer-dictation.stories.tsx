import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import {
  buildThreadStageStoryScenario,
  buildThreadStageStorySurfaceModels,
  type ThreadStageStoryControls,
} from "../thread-stage-story-fixtures";
import { ThreadComposer } from "./local-conversation-thread-composer";

type DictationStoryState = "idle" | "unavailable" | "recording" | "transcribing" | "keyboardHold";

interface ComposerDictationStoryProps {
  state: DictationStoryState;
}

class StoryMediaRecorder {
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
      data: new Blob(["story-audio"], { type: "audio/webm" }),
    } as BlobEvent);
    this.onstop?.();
  }
}

class StoryAudioContext {
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

function buildModel(state: DictationStoryState): ThreadFooterModel {
  const controls: ThreadStageStoryControls = {
    preset: "existing-empty",
    permissionMode: "auto",
    authenticatedAccount: true,
    isQueueingEnabled: false,
    collapseAgentBody: false,
  };
  const scenario = buildThreadStageStoryScenario(controls);
  const footerModel = buildThreadStageStorySurfaceModels(scenario, controls, scenario.runtime).footerModel;
  return {
    ...footerModel,
    dictation: {
      ...footerModel.dictation,
      isEnabled: state !== "unavailable",
    },
  };
}

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPermissionModeChange: () => {},
    onQueueingEnabledChange: () => {},
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
  };
}

function ComposerDictationStory({ state }: ComposerDictationStoryProps) {
  useEffect(() => {
    document.documentElement.dataset.codexWindowType = "electron";
    Object.defineProperty(window, "api", {
      configurable: true,
      writable: true,
      value: {
        invoke: async () => null,
        on: () => () => {},
        requestMicrophonePermission: () => {},
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => {} }],
        }),
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: StoryMediaRecorder,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: StoryAudioContext,
    });
    globalThis.fetch = (state === "transcribing"
      ? (() => new Promise<Response>(() => {}))
      : (async () =>
          new Response(JSON.stringify({ text: "Story transcript" }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }))) as typeof fetch;

    if (state === "recording" || state === "transcribing") {
      const timeout = window.setTimeout(() => {
        (document.querySelector('[aria-label="Dictate"]') as HTMLButtonElement | null)?.click();
      }, 50);
      if (state !== "transcribing") {
        return () => {
          window.clearTimeout(timeout);
        };
      }

      const stopTimeout = window.setTimeout(() => {
        (document.querySelector('[aria-label="Stop dictation"]') as HTMLButtonElement | null)?.click();
      }, 400);
      return () => {
        window.clearTimeout(timeout);
        window.clearTimeout(stopTimeout);
      };
    }

    if (state === "keyboardHold") {
      const timeout = window.setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", {
          key: "m",
          ctrlKey: true,
          bubbles: true,
        }));
      }, 50);
      return () => {
        window.clearTimeout(timeout);
      };
    }
  }, [state]);

  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">Composer Dictation</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          Codex-style dictation states reconstructed from the Electron dictation flow, keyboard hold path, and buffered `/transcribe` transport.
        </div>
      </div>
      <TooltipProvider>
        <ThreadComposer
          model={buildModel(state)}
          actions={buildActions()}
          errorMessage={null}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Composer Dictation",
  component: ComposerDictationStory,
  args: {
    state: "idle",
  },
  argTypes: {
    state: {
      control: "radio",
      options: ["idle", "unavailable", "recording", "transcribing", "keyboardHold"],
    },
  },
} satisfies Meta<typeof ComposerDictationStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: {
    state: "idle",
  },
};

export const Unavailable: Story = {
  args: {
    state: "unavailable",
  },
};

export const Recording: Story = {
  args: {
    state: "recording",
  },
};

export const Transcribing: Story = {
  args: {
    state: "transcribing",
  },
};

export const KeyboardHold: Story = {
  args: {
    state: "keyboardHold",
  },
};
