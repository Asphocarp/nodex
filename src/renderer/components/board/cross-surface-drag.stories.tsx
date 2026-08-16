import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { DropIndicator } from "./drop-indicator";

const meta = {
  title: "Board/Cross-surface Drag",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const MoveAndOptionCopyCues: Story = {
  render: () => (
    <div className="grid w-[560px] gap-8 rounded-xl bg-(--background) p-8 text-(--foreground)">
      <section>
        <p className="mb-3 text-xs text-(--foreground-secondary)">
          Card → editor · move (Option copies)
        </p>
        <div className="relative rounded-lg border border-(--border) bg-(--card) px-4 py-5">
          <p className="text-sm">Existing document Block</p>
          <div className="prosemirror-dropcursor-block prosemirror-dropcursor-block-horizontal pointer-events-none absolute inset-x-4 bottom-2 z-50" />
        </div>
      </section>
      <section style={{ "--column-accent": "#4f7cac" } as CSSProperties}>
        <p className="mb-3 text-xs text-(--foreground-secondary)">
          Editor Block → Board · move (Option copies)
        </p>
        <div className="relative h-16 rounded-lg bg-(--background-secondary) px-3 pt-4">
          <DropIndicator
            className="absolute inset-x-3 top-4"
            label="Move to Database"
          />
        </div>
      </section>
    </div>
  ),
};

export const TaskShorthandPromotionCues: Story = {
  render: () => {
    const cues = [
      ["Single parsed", "Move as Page · P1 · XL · 2 tags"],
      ["Batch mixed", "Move 3 as Pages · 2 shorthand"],
      ["Shift override", "Move as Page · Literal"],
      ["Target conflict", "Move as Page · shorthand kept"],
    ] as const;
    return (
      <div
        className="grid w-[520px] gap-5 bg-(--background) p-8 text-(--foreground)"
        style={{ "--column-accent": "#4f7cac" } as CSSProperties}
      >
        <div>
          <h2 className="text-sm font-medium">Block → Page drag feedback</h2>
          <p className="mt-1 text-xs text-(--foreground-secondary)">
            Local preview only; Core decides the committed result.
          </p>
        </div>
        {cues.map(([name, label]) => (
          <section key={name} className="grid grid-cols-[112px_1fr] items-center gap-4">
            <p className="text-xs text-(--foreground-secondary)">{name}</p>
            <div className="relative h-9 bg-(--background-secondary) px-3 pt-3">
              <DropIndicator className="absolute inset-x-3 top-3" label={label} />
            </div>
          </section>
        ))}
      </div>
    );
  },
};
