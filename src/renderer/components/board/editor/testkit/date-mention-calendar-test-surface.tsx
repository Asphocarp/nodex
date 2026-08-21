import type { DateMentionCalendarProps } from "../date-mention-calendar";

/**
 * Keeps DateMentionInlineContentView tests on the calendar boundary. The real
 * DayPicker surface owns date selection behavior in its focused tests.
 */
export function DateMentionCalendarTestSurface({
  hasEndDate,
}: DateMentionCalendarProps) {
  return (
    <div
      aria-label="Date mention calendar"
      data-selection-mode={hasEndDate ? "range" : "single"}
    />
  );
}
