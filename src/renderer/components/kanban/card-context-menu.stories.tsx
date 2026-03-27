import type { Meta, StoryObj } from "@storybook/react-vite";
import { CardContextMenu } from "./card-context-menu";

function CardContextMenuStoryDemo() {
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
        projects={[
          {
            id: "project-a",
            name: "Alpha workspace",
            icon: "A",
            workspacePath: "/Users/asc/repo/nodex",
          },
          {
            id: "project-b",
            name: "Beta workspace",
            icon: "B",
            workspacePath: "/Users/asc/repo/devtools-codex",
          },
          {
            id: "project-c",
            name: "Gamma workspace",
            icon: "G",
            description: "Archived experiments",
          },
        ]}
        onMoveToProject={() => {}}
        onDelete={() => {}}
        onCopyLink={() => {}}
      >
        <button
          type="button"
          data-testid="card-context-menu-trigger"
          className="rounded-xl bg-token-main-surface-secondary px-4 py-3 text-sm text-token-foreground shadow-sm ring-1 ring-token-border"
        >
          Right-click card
        </button>
      </CardContextMenu>
      <div className="pointer-events-none absolute bottom-6 text-sm text-token-description-foreground">
        Right-click the card to open the menu.
      </div>
    </div>
  );
}

const meta = {
  title: "Kanban/Card Context Menu",
  component: CardContextMenuStoryDemo,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Card context menu aligned to the shared Codex menu surface.",
      },
    },
  },
} satisfies Meta<typeof CardContextMenuStoryDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
