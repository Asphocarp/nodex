import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexButton } from "@/components/ui/button";
import { SidebarThreadMoveBlockedDialog } from "./sidebar-thread-move-blocked-dialog";

function BlockedMoveDialogStory() {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-[320px] items-center justify-center bg-token-main-surface-primary p-3">
      <NodexButton type="button" onClick={() => setOpen(true)}>
        Show blocked move
      </NodexButton>
      <SidebarThreadMoveBlockedDialog
        blocked={open ? {
          status: "blocked",
          reason: "missing-project-sources",
          missingProjectSources: ["/Users/example/alpha", "/Users/example/shared"],
          targetProjectName: "Platform",
        } : null}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Sidebar/Thread move blocked",
  component: SidebarThreadMoveBlockedDialog,
  args: {
    blocked: null,
    onClose: () => undefined,
  },
  render: () => <BlockedMoveDialogStory />,
} satisfies Meta<typeof SidebarThreadMoveBlockedDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MissingProjectSources: Story = {};
