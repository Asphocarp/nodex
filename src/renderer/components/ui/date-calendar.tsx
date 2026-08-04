import { DayFlag, DayPicker, SelectionState, UI } from "react-day-picker";
import { ChevronRightIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";

export const NODEX_DAY_PICKER_CLASS_NAMES = {
  [UI.Root]: "notion-date-property-menu notranslate w-full select-none px-2 pb-2",
  [UI.Months]: "flex w-full flex-col",
  [UI.Month]: "w-full",
  [UI.MonthCaption]: "sr-only",
  [UI.CaptionLabel]: "sr-only",
  [UI.MonthGrid]: "w-full table-fixed border-separate border-spacing-0",
  [UI.Weekdays]: "grid grid-cols-7",
  [UI.Weekday]: "flex h-6 items-center justify-center text-[11px] font-normal text-token-description-foreground",
  [UI.Weeks]: "block",
  [UI.Week]: "grid grid-cols-7",
  [UI.Day]: "rdp-day flex size-8 items-center justify-center p-0 text-center text-sm leading-none",
  [UI.DayButton]: cn(
    "flex size-7 items-center justify-center rounded-md text-sm leading-none outline-hidden",
    "hover:bg-token-list-hover-background focus-visible:ring-token-focus focus-visible:ring-2",
  ),
  [DayFlag.outside]: "rdp-day_outside [&>button]:text-token-description-foreground/55",
  [DayFlag.today]: "rdp-day_today [&>button]:font-medium [&>button]:ring-[0.5px] [&>button]:ring-token-border",
  [DayFlag.focused]: "rdp-day_focused",
  [SelectionState.selected]: "rdp-day_selected [&>button]:bg-token-charts-blue [&>button]:text-white [&>button]:ring-0",
  [SelectionState.range_start]: "rdp-day_start [&>button]:bg-token-charts-blue [&>button]:text-white [&>button]:ring-0",
  [SelectionState.range_middle]: "rdp-day_range_middle [&>button]:bg-token-charts-blue/10 [&>button]:text-token-charts-blue [&>button]:ring-0",
  [SelectionState.range_end]: "rdp-day_end [&>button]:bg-token-charts-blue [&>button]:text-white [&>button]:ring-0",
} as const;

export const addCalendarMonth = (month: Date, delta: number): Date =>
  new Date(month.getFullYear(), month.getMonth() + delta, 1);

export function NodexDateCalendarHeader({
  month,
  onMonthChange,
  onToday,
  disabled = false,
}: {
  readonly month: Date;
  readonly onMonthChange: (month: Date) => void;
  readonly onToday: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="flex h-9 items-center gap-1 px-2">
      <button
        type="button"
        disabled={disabled}
        className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-sm text-token-foreground hover:bg-token-list-hover-background focus-visible:ring-2 focus-visible:ring-token-focus focus-visible:outline-hidden"
        onClick={onToday}
      >
        Today
      </button>
      <div className="min-w-0 flex-1 text-center text-sm font-medium text-token-foreground">
        {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month)}
      </div>
      <button
        type="button"
        aria-label="Previous month"
        disabled={disabled}
        className="flex size-7 items-center justify-center rounded-md text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-2 focus-visible:ring-token-focus focus-visible:outline-hidden"
        onClick={() => onMonthChange(addCalendarMonth(month, -1))}
      >
        <ChevronRightIcon className="icon-2xs rotate-180" />
      </button>
      <button
        type="button"
        aria-label="Next month"
        disabled={disabled}
        className="flex size-7 items-center justify-center rounded-md text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-2 focus-visible:ring-token-focus focus-visible:outline-hidden"
        onClick={() => onMonthChange(addCalendarMonth(month, 1))}
      >
        <ChevronRightIcon className="icon-2xs" />
      </button>
    </div>
  );
}

export function NodexDateCalendar({
  selected,
  month,
  onMonthChange,
  onSelect,
  onToday,
  disabled = false,
}: {
  readonly selected?: Date;
  readonly month: Date;
  readonly onMonthChange: (month: Date) => void;
  readonly onSelect: (date: Date | undefined) => void;
  readonly onToday: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <>
      <NodexDateCalendarHeader
        month={month}
        onMonthChange={onMonthChange}
        onToday={onToday}
        disabled={disabled}
      />
      <DayPicker
        mode="single"
        selected={selected}
        month={month}
        onMonthChange={onMonthChange}
        onSelect={onSelect}
        disabled={disabled}
        showOutsideDays
        fixedWeeks
        hideNavigation
        classNames={NODEX_DAY_PICKER_CLASS_NAMES}
      />
    </>
  );
}
