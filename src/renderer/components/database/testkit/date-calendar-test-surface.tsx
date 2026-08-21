import type { ComponentProps } from "react";
import type { NodexDateCalendar } from "@/components/ui/date-calendar";

/**
 * A calendar adapter for DatePropertyEditor behavior tests.
 *
 * The real react-day-picker surface owns calendar rendering and selection. The
 * editor tests only need its semantic Today/select ports, so importing the full
 * calendar would make every isolated test fork pay for an unrelated UI tree.
 */
export function DateCalendarTestSurface({
  onToday,
  onSelect,
  disabled = false,
}: ComponentProps<typeof NodexDateCalendar>) {
  return (
    <div data-testid="date-calendar-test-surface">
      <button type="button" disabled={disabled} onClick={onToday}>
        Today
      </button>
      <button type="button" disabled={disabled} onClick={() => onSelect(new Date(2026, 7, 21))}>
        Select Aug 21
      </button>
    </div>
  );
}
