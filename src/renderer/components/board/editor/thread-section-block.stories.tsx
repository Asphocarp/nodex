import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ThreadSectionRow } from "./thread-section-row";
import type { ThreadSectionLinkedThreadState } from "./thread-section-runtime";

interface ThreadSectionRowStoryProps {
  label: string;
  threadId: string;
  thread: ThreadSectionLinkedThreadState | null;
  pending: boolean;
  canOpenThread: boolean;
  canSend: boolean;
}

function buildThread(
  overrides?: Partial<ThreadSectionLinkedThreadState>,
): ThreadSectionLinkedThreadState {
  return {
    threadId: "thr_story",
    threadName: "Polish local conversation Storybook",
    threadPreview: "Cover tools, forks, and request surfaces.",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    updatedAt: Date.now() - 4 * 60_000,
    ...overrides,
  };
}

function ThreadSectionRowStory({
  label,
  threadId,
  thread,
  pending,
  canOpenThread,
  canSend,
}: ThreadSectionRowStoryProps) {
  const [draftLabel, setDraftLabel] = useState(label);

  return (
    <div className="rounded-[20px] border border-(--border) bg-(--background) px-4 py-6 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <ThreadSectionRow
        blockId="thread-section-story"
        label={draftLabel}
        threadId={threadId}
        thread={thread}
        pending={pending}
        canOpenThread={canOpenThread}
        canSend={canSend}
        onLabelChange={setDraftLabel}
        onOpenThread={() => {}}
        onSend={() => {}}
      />
    </div>
  );
}

const meta = {
  title: "Board/Editor/Thread Section",
  component: ThreadSectionRowStory,
  parameters: {
    docs: {
      description: {
        component:
          "Shared thread-section row states used by both the editor block and Storybook, covering binding, pending send, and status-density cases without introducing a second render path.",
      },
    },
  },
  args: {
    label: "Investigate transcript projection",
    threadId: "thr_story",
    thread: buildThread(),
    pending: false,
    canOpenThread: true,
    canSend: true,
  },
  argTypes: {
    pending: { control: "boolean" },
    canOpenThread: { control: "boolean" },
    canSend: { control: "boolean" },
  },
} satisfies Meta<typeof ThreadSectionRowStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BoundIdle: Story = {};

export const Unbound: Story = {
  args: {
    label: "",
    threadId: "",
    thread: null,
    canOpenThread: false,
  },
};

export const Running: Story = {
  args: {
    thread: buildThread({
      statusType: "active",
      updatedAt: Date.now() - 36_000,
    }),
  },
};

export const WaitingOnApproval: Story = {
  args: {
    thread: buildThread({
      statusType: "active",
      statusActiveFlags: ["waitingOnApproval"],
    }),
  },
};

export const WaitingOnUserInput: Story = {
  args: {
    thread: buildThread({
      statusType: "active",
      statusActiveFlags: ["waitingOnUserInput"],
    }),
  },
};

export const ArchivedUnavailable: Story = {
  args: {
    canOpenThread: false,
    thread: buildThread({
      archived: true,
      statusType: "idle",
    }),
  },
};

export const PendingSend: Story = {
  args: {
    pending: true,
    canSend: true,
  },
};

export const LongNames: Story = {
  args: {
    label: "Thread section with a deliberately long notebook label to stress truncation and hover-reveal density",
    thread: buildThread({
      threadName: "A very long linked thread name that should stay legible without blowing up the row layout",
      threadPreview: "Tighten the capsule copy and action choreography for the Storybook editor row.",
    }),
  },
};
