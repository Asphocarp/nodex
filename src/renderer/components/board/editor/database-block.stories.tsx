import type { Meta, StoryObj } from "@storybook/react-vite";

import { DatabaseBlockSurface } from "./database-block";

const meta = {
  title: "Editor/Database Block",
  component: DatabaseBlockSurface,
  decorators: [
    (Story) => (
      <div className="w-[520px] bg-token-main-surface-primary p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Product planning",
    onOpen: () => undefined,
  },
} satisfies Meta<typeof DatabaseBlockSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const Loading: Story = {
  args: { loading: true },
};

export const Readonly: Story = {
  args: { onOpen: undefined },
};
