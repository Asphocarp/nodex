import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComputerUseSettingsView } from "./computer-use-settings-page";

const meta = {
  args: {
    pending: null,
    snapshot: {
      alwaysHidePictureInPicture: false,
      approvedApps: [
        { bundleIdentifier: "com.apple.Safari", displayName: "Safari" },
        { bundleIdentifier: "com.microsoft.Excel", displayName: "Microsoft Excel" },
      ],
      approvedMessageThreads: [
        { chatGuid: "iMessage;-;+15555550123", displayName: "Design team" },
      ],
      available: true,
      lockedUseAllowed: true,
      lockedUseEnabled: false,
      message: null,
      soundMode: "foregroundClicks",
    },
    onRemoveAppApproval: () => undefined,
    onRemoveMessageApproval: () => undefined,
    onSetAlwaysHidePictureInPicture: () => undefined,
    onSetLockedUseEnabled: () => undefined,
    onSetSoundMode: () => undefined,
  },
  component: ComputerUseSettingsView,
  decorators: [
    (Story) => (
      <div className="h-[760px] w-[760px] overflow-hidden bg-token-main-surface-primary">
        <Story />
      </div>
    ),
  ],
  title: "Workbench/Settings/Computer use",
} satisfies Meta<typeof ComputerUseSettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const Unavailable: Story = {
  args: {
    snapshot: {
      alwaysHidePictureInPicture: false,
      approvedApps: [],
      approvedMessageThreads: [],
      available: false,
      lockedUseAllowed: false,
      lockedUseEnabled: null,
      message: "Computer Use is unavailable for this architecture",
      soundMode: "foregroundClicks",
    },
  },
};
