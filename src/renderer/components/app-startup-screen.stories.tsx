import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppStartupScreen } from "./app-startup-screen";

const meta = {
  title: "App/StartupScreen",
  component: AppStartupScreen,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppStartupScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Opening: Story = {
  args: { step: { phase: "opening" } },
};

export const Migrating: Story = {
  args: {
    step: {
      phase: "migrating",
      fromVersion: 86,
      toVersion: 88,
      completed: 13_409,
      total: 20_000,
    },
  },
};

export const OpeningWorkspace: Story = {
  args: { step: { phase: "opening_workspace" } },
};

export const Failed: Story = {
  args: { step: { phase: "failed" } },
};
