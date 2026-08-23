import type { Meta, StoryObj } from "@storybook/react-vite";
import { GlobalDictationBar } from "./global-dictation-page";

const meta = {
  title: "Dictation/Global bar",
  component: GlobalDictationBar,
  parameters: { layout: "centered" },
  args: { waveform: [], onCancel: () => undefined, onRetry: () => undefined },
  decorators: [
    (Story) => (
      <div className="bg-[radial-gradient(circle_at_center,#3b4038,#111)] p-10">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GlobalDictationBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initializing: Story = { args: { state: "initializing" } };
export const Idle: Story = { args: { state: "idle" } };
export const Listening: Story = {
  args: { state: "listening", waveform: [0.1, 0.25, 0.8, 0.35, 0.6, 0.2] },
};
export const Transcribing: Story = { args: { state: "transcribing" } };
export const Error: Story = {
  args: {
    state: "error",
    error: { kind: "transcription-network", operation: "transcribe", retryable: true },
  },
};
