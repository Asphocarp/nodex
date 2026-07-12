import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { DropIndicator } from "./drop-indicator";

const meta = {
  title: "Kanban/Cross-surface Drag",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CopyAndReferenceCues: Story = {
  render: () => (
    <div className="grid w-[560px] gap-8 rounded-xl bg-(--background) p-8 text-(--foreground)">
      <section>
        <p className="mb-3 text-xs text-(--foreground-secondary)">
          Card → editor · link
        </p>
        <div className="relative rounded-lg border border-(--border) bg-(--card) px-4 py-5">
          <p className="text-sm">Existing document Block</p>
          <div className="absolute inset-x-4 bottom-2 h-0.5 rounded-full bg-(--accent-blue)" />
        </div>
      </section>
      <section style={{ "--column-accent": "#4f7cac" } as CSSProperties}>
        <p className="mb-3 text-xs text-(--foreground-secondary)">
          Editor Block → Kanban · copy
        </p>
        <div className="relative h-16 rounded-lg bg-(--background-secondary) px-3 pt-4">
          <DropIndicator
            className="absolute inset-x-3 top-4"
            label="Copy as Card"
          />
        </div>
      </section>
    </div>
  ),
};
