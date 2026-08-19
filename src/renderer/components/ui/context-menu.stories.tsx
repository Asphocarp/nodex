import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  ChevronRightIcon,
  PageMenuCopyIcon,
  PageMenuMoveIcon,
  PageMenuOpenInIcon,
} from "@/components/shared/icons";
import {
  NodexContextMenuContent,
  NodexContextMenuItem,
  NodexContextMenuPortal,
  NodexContextMenuRoot,
  NodexContextMenuSubmenu,
  NodexContextMenuSubmenuTrigger,
  NodexContextMenuTrigger,
} from "./context-menu";

function ActionSubmenu({
  label,
  icon,
  actions,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly actions: readonly string[];
}) {
  return (
    <NodexContextMenuSubmenu
      trigger={(
        <NodexContextMenuSubmenuTrigger
          leftSlot={icon}
          rightSlot={<ChevronRightIcon className="size-3.5" />}
        >
          {label}
        </NodexContextMenuSubmenuTrigger>
      )}
      renderContent={() => actions.map((action) => (
        <NodexContextMenuItem key={action}>{action}</NodexContextMenuItem>
      ))}
    />
  );
}

function DenseContextMenuStory() {
  return (
    <div className="flex min-h-[420px] items-center justify-center bg-token-main-surface-primary p-10">
      <NodexContextMenuRoot>
        <NodexContextMenuTrigger asChild>
          <button
            type="button"
            className="rounded-lg bg-token-main-surface-secondary px-5 py-4 text-sm text-token-foreground ring-[0.5px] ring-token-border"
          >
            Right-click this Page
          </button>
        </NodexContextMenuTrigger>
        <NodexContextMenuPortal>
          <NodexContextMenuContent className="min-w-52">
            <ActionSubmenu
              label="Open in"
              icon={<PageMenuOpenInIcon />}
              actions={["Open in new session", "Send to chat…"]}
            />
            <ActionSubmenu
              label="Copy"
              icon={<PageMenuCopyIcon />}
              actions={["Copy ID", "Copy deeplink", "Copy title", "Copy content as Markdown"]}
            />
            <ActionSubmenu
              label="Move"
              icon={<PageMenuMoveIcon />}
              actions={["Move up", "Move down", "Move to top", "Move to bottom"]}
            />
          </NodexContextMenuContent>
        </NodexContextMenuPortal>
      </NodexContextMenuRoot>
    </div>
  );
}

const meta = {
  title: "UI/Context Menu",
  component: DenseContextMenuStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DenseContextMenuStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DenseSubmenus: Story = {};
