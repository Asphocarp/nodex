import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  CheckmarkIcon,
  ConfigStatusIcon,
  PermissionDefaultIcon,
} from "@/components/shared/icons";
import { NodexButton } from "./button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "./dialog";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownChoiceMenu,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSelectedIcon,
  NodexDropdownTitle,
} from "./dropdown";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTitle,
  NodexPopoverTrigger,
} from "./popover";
import {
  NodexSettingsPageSurface,
  NodexSettingsRow,
  NodexSettingsSection,
} from "./settings";
import { NodexTooltip, NodexTooltipProvider } from "./tooltip";

function NodexOverlaysStorySurface() {
  const [selectedAction, setSelectedAction] = useState("run");
  const [selectedProject, setSelectedProject] = useState("default");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <NodexTooltipProvider>
      <div className="flex min-h-80 flex-col gap-6 p-8">
        <div className="flex items-start gap-6">
          <NodexTooltip tooltipContent="Shared Nodex tooltip surface">
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-full px-3 text-sm text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
            >
              Tooltip trigger
            </button>
          </NodexTooltip>

          <NodexPopover>
            <NodexPopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-full px-3 text-sm text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
              >
                Popover trigger
              </button>
            </NodexPopoverTrigger>
            <NodexPopoverContent className="w-72 gap-1">
              <NodexPopoverTitle className="px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm">
                Shared popover
              </NodexPopoverTitle>
              <div className="px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm text-token-description-foreground">
                Lightweight settings and small forms should reuse this surface instead of hand-rolling
                feature-local Popover chrome.
              </div>
            </NodexPopoverContent>
          </NodexPopover>

          <NodexDropdownMenu
            triggerButton={(
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground"
              >
                Action icon
              </button>
            )}
            contentWidth="icon"
          >
            <NodexDropdownTitle>Action icon</NodexDropdownTitle>
            {[
              { value: "run", label: "Run", icon: <ConfigStatusIcon className="icon-2xs" /> },
              { value: "sandbox", label: "Sandbox", icon: <PermissionDefaultIcon className="icon-2xs" /> },
            ].map((option) => (
              <NodexDropdownItem
                key={option.value}
                onSelect={() => setSelectedAction(option.value)}
                leftSlot={option.icon}
                rightSlot={selectedAction === option.value ? <NodexDropdownSelectedIcon /> : null}
              >
                {option.label}
              </NodexDropdownItem>
            ))}
            <NodexDropdownItem
              onSelect={() => setSelectedAction("check")}
              leftSlot={<CheckmarkIcon className="icon-2xs" />}
            >
              Confirm
            </NodexDropdownItem>
          </NodexDropdownMenu>

          <NodexDropdownChoiceMenu
            value={selectedProject}
            onValueChange={setSelectedProject}
            options={[
              { value: "default", label: "Default" },
              { value: "ops", label: "Operations" },
              { value: "design", label: "Design system" },
            ]}
            triggerButton={(
              <NodexDropdownButtonTrigger aria-label="Project selector" className="min-w-40" muted>
                {selectedProject === "default" ? "Default" : selectedProject === "ops" ? "Operations" : "Design system"}
              </NodexDropdownButtonTrigger>
            )}
          />
          <NodexDropdownMenu
            triggerButton={(
              <NodexDropdownButtonTrigger
                aria-label="Sidebar actions"
                showChevron={false}
                className="h-6 w-6 justify-center px-0 text-token-description-foreground"
              >
                <span className="text-sm">⋯</span>
              </NodexDropdownButtonTrigger>
            )}
          >
            <NodexDropdownItem>Move up</NodexDropdownItem>
            <NodexDropdownItem>Move down</NodexDropdownItem>
            <NodexDropdownItem>Hide section</NodexDropdownItem>
          </NodexDropdownMenu>
          <NodexButton variant="outline" onClick={() => setDialogOpen(true)}>
            Open dialog
          </NodexButton>
        </div>

        <div className="max-w-3xl">
          <NodexSettingsPageSurface
            title="Environments"
            subtitle="Shared settings primitives should also live on the Nodex shared UI layer."
          >
            <NodexSettingsSection title="Defaults">
              <NodexSettingsRow
                label="Shared surface"
                description="Page shell, sections, and rows now live in ui/settings.tsx."
              >
                <NodexButton size="sm" variant="secondary">Enabled</NodexButton>
              </NodexSettingsRow>
            </NodexSettingsSection>
          </NodexSettingsPageSurface>
        </div>

        <NodexDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <NodexDialogContent className="max-w-md">
            <NodexDialogHeader>
              <NodexDialogTitle>Shared dialog</NodexDialogTitle>
              <NodexDialogDescription>
                Dialogs now come from the same shared Nodex family as dropdowns, tooltips, and popovers.
              </NodexDialogDescription>
            </NodexDialogHeader>
            <NodexDialogFooter>
              <NodexButton variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</NodexButton>
              <NodexButton onClick={() => setDialogOpen(false)}>Confirm</NodexButton>
            </NodexDialogFooter>
          </NodexDialogContent>
        </NodexDialog>
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Workbench/Shared/Nodex Overlays",
  component: NodexOverlaysStorySurface,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof NodexOverlaysStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
