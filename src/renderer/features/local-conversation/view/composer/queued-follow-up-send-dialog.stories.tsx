import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexButton } from "@/components/ui/button";
import { QueuedFollowUpSendDialog } from "./queued-follow-up-send-dialog";

function QueuedFollowUpSendDialogStory({
  queuedMessageCount,
  pending = false,
}: {
  queuedMessageCount: number;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [lastAction, setLastAction] = useState("No decision made");

  const choose = (action: string) => {
    setLastAction(action);
    setOpen(false);
  };

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="flex items-center gap-3">
        <NodexButton size="sm" onClick={() => setOpen(true)}>
          Open send dialog
        </NodexButton>
        <span className="text-sm text-token-description-foreground">{lastAction}</span>
      </div>
      <QueuedFollowUpSendDialog
        open={open}
        queuedMessageCount={queuedMessageCount}
        pending={pending}
        onOpenChange={setOpen}
        onClearQueue={() => choose("Queue cleared")}
        onSendMessage={() => choose("Message sent first")}
      />
    </div>
  );
}

const meta = {
  title: "Local Conversation/Queued Follow-Up Send Dialog",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Singular: Story = {
  render: () => <QueuedFollowUpSendDialogStory queuedMessageCount={1} />,
};

export const Plural: Story = {
  render: () => <QueuedFollowUpSendDialogStory queuedMessageCount={3} />,
};

export const Pending: Story = {
  render: () => <QueuedFollowUpSendDialogStory queuedMessageCount={2} pending />,
};
