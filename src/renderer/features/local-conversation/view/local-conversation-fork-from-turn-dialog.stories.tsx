import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexButton } from "@/components/ui/button";
import { LocalConversationForkFromTurnDialog } from "./local-conversation-fork-from-turn-dialog";

function ForkFromTurnDialogStory({
  isWorktreeThread,
  showWorktreeOption,
}: {
  isWorktreeThread: boolean;
  showWorktreeOption: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [lastChoice, setLastChoice] = useState("No destination selected");

  const acceptChoice = (choice: string) => {
    setOpen(false);
    setLastChoice(choice);
  };

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="flex items-center gap-3">
        <NodexButton size="sm" onClick={() => setOpen(true)}>
          Open fork dialog
        </NodexButton>
        <span className="text-sm text-token-description-foreground">{lastChoice}</span>
      </div>
      <LocalConversationForkFromTurnDialog
        open={open}
        isWorktreeThread={isWorktreeThread}
        showWorktreeOption={showWorktreeOption}
        onOpenChange={setOpen}
        onForkIntoLocal={() => {
          acceptChoice(isWorktreeThread ? "Same worktree selected" : "New task selected");
        }}
        onForkIntoWorktree={() => {
          acceptChoice("New worktree selected");
        }}
      />
    </div>
  );
}

const meta = {
  title: "Local Conversation/Fork From Turn Dialog",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const LocalTask: Story = {
  render: () => (
    <ForkFromTurnDialogStory isWorktreeThread={false} showWorktreeOption />
  ),
};

export const ManagedWorktree: Story = {
  render: () => (
    <ForkFromTurnDialogStory isWorktreeThread showWorktreeOption={false} />
  ),
};
