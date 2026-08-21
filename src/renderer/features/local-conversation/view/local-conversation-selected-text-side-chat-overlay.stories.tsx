import type { Meta, StoryObj } from "@storybook/react-vite";
import { SelectedTextSideChatOverlayView } from "./local-conversation-selected-text-side-chat-overlay";

function SelectedTextOverlayStoryFrame() {
  return (
    <div className="h-[360px] bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="relative mx-auto flex h-full max-w-3xl flex-col justify-center">
        <div className="max-w-[70%] rounded-2xl bg-token-foreground/8 px-3 py-2 text-sm leading-6">
          Refactor the transcript actions so selected text commands belong to the thread overlay,
          not each message action row.
        </div>
        <div className="mt-8 max-w-2xl text-sm leading-6 text-token-text-secondary">
          The overlay should follow the selected text range, keep side chat as a draft action, and
          leave copy/edit chrome on the row.
        </div>
        <SelectedTextSideChatOverlayView
          layout={{ leftPx: 286, topPx: 92 }}
          onAskInSideChat={() => {}}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Selected Text Side Chat Overlay",
  component: SelectedTextOverlayStoryFrame,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SelectedTextOverlayStoryFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ForcedSelectionOverlay: Story = {};
