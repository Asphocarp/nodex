import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { Priority } from "@/lib/types";
import { PageStageInlinePropertyStrip } from "./inline-property-strip";

function InlinePropertyStripStory() {
  const [priority, setPriority] = useState<Priority | null>("p1-high");
  const [estimate, setEstimate] = useState("m");
  const [dueDate, setDueDate] = useState("2026-04-01");
  const [column, setColumn] = useState({ id: "in-progress", name: "Build" });

  return (
    <div className="min-h-screen bg-(--background) p-8">
      <div className="mx-auto max-w-4xl rounded-[20px] border border-(--border) bg-(--page) p-5">
        <PageStageInlinePropertyStrip
          priority={priority ?? undefined}
          estimate={estimate}
          dueDate={dueDate}
          currentColumnId={column.id}
          currentColumnName={column.name}
          onPriorityChange={setPriority}
          onEstimateChange={setEstimate}
          onDueDateChange={setDueDate}
          onClearDueDate={() => setDueDate("")}
          onSetDueDateToday={() => setDueDate("2026-03-28")}
          onColumnChange={async (nextColumnId) => {
            const nextName = nextColumnId === "ship" ? "Ship" : nextColumnId === "review" ? "Review" : "Build";
            setColumn({ id: nextColumnId, name: nextName });
          }}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Kanban/Inline Property Strip",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <InlinePropertyStripStory />,
};
