import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { CardContextMenu } from "./card-context-menu";

const PROJECTS = [
  {
    id: "project-a",
    name: "Alpha workspace",
    icon: "A",
    primaryWorkspaceRoot: "/Users/asc/repo/nodex",
  },
  {
    id: "project-b",
    name: "Beta workspace",
    icon: "B",
    primaryWorkspaceRoot: "/Users/asc/repo/devtools-codex",
  },
  {
    id: "project-c",
    name: "Gamma workspace",
    icon: "G",
    description: "Archived experiments",
  },
];

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

function CardContextMenuStory({
  openMoveView = false,
}: {
  openMoveView?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dispatchContextMenu(triggerRef.current);

    if (!openMoveView) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const moveToItem = Array.from(document.querySelectorAll<HTMLElement>("[data-card-menu-item='true']")).find(
        (element) => element.textContent?.includes("Move to"),
      );
      moveToItem?.click();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [openMoveView]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-token-main-surface-primary p-8">
      <CardContextMenu
        card={{
          id: "card-1",
          created: new Date("2026-03-21T14:20:00.000Z"),
        }}
        currentColumnId="inbox"
        currentProjectId="project-a"
        currentProjectName="Alpha workspace"
        projects={PROJECTS}
        onMoveToProject={() => {}}
        onDelete={() => {}}
        onCopyLink={() => {}}
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

export const MoveOpen: Story = {
  render: () => <CardContextMenuStory openMoveView={true} />,
};
