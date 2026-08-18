import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppUpdateRestartNotice } from "./app-update-restart-notice";

const meta = {
  component: AppUpdateRestartNotice,
  parameters: { layout: "centered" },
  args: {
    onDismiss: () => undefined,
    onRestart: () => undefined,
    status: {
      availableVersion: "0.2.2",
      checkedAt: "2026-08-02T00:00:00.000Z",
      currentVersion: "0.2.1",
      message: "Update ready. Restart Nodex to install it.",
      progressPercent: 100,
      releaseDate: "2026-08-02T00:00:00.000Z",
      releaseName: "Nodex 0.2.2",
      releaseNotes: "Performance and reliability improvements.",
      status: "downloaded",
      supported: true,
      totalBytes: 512_000_000,
      transferredBytes: 512_000_000,
      channel: "stable",
      buildDefaultChannel: "stable",
      channelChangeAllowed: false,
    },
  },
} satisfies Meta<typeof AppUpdateRestartNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToInstall: Story = {};
