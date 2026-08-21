import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { CalendarRangeState } from "@/lib/calendar-range";
import { CalendarToolbarControls, CalendarToolbarMonthLabel } from "./calendar-toolbar";

const meta = {
  title: "Board/Calendar/Toolbar",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function ToolbarHarness({
  initialRange,
  narrow = false,
}: {
  initialRange: CalendarRangeState;
  narrow?: boolean;
}) {
  const [range, setRange] = useState(initialRange);
  const today = new Date(2026, 1, 14);
  const visibleDays = Array.from(
    { length: range.mode === "multi-week" ? range.multiWeekCount * 7 : 4 },
    (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      return date;
    },
  );

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-4 text-token-foreground">
      <div className={narrow ? "w-[360px]" : "w-full"}>
        <div className="flex items-center gap-2">
          <CalendarToolbarMonthLabel visibleDays={visibleDays} />
          <CalendarToolbarControls
            range={range}
            onRangeChange={setRange}
            onCreate={() => undefined}
            onToday={() => undefined}
            onPrev={() => undefined}
            onNext={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <ToolbarHarness initialRange={{ mode: "multi-day", multiDayCount: 4, multiWeekCount: 2 }} />
  ),
};

export const MultiWeek: Story = {
  render: () => (
    <ToolbarHarness initialRange={{ mode: "multi-week", multiDayCount: 4, multiWeekCount: 2 }} />
  ),
};

export const Narrow: Story = {
  render: () => (
    <ToolbarHarness
      initialRange={{ mode: "multi-day", multiDayCount: 4, multiWeekCount: 2 }}
      narrow
    />
  ),
};
