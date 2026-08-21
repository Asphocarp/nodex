import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexButton } from "@/components/ui/button";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { CodexSidebarThreadMoveConfirmationRequired } from "../../../shared/codex-sidebar-thread-move";
import { SidebarThreadMoveConfirmationDialog } from "./sidebar-thread-move-confirmation-dialog";

const defaultConfirmation: CodexSidebarThreadMoveConfirmationRequired = {
  status: "confirmation-required",
  reason: "target-project-needs-source-access",
  threadId: "thread-1",
  targetProjectId: "project-platform",
  targetBindingRevision: 3,
  missingProjectSources: ["/Users/example/alpha", "/Users/example/shared"],
  targetProjectName: "Platform",
};

function ConfirmationDialogStory({
  confirmation,
}: {
  confirmation: CodexSidebarThreadMoveConfirmationRequired;
}) {
  const [open, setOpen] = useState(true);
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-[320px] items-center justify-center bg-token-main-surface-primary p-3">
        <NodexButton type="button" onClick={() => setOpen(true)}>
          Show move confirmation
        </NodexButton>
        {open ? (
          <SidebarThreadMoveConfirmationDialog
            confirmation={confirmation}
            onClose={() => setOpen(false)}
            onContinue={() => undefined}
          />
        ) : null}
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Workbench/Sidebar/Thread move confirmation",
  component: SidebarThreadMoveConfirmationDialog,
  args: {
    confirmation: defaultConfirmation,
    onClose: () => undefined,
    onContinue: () => undefined,
  },
  render: ({ confirmation }) => <ConfirmationDialogStory confirmation={confirmation} />,
} satisfies Meta<typeof SidebarThreadMoveConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MissingProjectSources: Story = {};

export const LongPaths: Story = {
  args: {
    confirmation: {
      ...defaultConfirmation,
      missingProjectSources: [
        "/Users/example/workspaces/client/a-very-long-folder-name-that-needs-to-truncate",
        "/Users/example/workspaces/shared/platform",
        "/Users/example/workspaces/services/api",
      ],
    },
  },
};
