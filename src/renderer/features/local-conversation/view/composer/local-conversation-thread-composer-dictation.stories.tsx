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
import { TestComposerScopePath } from "@/test/maitai-scope-harness";
import { COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ } from "./composer-dictation-waveform";

const STORY_AUDIO_BUFFER_SIZE = 2048;

type DictationStoryState = "idle" | "unavailable" | "recording" | "transcribing" | "keyboardHold";

interface ComposerDictationStoryProps {
  state: DictationStoryState;
}

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }

  Reflect.deleteProperty(target, property);
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

interface StoryAudioProcessingEvent {
  inputBuffer: {
    getChannelData: () => Float32Array;
  };
}

class StoryScriptProcessor {
  public onaudioprocess: ((event: StoryAudioProcessingEvent) => void) | null = null;
  private intervalId: number | null = null;
  private sampleCursor = 0;

  connect(): void {
    if (this.intervalId !== null) return;

    this.intervalId = window.setInterval(
      () => {
        const samples = new Float32Array(STORY_AUDIO_BUFFER_SIZE);
        const envelope = 0.035 + (Math.sin(this.sampleCursor / 18_000) + 1) * 0.025;
        for (let index = 0; index < samples.length; index += 1) {
          const position = this.sampleCursor + index;
          samples[index] = Math.sin(position * 0.025) * envelope;
        }
        this.sampleCursor += samples.length;
        this.onaudioprocess?.({
          inputBuffer: {
            getChannelData: () => samples,
          },
        });
      },
      (1_000 * STORY_AUDIO_BUFFER_SIZE) / COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ,
    );
  }

  disconnect(): void {
    if (this.intervalId === null) return;
    window.clearInterval(this.intervalId);
    this.intervalId = null;
  }
}

class StoryAudioContext {
  public sampleRate = COMPOSER_DICTATION_WAVEFORM_SAMPLE_RATE_HZ;

  createMediaStreamSource() {
    return {
      connect: () => {},
      disconnect: () => {},
    };
  }

  createScriptProcessor() {
    return new StoryScriptProcessor();
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
  const footerModel = buildThreadStageStorySurfaceModels(
    scenario,
    controls,
    scenario.runtime,
  ).footerModel;
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
    onUnarchiveThread: async () => {},
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
  };
}

function ComposerDictationStory({ state }: ComposerDictationStoryProps) {
  useEffect(() => {
    const previousWindowType = document.documentElement.dataset.codexWindowType;
    const apiDescriptor = Object.getOwnPropertyDescriptor(window, "api");
    const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const mediaRecorderDescriptor = Object.getOwnPropertyDescriptor(window, "MediaRecorder");
    const audioContextDescriptor = Object.getOwnPropertyDescriptor(window, "AudioContext");
    const previousFetch = globalThis.fetch;
    let startTimeout: number | null = null;
    let stopTimeout: number | null = null;

    document.documentElement.dataset.codexWindowType = "electron";
    Object.defineProperty(window, "api", {
      configurable: true,
      writable: true,
      value: {
        invoke: async () => null,
        on: () => () => {},
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
    globalThis.fetch = (
      state === "transcribing"
        ? () => new Promise<Response>(() => {})
        : async () =>
            new Response(JSON.stringify({ text: "Story transcript" }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            })
    ) as typeof fetch;

    if (state === "recording" || state === "transcribing") {
      startTimeout = window.setTimeout(() => {
        (document.querySelector('[aria-label="Dictate"]') as HTMLButtonElement | null)?.click();
      }, 50);

      if (state === "transcribing") {
        stopTimeout = window.setTimeout(() => {
          (
            document.querySelector('[aria-label="Stop dictation"]') as HTMLButtonElement | null
          )?.click();
        }, 400);
      }
    }

    if (state === "keyboardHold") {
      startTimeout = window.setTimeout(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "m",
            ctrlKey: true,
            bubbles: true,
          }),
        );
      }, 50);
    }

    return () => {
      if (startTimeout !== null) {
        window.clearTimeout(startTimeout);
      }
      if (stopTimeout !== null) {
        window.clearTimeout(stopTimeout);
      }

      restoreProperty(window, "api", apiDescriptor);
      restoreProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
      restoreProperty(window, "MediaRecorder", mediaRecorderDescriptor);
      restoreProperty(window, "AudioContext", audioContextDescriptor);
      globalThis.fetch = previousFetch;

      if (previousWindowType === undefined) {
        delete document.documentElement.dataset.codexWindowType;
      } else {
        document.documentElement.dataset.codexWindowType = previousWindowType;
      }
    };
  }, [state]);

  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">Composer Dictation</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          Electron dictation states with keyboard hold, buffered transcription, and a ten-second
          rolling waveform.
        </div>
      </div>
      <TooltipProvider>
        <TestComposerScopePath>
          <ThreadComposer
            model={buildModel(state)}
            actions={buildActions()}
            errorMessage={null}
            onErrorMessage={() => {}}
          />
        </TestComposerScopePath>
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
