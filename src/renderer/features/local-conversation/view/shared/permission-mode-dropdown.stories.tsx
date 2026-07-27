import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { PermissionModeDropdown } from "./permission-mode-dropdown";

const meta = {
  title: "Local Conversation/Permission Mode Dropdown",
  component: PermissionModeDropdown,
  args: {
    selectedMode: "full-access",
    customDescription: null,
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

export const FullAccessMenuOpen: Story = {
  play: async ({ canvasElement }) => {
    const trigger = getByRole(canvasElement, "button", { name: "Permission mode" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() => getByRole(document.body, "menuitem", { name: /Full access/ }));
  },
};
