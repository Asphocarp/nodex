import type { Meta, StoryObj } from "@storybook/react-vite";

import { CoreAuthorityStatusNotice } from "./core-authority-status";

const meta = {
  args: {
    onRelaunch: () => undefined,
    onRetry: () => undefined,
    status: { attempt: 1, kind: "recovering" },
  },
  component: CoreAuthorityStatusNotice,
  decorators: [
    (Story) => (
      <div className="h-screen bg-token-main-surface-primary text-token-foreground">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "fullscreen" },
  title: "App/Core authority status",
} satisfies Meta<typeof CoreAuthorityStatusNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Recovering: Story = {};

export const Unavailable: Story = {
  args: {
    status: {
      circuitOpen: true,
      kind: "unavailable",
      message: "Automatic recovery was paused after repeated failures.",
    },
  },
};
