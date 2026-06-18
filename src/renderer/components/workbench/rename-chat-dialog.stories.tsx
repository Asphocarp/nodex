import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexButton } from "@/components/ui/button";
import { RenameChatDialog } from "./rename-chat-dialog";

function RenameChatDialogStory() {
  const [open, setOpen] = useState(true);
  const [lastSavedTitle, setLastSavedTitle] = useState("");

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="flex items-center gap-3">
        <NodexButton size="sm" onClick={() => setOpen(true)}>
          Open Rename chat
        </NodexButton>
        <span className="text-sm text-token-description-foreground">
          {lastSavedTitle ? `Saved raw value: ${lastSavedTitle}` : "No saved value"}
        </span>
      </div>
      <RenameChatDialog
        open={open}
        initialValue="Investigate sidebar rename parity"
        busy={false}
        onOpenChange={setOpen}
        onSave={(title) => {
          setLastSavedTitle(title);
          setOpen(false);
        }}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Rename Chat Dialog",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: () => <RenameChatDialogStory />,
};
