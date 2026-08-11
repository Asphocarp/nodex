import type { Meta, StoryObj } from "@storybook/react-vite";
import { NfmEditorContextMenuPreview } from "./nfm-editor-context-menu";

const meta = {
  title: "Board/Editor/NFM Context Menu",
  component: NfmEditorContextMenuPreview,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof NfmEditorContextMenuPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    selectionEmpty: false,
    editable: true,
    onCommand: () => undefined,
  },
};

export const EmptySelection: Story = {
  args: {
    selectionEmpty: true,
    editable: true,
    onCommand: () => undefined,
  },
};
