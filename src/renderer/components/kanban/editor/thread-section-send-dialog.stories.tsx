import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  ThreadSectionSendDialog,
  type ThreadSectionSendDialogState,
} from "./thread-section-send-dialog";

function ThreadSectionSendDialogStory({ state }: { state: ThreadSectionSendDialogState }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-[420px] rounded-[24px] border border-(--border) bg-[color-mix(in_srgb,var(--background-secondary)_72%,transparent)] p-6 shadow-[0_20px_56px_rgba(0,0,0,0.18)]">
      <ThreadSectionSendDialog
        open={open}
        state={state}
        onOpenChange={setOpen}
        onConfirm={() => setOpen(false)}
      />
    </div>
  );
}

const meta = {
  title: "Kanban/Editor/Thread Section Send Dialog",
  component: ThreadSectionSendDialogStory,
  parameters: {
    docs: {
      description: {
        component:
          "Confirmation dialog states for notebook-style thread sections, including auto-create insertion, existing-thread sends, and preview density extremes.",
      },
    },
  },
} satisfies Meta<typeof ThreadSectionSendDialogStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ExistingThread: Story = {
  args: {
    state: {
      sectionTitle: "Thread renderer parity pass",
      plainTextPreview: "Audit the renderer item stream.\nTrace tool-call leaf coverage.\nVerify fork and edit flows.",
      threadLabel: "Renderer parity polish",
      sendActionLabel: "Send to existing thread",
      autoCreateSection: false,
    },
  },
};

export const AutoCreateSection: Story = {
  args: {
    state: {
      sectionTitle: "Untitled section",
      plainTextPreview: "Start from the current block and create a new linked thread.",
      threadLabel: "No existing thread",
      sendActionLabel: "Start a new thread",
      autoCreateSection: true,
    },
  },
};

export const EmptyPreview: Story = {
  args: {
    state: {
      sectionTitle: "Empty section",
      plainTextPreview: "",
      threadLabel: "No existing thread",
      sendActionLabel: "Start a new thread",
      autoCreateSection: false,
    },
  },
};

export const LongPreview: Story = {
  args: {
    state: {
      sectionTitle: "Dense story fixture audit",
      plainTextPreview: [
        "Summarize the current local-conversation renderer shape.",
        "",
        "- Cover every tool-call subtype currently dispatched from get-tool-component.tsx",
        "- Show blocked approval, blocked user-input, and implement-plan request lanes",
        "- Demonstrate search-open, inline edit, latest-turn fork, and older-turn fork confirmation",
        "",
        "Then propose the smallest reusable Storybook fixture layer that keeps all of this on the real projection path.",
      ].join("\n"),
      threadLabel: "Storybook rollout thread",
      sendActionLabel: "Send to existing thread",
      autoCreateSection: false,
    },
  },
};
