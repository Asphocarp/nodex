import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppUpdateSettingsControlView } from "./app-update-settings-control";

const meta = {
  component: AppUpdateSettingsControlView,
  parameters: { layout: "centered" },
  args: {
    busy: false,
    error: null,
    onAutomaticChecksChange: () => undefined,
    onChannelChange: () => undefined,
    onCheckNow: () => undefined,
    onInstall: () => undefined,
    settings: { automaticChecksEnabled: true, channel: "stable" },
    status: {
      availableVersion: null,
      buildDefaultChannel: "stable",
      channel: "stable",
      channelChangeAllowed: true,
      checkedAt: "2026-08-18T04:00:00.000Z",
      currentVersion: "0.2.2",
      message: "You’re up to date.",
      progressPercent: null,
      releaseDate: null,
      releaseName: null,
      releaseNotes: null,
      status: "upToDate",
      supported: true,
      totalBytes: null,
      transferredBytes: null,
    },
  },
} satisfies Meta<typeof AppUpdateSettingsControlView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Stable: Story = {};

export const NightlyChecking: Story = {
  args: {
    busy: true,
    settings: { automaticChecksEnabled: true, channel: "nightly" },
    status: {
      ...meta.args.status,
      buildDefaultChannel: "nightly",
      channel: "nightly",
      channelChangeAllowed: false,
      currentVersion: "0.2.3-nightly.20260818.842",
      message: "Checking for updates…",
      status: "checking",
    },
  },
};
