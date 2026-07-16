import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Check, FolderGit2, Settings2, Shield, Sparkles, SquareKanban, Table2 } from "lucide-react";
import {
  CodexSidePanelBrowserIcon,
  CodexSidePanelFilesIcon,
  CodexSidePanelReviewIcon,
  CodexSidePanelSideChatIcon,
  ConfigStatusIcon,
  EstimatePickerIcon,
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
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMessage,
  NodexDropdownMenu,
  NodexDropdownSearchInput,
  NodexDropdownSection,
  NodexDropdownSectionLabel,
  NodexDropdownSeparator,
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
import { NodexToastProvider, toast } from "./toast";
import { NodexTooltip, NodexTooltipProvider } from "./tooltip";

function StorySurface({ children }: { children: React.ReactNode }) {
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start justify-center bg-token-main-surface-primary p-10">
        {children}
      </div>
    </NodexTooltipProvider>
  );
}

function XsTriggerDropdownDemo() {
  const [value, setValue] = useState("auto");

  return (
    <StorySurface>
      <NodexDropdownChoiceMenu
        open={true}
        value={value}
        onValueChange={setValue}
        contentWidth="xs"
        triggerButton={(
          <NodexDropdownButtonTrigger size="xs" className="min-w-18">
            {value === "auto" ? "Auto" : value === "high" ? "High" : "Low"}
          </NodexDropdownButtonTrigger>
        )}
        options={[
          { value: "auto", label: "Auto" },
          { value: "high", label: "High" },
          { value: "low", label: "Low" },
        ]}
      />
    </StorySurface>
  );
}

function CompactIconLabelTriggerDemo() {
  const [value, setValue] = useState("estimate");

  return (
    <StorySurface>
      <NodexDropdownChoiceMenu
        open={true}
        value={value}
        onValueChange={setValue}
        contentWidth="xs"
        triggerButton={(
          <NodexDropdownButtonTrigger size="xs">
            <EstimatePickerIcon />
            <span>Estimate</span>
          </NodexDropdownButtonTrigger>
        )}
        options={[
          { value: "estimate", label: "Estimate" },
          { value: "priority", label: "Priority" },
        ]}
      />
    </StorySurface>
  );
}

function IconOnlyDropdownDemo() {
  const [value, setValue] = useState("run");

  return (
    <StorySurface>
      <NodexDropdownMenu
        open={true}
        contentWidth="icon"
        triggerButton={(
          <NodexDropdownButtonTrigger
            aria-label="Action icon"
            showChevron={false}
            className="size-8 justify-center rounded-full px-0"
          >
            <Sparkles className="size-4" />
          </NodexDropdownButtonTrigger>
        )}
      >
        <NodexDropdownTitle>Action icon</NodexDropdownTitle>
        <NodexDropdownItem
          leftSlot={<Sparkles className="size-4" />}
          rightSlot={value === "run" ? <Check className="size-4" /> : null}
          onSelect={() => setValue("run")}
        >
          Run
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<Shield className="size-4" />}
          rightSlot={value === "sandbox" ? <Check className="size-4" /> : null}
          onSelect={() => setValue("sandbox")}
        >
          Sandbox
        </NodexDropdownItem>
      </NodexDropdownMenu>
    </StorySurface>
  );
}

function PanelActionIconDropdownDemo() {
  return (
    <StorySurface>
      <NodexDropdownMenu
        open={true}
        contentWidth="menuWide"
        triggerButton={(
          <NodexDropdownButtonTrigger className="min-w-32">
            Panel tab
          </NodexDropdownButtonTrigger>
        )}
      >
        <NodexDropdownItem
          leftSlot={<CodexSidePanelFilesIcon className="icon-sm" />}
          keyboardShortcut="⌘P"
        >
          Files
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<CodexSidePanelSideChatIcon className="icon-sm" />}
        >
          Side chat
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<CodexSidePanelBrowserIcon className="icon-sm" />}
          keyboardShortcut="⌘T"
        >
          Browser
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<CodexSidePanelReviewIcon className="icon-sm" />}
          keyboardShortcut="⌃⇧G"
        >
          Review
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<Table2 className="icon-sm" />}
        >
          DB View
        </NodexDropdownItem>
        <NodexDropdownItem
          leftSlot={<SquareKanban className="icon-sm" />}
        >
          Page Stage
        </NodexDropdownItem>
      </NodexDropdownMenu>
    </StorySurface>
  );
}

function LongLabelDropdownDemo() {
  return (
    <StorySurface>
      <NodexDropdownChoiceMenu
        open={true}
        value="workspace"
        onValueChange={() => {}}
        contentWidth="workspace"
        triggerButton={(
          <NodexDropdownButtonTrigger className="w-[22rem] justify-start">
            A very long workspace label that should truncate cleanly without breaking the trigger chrome
          </NodexDropdownButtonTrigger>
        )}
        options={[
          {
            value: "workspace",
            label: "A very long workspace label that should truncate cleanly without breaking the menu",
            tooltipText: "/Users/asc/repo/nodex/design.local/codex-electron-app",
          },
          {
            value: "beta",
            label: "Beta workspace with another long descriptive suffix",
          },
        ]}
      />
    </StorySurface>
  );
}

function SearchableDropdownDemo() {
  return (
    <StorySurface>
      <NodexDropdownMenu
        open={true}
        contentWidth="panel"
        triggerButton={(
          <NodexDropdownButtonTrigger className="min-w-40">
            Searchable menu
          </NodexDropdownButtonTrigger>
        )}
      >
        <NodexDropdownTitle>Project</NodexDropdownTitle>
        <NodexDropdownSearchInput placeholder="Search projects" />
        <NodexDropdownSectionLabel>Recent</NodexDropdownSectionLabel>
        <NodexDropdownSection className="flex flex-col">
          <NodexDropdownItem leftSlot={<FolderGit2 className="size-4" />}>
            Nodex
          </NodexDropdownItem>
          <NodexDropdownItem leftSlot={<FolderGit2 className="size-4" />}>
            Codex Electron readable bundle
          </NodexDropdownItem>
        </NodexDropdownSection>
        <NodexDropdownSeparator />
        <NodexDropdownMessage compact>Type to narrow the list</NodexDropdownMessage>
      </NodexDropdownMenu>
    </StorySurface>
  );
}

function FlyoutSubmenuDropdownDemo() {
  const [value, setValue] = useState("10");

  return (
    <StorySurface>
      <NodexDropdownMenu
        open={true}
        contentWidth="sm"
        triggerButton={(
          <NodexDropdownButtonTrigger showChevron={false} className="size-8 justify-center px-0">
            <Settings2 className="size-4" />
          </NodexDropdownButtonTrigger>
        )}
      >
        <NodexDropdownFlyoutSubmenuItem
          label="Show"
          contentClassName="min-w-[180px]"
          triggerContent={(
            <div className="flex w-full items-center gap-2 text-sm">
              <ConfigStatusIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Show</span>
              <span className="ml-auto shrink-0 text-xs text-token-description-foreground">10</span>
            </div>
          )}
        >
          {["10", "25", "50"].map((limit) => (
            <NodexDropdownItem
              key={limit}
              onSelect={() => setValue(limit)}
              rightSlot={value === limit ? <Check className="size-4" /> : null}
            >
              {limit} items
            </NodexDropdownItem>
          ))}
        </NodexDropdownFlyoutSubmenuItem>
        <NodexDropdownItem leftSlot={<FolderGit2 className="size-4" />}>
          Move down
        </NodexDropdownItem>
      </NodexDropdownMenu>
    </StorySurface>
  );
}

function CompactTooltipDemo() {
  return (
    <StorySurface>
      <div className="flex items-center gap-4">
        <NodexTooltip open={true} tooltipContent="Edit">
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-full bg-token-main-surface-secondary text-token-description-foreground ring-1 ring-token-border"
          >
            <Settings2 className="size-4" />
          </button>
        </NodexTooltip>
        <NodexTooltip
          open={true}
          tooltipContent="/Users/asc/repo/nodex/README.md"
          side="bottom"
          align="start"
        >
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-full bg-token-main-surface-secondary px-3 text-sm text-token-foreground ring-1 ring-token-border"
          >
            README.md
          </button>
        </NodexTooltip>
      </div>
    </StorySurface>
  );
}

function PopoverDemo() {
  return (
    <StorySurface>
      <NodexPopover open={true}>
        <NodexPopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-full bg-token-main-surface-secondary px-3 text-sm text-token-foreground ring-1 ring-token-border"
          >
            Project manager
          </button>
        </NodexPopoverTrigger>
        <NodexPopoverContent className="w-72 gap-1 p-2">
          <NodexPopoverTitle className="px-2 py-1 text-sm font-medium">
            Projects
          </NodexPopoverTitle>
          <div className="flex flex-col gap-1 px-1 pb-1">
            <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-token-list-hover-background">
              <span className="size-2.5 rounded-full bg-[var(--accent-blue)]" />
              Nodex
            </button>
            <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-token-list-hover-background">
              <span className="size-2.5 rounded-full bg-[var(--accent-green)]" />
              Codex readable bundle
            </button>
          </div>
        </NodexPopoverContent>
      </NodexPopover>
    </StorySurface>
  );
}

function DialogDemo() {
  return (
    <StorySurface>
      <NodexDialog open={true}>
        <NodexDialogContent className="max-w-md">
          <NodexDialogHeader>
            <NodexDialogTitle>Discard draft changes?</NodexDialogTitle>
            <NodexDialogDescription>
              This locks the shared dialog shell against typography, spacing, and footer button regressions.
            </NodexDialogDescription>
          </NodexDialogHeader>
          <NodexDialogFooter>
            <NodexButton variant="ghost">Cancel</NodexButton>
            <NodexButton variant="primary">Discard</NodexButton>
          </NodexDialogFooter>
        </NodexDialogContent>
      </NodexDialog>
    </StorySurface>
  );
}

function SettingsDemo() {
  return (
    <StorySurface>
      <div className="h-[720px] w-full max-w-4xl overflow-hidden rounded-[24px] border border-token-border bg-token-side-bar-background">
        <NodexSettingsPageSurface
          title="Environments"
          subtitle="Local environments tell Nodex how to set up worktrees for a project."
          action={<NodexButton size="composer">Add project</NodexButton>}
        >
          <NodexSettingsSection title="Select a project">
            <NodexSettingsRow
              label="Nodex"
              description="/Users/asc/repo/nodex"
            >
              <NodexButton variant="secondary" size="sm">Open</NodexButton>
            </NodexSettingsRow>
            <NodexSettingsRow
              label="Codex Electron bundle"
              description="/Users/asc/repo/devtools-codex"
            >
              <NodexButton variant="ghost" size="sm">View</NodexButton>
            </NodexSettingsRow>
          </NodexSettingsSection>
        </NodexSettingsPageSurface>
      </div>
    </StorySurface>
  );
}

function ToastDemo() {
  useEffect(() => {
    toast.closeAll();
    toast.info("Workspace indexed", {
      description: "Nodex finished scanning 148 files.",
      duration: 0,
    });
    toast.success("Managed worktree ready", {
      description: "Environment setup completed successfully.",
      duration: 0,
    });
    toast.warning("Review snapshot is stale", {
      description: "Refresh review state before applying more hunks.",
      duration: 0,
    });
    toast.danger("Could not start the helper thread", {
      description: "The selected environment script exited with code 1.",
      duration: 0,
    });
    toast.info("Syncing OAuth callback", {
      id: "oauth-flow",
      duration: 0,
    });
    toast.success("Connected to GitHub", {
      id: "oauth-flow",
      description: "The keyed toast replaced the earlier pending state.",
      duration: 0,
    });
    toast.custom({
      level: "danger",
      duration: 0,
      hasCloseButton: false,
      content: ({ close }) => (
        <div className="flex items-start gap-3 p-3">
          <div className="mt-0.5 size-2.5 rounded-full bg-token-charts-red" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-token-foreground">
              Git push failed
            </div>
            <div className="text-sm text-token-description-foreground">
              Non-fast-forward update rejected. Review the remote branch before retrying.
            </div>
          </div>
          <NodexButton variant="secondary" size="xs" onClick={close}>
            Dismiss
          </NodexButton>
        </div>
      ),
    });

    return () => {
      toast.closeAll();
    };
  }, []);

  return (
    <NodexToastProvider>
      <StorySurface>
        <div className="text-sm text-token-description-foreground">
          Global toast stack preview
        </div>
      </StorySurface>
    </NodexToastProvider>
  );
}

const meta = {
  title: "Workbench/Shared/UI",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const DropdownXsTrigger: Story = {
  render: () => <XsTriggerDropdownDemo />,
};

export const DropdownCompactIconLabelTrigger: Story = {
  render: () => <CompactIconLabelTriggerDemo />,
};

export const DropdownIconOnlyTrigger: Story = {
  render: () => <IconOnlyDropdownDemo />,
};

export const DropdownPanelActionIcons: Story = {
  render: () => <PanelActionIconDropdownDemo />,
};

export const DropdownLongLabelTrigger: Story = {
  render: () => <LongLabelDropdownDemo />,
};

export const DropdownSearchable: Story = {
  render: () => <SearchableDropdownDemo />,
};

export const DropdownFlyoutSubmenu: Story = {
  render: () => <FlyoutSubmenuDropdownDemo />,
};

export const TooltipCompactControls: Story = {
  render: () => <CompactTooltipDemo />,
};

export const PopoverCompactSurface: Story = {
  render: () => <PopoverDemo />,
};

export const DialogSurface: Story = {
  render: () => <DialogDemo />,
};

export const SettingsPrimitives: Story = {
  render: () => <SettingsDemo />,
};

export const ToastGlobalStack: Story = {
  render: () => <ToastDemo />,
};
