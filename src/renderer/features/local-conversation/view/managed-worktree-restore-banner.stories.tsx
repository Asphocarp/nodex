import type { Meta, StoryObj } from "@storybook/react-vite";
import { ManagedWorktreeRestoreBanner } from "./managed-worktree-restore-banner";

const meta = {
  title: "Local conversation/Managed worktree restore banner",
  component: ManagedWorktreeRestoreBanner,
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-[calc(100vw-32px)] bg-token-main-surface-primary px-toolbar py-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ManagedWorktreeRestoreBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Restorable: Story = {
  args: {
    availability: {
      state: "restorable",
      repositoryPath: "/Users/asc/repo/nodex",
      snapshotRef: "refs/codex/snapshots/9a3b",
    },
    onRestore: () => undefined,
  },
};

export const Restoring: Story = {
  args: {
    ...Restorable.args,
    restoring: true,
  },
};

export const MissingWorkingDirectory: Story = {
  args: { availability: { state: "gone" } },
};

export const InspectionUnavailable: Story = {
  args: {
    availability: {
      state: "unavailable",
      reason: "inspection-failed",
      message: "The execution host is offline",
    },
    onRetry: () => undefined,
  },
};
