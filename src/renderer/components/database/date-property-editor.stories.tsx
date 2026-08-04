import type { Meta, StoryObj } from "@storybook/react-vite";
import { DatePropertyEditor } from "./date-property-editor";

const meta = {
  title: "Database/Date Property Editor",
  component: DatePropertyEditor,
  args: {
    label: "Due date",
    mode: "date",
    value: "2026-08-19",
    revision: 2,
    disabled: false,
    presentation: "page",
    onChange: () => undefined,
  },
} satisfies Meta<typeof DatePropertyEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DueDate: Story = {};
export const Empty: Story = { args: { value: null } };
export const DateTime: Story = {
  args: {
    label: "Scheduled start",
    mode: "datetime",
    value: "2026-08-19T05:30:00.000Z",
  },
};
export const Busy: Story = { args: { disabled: true } };
