import { DayPicker, type DateRange } from "react-day-picker";
import { NODEX_DAY_PICKER_CLASS_NAMES } from "@/components/ui/date-calendar";

export function DateMentionCalendar({
  hasEndDate,
  selectedRange,
  selectedDate,
  month,
  onMonthChange,
  onSelectDate,
  onSelectRange,
}: {
  readonly hasEndDate: boolean;
  readonly selectedRange: DateRange;
  readonly selectedDate: Date;
  readonly month: Date;
  readonly onMonthChange: (month: Date) => void;
  readonly onSelectDate: (date: Date | undefined) => void;
  readonly onSelectRange: (range: DateRange | undefined) => void;
}) {
  if (hasEndDate) {
    return (
      <DayPicker
        mode="range"
        selected={selectedRange}
        month={month}
        onMonthChange={onMonthChange}
        onSelect={onSelectRange}
        showOutsideDays
        fixedWeeks
        hideNavigation
        classNames={NODEX_DAY_PICKER_CLASS_NAMES}
      />
    );
  }

  return (
    <DayPicker
      mode="single"
      selected={selectedDate}
      month={month}
      onMonthChange={onMonthChange}
      onSelect={onSelectDate}
      showOutsideDays
      fixedWeeks
      hideNavigation
      classNames={NODEX_DAY_PICKER_CLASS_NAMES}
    />
  );
}
