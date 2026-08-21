import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import { formatLocalDateAsIso } from "@/lib/data-source-property-date";
import { render } from "@/test/dom";
import { DateMentionCalendar } from "./date-mention-calendar";

const AUGUST_21 = new Date(2026, 7, 21);
const AUGUST_24 = new Date(2026, 7, 24);

describe("DateMentionCalendar", () => {
  test("routes single and range choices to their distinct selection ports", async () => {
    const onSelectDate = vi.fn();
    const onSelectRange = vi.fn();
    const sharedProps = {
      selectedRange: { from: AUGUST_21, to: AUGUST_24 },
      selectedDate: AUGUST_21,
      month: new Date(2026, 7, 1),
      onMonthChange: vi.fn(),
      onSelectDate,
      onSelectRange,
    };
    const view = render(<DateMentionCalendar {...sharedProps} hasEndDate={false} />);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Saturday, August 22/ }));
      await Promise.resolve();
    });
    expect(formatLocalDateAsIso(onSelectDate.mock.calls[0]?.[0] as Date)).toBe("2026-08-22");
    expect(onSelectRange).not.toHaveBeenCalled();

    view.rerender(<DateMentionCalendar {...sharedProps} hasEndDate />);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Tuesday, August 25/ }));
      await Promise.resolve();
    });

    expect(onSelectRange).toHaveBeenCalledWith(
      expect.objectContaining({
        from: AUGUST_21,
        to: new Date(2026, 7, 25),
      }),
      expect.any(Date),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
