import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { CardContextMenu } from "./card-context-menu";

function dispatchContextMenu(target: HTMLElement | null) {
  if (!target) {
    return;
  }

  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + 16,
    clientY: rect.top + 16,
    button: 2,
  }));
}

function CardContextMenuStory() {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dispatchContextMenu(triggerRef.current);

  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-token-main-surface-primary p-8">
      <CardContextMenu
        card={{
          id: "card-1",
          created: new Date("2026-03-21T14:20:00.000Z"),
          title: "Release plan",
        }}
        currentColumnId="inbox"
        currentProjectId="project-a"
        currentProjectName="Alpha workspace"
        onDelete={() => {}}
        onCopyLink={() => {}}
        onOpenPage={() => {}}
        onOpenPageInNewChat={() => {}}
        onSendPageToChat={() => Promise.resolve()}
        showMockActions
      >
        <button
          ref={triggerRef}
          type="button"
          data-testid="card-context-menu-trigger"
          className="rounded-xl bg-token-main-surface-secondary px-4 py-3 text-sm text-token-foreground shadow-sm ring-1 ring-token-border"
        >
          Card context menu harness
        </button>
      </CardContextMenu>
    </div>
  );
}

const meta = {
  title: "Kanban/Card Context Menu",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Story-only harnesses that render the menu already open instead of requiring manual right-click.",
      },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActionsOpen: Story = {
  render: () => <CardContextMenuStory />,
};
