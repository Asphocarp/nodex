import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexSwitch } from "./button";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSelectedIcon,
  NodexSettingsDropdownTrigger,
} from "./dropdown";
import {
  NodexCheckbox,
  NodexSettingsNumberInput,
  NodexSettingsPageSurface,
  NodexSettingsRow,
  NodexSettingsSection,
} from "./settings";

const meta = {
  title: "UI/Settings",
  component: NodexSettingsPageSurface,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Shared Codex-style settings page, section, and row primitives used by every Nodex settings route.",
      },
    },
  },
} satisfies Meta<typeof NodexSettingsPageSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

const NOTIFICATION_OPTIONS = [
  { value: "off", label: "Never" },
  { value: "unfocused", label: "Only when unfocused" },
  { value: "always", label: "Always" },
] as const;

function SettingsDropdownDemo() {
  const [value, setValue] = useState("unfocused");
  const selectedLabel =
    NOTIFICATION_OPTIONS.find((option) => option.value === value)?.label ?? value;

  return (
    <NodexDropdownMenu
      align="end"
      contentWidth="menuWide"
      triggerButton={
        <NodexSettingsDropdownTrigger aria-label="Turn completion notifications">
          <span className="truncate">{selectedLabel}</span>
        </NodexSettingsDropdownTrigger>
      }
    >
      {NOTIFICATION_OPTIONS.map((option) => (
        <NodexDropdownItem
          key={option.value}
          onSelect={() => setValue(option.value)}
          rightSlot={option.value === value ? <NodexDropdownSelectedIcon /> : null}
        >
          {option.label}
        </NodexDropdownItem>
      ))}
    </NodexDropdownMenu>
  );
}

export const DenseRows: Story = {
  args: {
    title: "General",
    children: null,
  },
  render: () => (
    <div className="h-screen w-full overflow-hidden bg-token-main-surface-primary">
      <NodexSettingsPageSurface
        title="General"
        subtitle="App-wide shell behavior and notifications."
      >
        <NodexSettingsSection title="Notifications">
          <NodexSettingsRow
            label="Turn completion notifications"
            description="Set when agent alerts you that it's finished."
          >
            <SettingsDropdownDemo />
          </NodexSettingsRow>
          <NodexSettingsRow
            label="Enable permission notifications"
            description="Show alerts when notification permissions are required."
          >
            <NodexSwitch
              ariaLabel="Enable permission notifications"
              checked
              onCheckedChange={() => {}}
            />
          </NodexSettingsRow>
          <NodexSettingsRow
            label="Enable question notifications"
            description="Show alerts when input is needed to continue."
          >
            <NodexSwitch
              ariaLabel="Enable question notifications"
              checked
              onCheckedChange={() => {}}
            />
          </NodexSettingsRow>
        </NodexSettingsSection>
        <NodexSettingsSection title="Diagnostics">
          <NodexSettingsRow
            label="Send diagnostics"
            description="Optional masked diagnostics remain visually subordinate to the primary setting label."
          >
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-sm hover:bg-token-list-hover-background"
            >
              Off
            </button>
          </NodexSettingsRow>
          <NodexSettingsRow
            label="Long explanatory copy"
            description="This row intentionally contains enough explanatory text to demonstrate that settings descriptions wrap within the centered content column instead of being truncated."
          >
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-sm hover:bg-token-list-hover-background"
            >
              Enabled
            </button>
          </NodexSettingsRow>
        </NodexSettingsSection>
      </NodexSettingsPageSurface>
    </div>
  ),
};

function CodexControlsDemo() {
  const [safetyBackup, setSafetyBackup] = useState(true);
  const [platformSpecific, setPlatformSpecific] = useState(false);

  return (
    <div className="h-screen w-full overflow-hidden bg-token-main-surface-primary">
      <NodexSettingsPageSurface
        title="General"
        subtitle="Compact controls for bounded values and binary preferences."
      >
        <NodexSettingsSection title="Controls">
          <NodexSettingsRow
            label="Sans font size"
            description="Adjust the base size used by the Nodex interface."
          >
            <div className="flex items-center gap-2.5">
              <NodexSettingsNumberInput
                aria-label="Sans font size"
                className="w-16"
                defaultValue={15}
                min={11}
                max={20}
                step={1}
              />
              <span className="text-sm text-token-text-secondary">px</span>
            </div>
          </NodexSettingsRow>
          <NodexSettingsRow
            label="Safety backup"
            description="Create a fresh snapshot before restoring an older one."
          >
            <NodexSwitch
              ariaLabel="Safety backup"
              checked={safetyBackup}
              onCheckedChange={setSafetyBackup}
            />
          </NodexSettingsRow>
          <NodexSettingsRow
            label="Platform specific"
            description="Run this action only on the selected operating system."
          >
            <NodexCheckbox
              ariaLabel="Platform specific"
              checked={platformSpecific}
              onCheckedChange={setPlatformSpecific}
            />
          </NodexSettingsRow>
        </NodexSettingsSection>
      </NodexSettingsPageSurface>
    </div>
  );
}

export const CodexControls: Story = {
  args: {
    title: "General",
    children: null,
  },
  render: () => <CodexControlsDemo />,
};

function CheckboxStatesDemo() {
  const [firstChecked, setFirstChecked] = useState(false);
  const [secondChecked, setSecondChecked] = useState(true);

  return (
    <div className="flex min-h-screen items-start bg-token-main-surface-primary p-8">
      <div className="flex w-72 flex-col gap-3 text-sm text-token-text-primary">
        <div className="flex items-center gap-2">
          <NodexCheckbox
            ariaLabel="First checkbox example"
            checked={firstChecked}
            onCheckedChange={setFirstChecked}
          />
          {firstChecked ? "Checked" : "Unchecked"}
        </div>
        <div className="flex items-center gap-2">
          <NodexCheckbox
            ariaLabel="Second checkbox example"
            checked={secondChecked}
            onCheckedChange={setSecondChecked}
          />
          {secondChecked ? "Checked" : "Unchecked"}
        </div>
      </div>
    </div>
  );
}

export const CheckboxStates: Story = {
  args: {
    title: "Checkbox states",
    children: null,
  },
  render: () => <CheckboxStatesDemo />,
};
