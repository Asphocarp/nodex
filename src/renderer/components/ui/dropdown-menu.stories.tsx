import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  CheckmarkIcon,
  ConfigStatusIcon,
  PermissionDefaultIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSection,
  NodexDropdownSeparator,
  NodexDropdownTitle,
} from "./dropdown";

function NodexDropdownStorySurface() {
  const [selectedAction, setSelectedAction] = useState("run");
  const [selectedPermission, setSelectedPermission] = useState("sandbox");

  return (
    <div className="flex min-h-80 items-start gap-6 p-8">
      <NodexDropdownMenu
        triggerButton={(
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-transparent px-3 text-sm text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
          >
            Action icon
          </button>
        )}
        contentWidth="icon"
      >
        {[
          { value: "run", label: "Run", icon: <ConfigStatusIcon className="icon-2xs" /> },
          { value: "sandbox", label: "Sandbox", icon: <PermissionDefaultIcon className="icon-2xs" /> },
        ].map((option) => (
          <NodexDropdownItem
            key={option.value}
            onSelect={() => setSelectedAction(option.value)}
            leftSlot={option.icon}
            rightSlot={selectedAction === option.value ? <CheckmarkIcon className="icon-2xs" /> : null}
          >
            {option.label}
          </NodexDropdownItem>
        ))}
      </NodexDropdownMenu>

      <NodexDropdownMenu
        triggerButton={(
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-transparent px-3 text-sm text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
          >
            Permission mode
          </button>
        )}
        contentWidth="workspace"
        sideOffset={6}
      >
        <NodexDropdownSection className="flex min-w-40 flex-col overflow-hidden pt-1">
          <NodexDropdownTitle>Permission mode</NodexDropdownTitle>
          <NodexDropdownItem
            onSelect={() => setSelectedPermission("sandbox")}
            leftSlot={<PermissionDefaultIcon className="icon-2xs" />}
            rightSlot={selectedPermission === "sandbox" ? <CheckmarkIcon className="icon-2xs" /> : null}
            tooltipText="Codex automatically runs commands in a workspace sandbox and asks before protected actions."
          >
            Workspace sandbox
          </NodexDropdownItem>
          <NodexDropdownSeparator />
          <NodexDropdownItem
            onSelect={() => setSelectedPermission("full-access")}
            leftSlot={<ConfigStatusIcon className="icon-2xs" />}
            rightSlot={selectedPermission === "full-access" ? <CheckmarkIcon className="icon-2xs" /> : null}
            tooltipText="Codex has full access over your computer and bypasses approval prompts."
          >
            Full access
          </NodexDropdownItem>
        </NodexDropdownSection>
      </NodexDropdownMenu>
    </div>
  );
}

const meta = {
  title: "Workbench/Shared/Nodex Dropdown",
  component: NodexDropdownStorySurface,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof NodexDropdownStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
