import type { Meta, StoryObj } from "@storybook/react-vite";
import { createCommandKeymapState } from "../../../shared/command-keybindings";
import { KeyboardShortcutHelpDialog } from "./keyboard-shortcut-help-dialog";

const meta = {
  title: "Workbench/Keyboard shortcut help",
  component: KeyboardShortcutHelpDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    onCustomize: () => undefined,
    commandKeymapState: createCommandKeymapState({}, "macOS"),
  },
} satisfies Meta<typeof KeyboardShortcutHelpDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
