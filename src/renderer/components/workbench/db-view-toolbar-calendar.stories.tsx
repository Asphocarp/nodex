import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarDays, Shapes, SquareKanban, Table2 } from "lucide-react";
import {
  CalendarToolbarControls,
  CalendarToolbarMonthLabel,
} from "@/components/kanban/calendar/calendar-toolbar";
import type { CalendarRangeState } from "@/lib/calendar-range";
import {
  normalizeCalendarAnchorDate,
  resolveCalendarVisibleDays,
  shiftCalendarAnchorDateByDays,
} from "@/lib/calendar-view-state";
import { DbViewToolbar, type DbViewToolbarItem } from "./db-view-toolbar";

const meta = {
  title: "Workbench/DB View Toolbar/Calendar",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const ITEMS: DbViewToolbarItem[] = [
  { id: "kanban", label: "Board", icon: SquareKanban, onSelect: () => undefined },
  { id: "list", label: "Table", icon: Table2, onSelect: () => undefined },
  { id: "calendar", label: "Calendar", icon: CalendarDays, active: true, onSelect: () => undefined },
];

function CalendarDbToolbarStory({ narrow = false }: { narrow?: boolean }) {
  const [range, setRange] = useState<CalendarRangeState>({
    mode: "multi-day",
    multiDayCount: 4,
    multiWeekCount: 2,
  });
  const [anchorDate, setAnchorDate] = useState(() => normalizeCalendarAnchorDate(new Date(2026, 1, 14)));
  const visibleDays = resolveCalendarVisibleDays({ range, anchorDate });
  const dayCount = visibleDays.length;

  return (
    <div className="min-h-screen bg-(--background) text-token-foreground">
      <div className={narrow ? "w-[520px]" : "w-full"}>
        <DbViewToolbar
          items={ITEMS}
          destinationItems={[{
            id: "primary-canvas",
            label: "Canvas",
            icon: Shapes,
            onSelect: () => undefined,
          }]}
          activeSearchQuery=""
          taskSearchOpen={false}
          showSearchControls={false}
          searchShortcutLabel="⌘F"
          taskSearchInputRef={{ current: null }}
          rulesView={null}
          dbViewPrefs={null}
          availableTags={[]}
          viewContextLabel={<CalendarToolbarMonthLabel visibleDays={visibleDays} />}
          calendarControls={(
            <CalendarToolbarControls
              range={range}
              onRangeChange={setRange}
              onCreate={() => undefined}
              onToday={() => setAnchorDate(normalizeCalendarAnchorDate(new Date(2026, 1, 14)))}
              onPrev={() => setAnchorDate((current) => shiftCalendarAnchorDateByDays(current, -dayCount))}
              onNext={() => setAnchorDate((current) => shiftCalendarAnchorDateByDays(current, dayCount))}
            />
          )}
          onUpdateDbViewPrefs={null}
          onSearchQueryChange={() => undefined}
          onOpenTaskSearch={() => undefined}
          onCloseTaskSearch={() => undefined}
        />
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => <CalendarDbToolbarStory />,
};

export const Narrow: Story = {
  render: () => <CalendarDbToolbarStory narrow />,
};
