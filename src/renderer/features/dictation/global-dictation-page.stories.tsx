import type { Meta, StoryObj } from "@storybook/react-vite";
import { GlobalDictationBar } from "./global-dictation-page";

const meta = {
  title: "Dictation/Global bar",
  component: GlobalDictationBar,
  parameters: { layout: "fullscreen" },
  args: {
    waveform: [],
    onDismiss: () => undefined,
    onRetry: () => undefined,
    onClose: () => undefined,
  },
  decorators: [
    (Story, context) => (
      <div
        className={`fixed inset-0 flex items-end justify-center overflow-hidden bg-[#707070] ${context.args.state === "error" ? "p-1" : ""}`}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GlobalDictationBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initializing: Story = { args: { state: "initializing" } };
export const Idle: Story = {
  args: {
    state: "idle",
    configuredHotkey: "Fn",
    configuredToggleHotkey: "Command+Shift+D",
  },
};
export const Listening: Story = {
  args: { state: "listening", waveform: [0.02, 0.055, 0.08, 0.036] },
};
export const Transcribing: Story = { args: { state: "transcribing" } };
export const Error: Story = {
  args: {
    state: "error",
    error: { kind: "transcription-network", operation: "transcribe", retryable: true },
  },
};
