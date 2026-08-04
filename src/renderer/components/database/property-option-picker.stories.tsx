import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, getByText, waitFor } from "@testing-library/dom";
import { PropertyOptionPicker } from "./property-option-picker";

const options = [
  { id: "research", name: "Research", color: "blue" },
  { id: "design", name: "Design", color: "purple" },
  { id: "blocked", name: "Blocked", color: "red" },
  { id: "ready", name: "Ready for review", color: "green" },
] as const;

const meta: Meta<typeof PropertyOptionPicker> = {
  title: "Database/Property Option Picker",
  component: PropertyOptionPicker,
  args: {
    label: "Tags",
    mode: "multiple",
    options,
    selectedIds: ["research", "design"],
    allowCreate: true,
    onSelectedIdsChange: () => undefined,
    onCreateOption: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="flex h-[420px] w-[420px] items-start bg-token-main-surface-primary p-10">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof PropertyOptionPicker>;

export const Selected: Story = {};
export const Empty: Story = { args: { selectedIds: [] } };
export const ManySelected: Story = {
  args: { selectedIds: options.map((option) => option.id) },
};
export const MissingIdentity: Story = {
  args: { selectedIds: ["research", "removed-option"] },
};
export const Disabled: Story = { args: { disabled: true } };
export const Pending: Story = { args: { pending: true } };
export const Loading: Story = { args: { options: [], loading: true } };
export const RegistryError: Story = {
  args: { registryError: true },
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Edit Tags" }));
    await waitFor(() => getByRole(document.body, "button", {
      name: "Couldn’t load options. Retry",
    }));
  },
};
export const CreationError: Story = {
  args: {
    selectedIds: [],
    onCreateOption: () => Promise.reject(new Error("Option mutation unavailable")),
  },
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Edit Tags" }));
    const search = await waitFor(() => getByRole(document.body, "combobox", {
      name: "Search Tags options",
    }));
    fireEvent.change(search, { target: { value: "Fresh" } });
    fireEvent.click(await waitFor(() => getByRole(document.body, "button", {
      name: "Create “Fresh”",
    })));
    await waitFor(() => getByText(document.body, "Couldn’t create option. Try again."));
  },
};
export const Paginated: Story = {
  args: { hasMore: true, onLoadMore: () => undefined },
};
export const Open: Story = {
  play: async ({ canvasElement }) => {
    fireEvent.click(getByRole(canvasElement, "button", { name: "Edit Tags" }));
    await waitFor(() => getByRole(document.body, "combobox", {
      name: "Search Tags options",
    }));
  },
};
