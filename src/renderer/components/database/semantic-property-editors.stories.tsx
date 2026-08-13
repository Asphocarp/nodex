import type { Meta, StoryObj } from "@storybook/react-vite";
import { SemanticSelectPropertyEditor } from "./semantic-property-editors";

const statusOptions = [
  { id: "triage", name: "Triage" },
  { id: "plan", name: "Plan" },
  { id: "build", name: "Build" },
  { id: "review", name: "Review" },
  { id: "ship", name: "Ship" },
] as const;

const meta = {
  title: "Database/Semantic Property Editors",
  component: SemanticSelectPropertyEditor,
  args: {
    kind: "status",
    label: "Status",
    options: statusOptions,
    selectedId: "build",
    disabled: false,
    presentation: "page",
    onChange: () => undefined,
  },
} satisfies Meta<typeof SemanticSelectPropertyEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {};
export const RenamedStatus: Story = {
  args: {
    label: "Workflow",
    options: statusOptions.map((option) => option.id === "build"
      ? { ...option, name: "In progress" }
      : option),
  },
};
export const Priority: Story = {
  args: {
    kind: "priority",
    label: "Priority",
    options: [
      { id: "p0-critical", name: "Urgent" },
      { id: "p1-high", name: "High" },
      { id: "p2-medium", name: "Medium" },
      { id: "p3-low", name: "Low" },
    ],
    selectedId: "p1-high",
  },
};
export const Estimate: Story = {
  args: {
    kind: "estimate",
    label: "Estimate",
    options: ["xs", "s", "m", "l", "xl"].map((id) => ({ id, name: id.toUpperCase() })),
    selectedId: "m",
  },
};
