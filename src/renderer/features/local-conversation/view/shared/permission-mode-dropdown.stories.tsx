import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { PermissionModeDropdown } from "./permission-mode-dropdown";

const meta = {
  title: "Local Conversation/Permission Mode Dropdown",
  component: PermissionModeDropdown,
  args: {
    selectedMode: "full-access",
    availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
    autoReviewAvailable: true,
    onSelect: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="flex h-[360px] w-[620px] items-end bg-token-main-surface-primary p-8">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof PermissionModeDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const SettingsTrigger: Story = {
  args: {
    triggerStyle: "settings",
  },
};

export const FullAccessMenuOpen: Story = {
  play: async ({ canvasElement }) => {
    const trigger = getByRole(canvasElement, "button", { name: "Change permissions" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() => getByRole(document.body, "menuitem", { name: /Full access/ }));
  },
};

export const CustomMenuOpen: Story = {
  args: {
    selectedMode: "custom",
  },
  play: FullAccessMenuOpen.play,
};

export const FullAccessConfirmation: Story = {
  args: {
    selectedMode: "auto",
  },
  play: async ({ canvasElement }) => {
    const trigger = getByRole(canvasElement, "button", { name: "Change permissions" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const fullAccess = await waitFor(() =>
      getByRole(document.body, "menuitem", { name: /Full access/ }),
    );
    fireEvent.click(fullAccess);
    await waitFor(() => getByRole(document.body, "dialog", { name: "Turn on Full Access?" }));
  },
};
