import { act, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { formatLocalDateAsIso } from "@/lib/data-source-property-date";
import { render } from "@/test/dom";
import { NodexDateCalendar } from "./date-calendar";

describe("NodexDateCalendar", () => {
  test("routes header and day choices through the calendar ports", async () => {
    const onSelect = vi.fn();
    const onToday = vi.fn();
    const view = render(
      <NodexDateCalendar
        selected={new Date(2026, 7, 21)}
        month={new Date(2026, 7, 1)}
        onMonthChange={vi.fn()}
        onSelect={onSelect}
        onToday={onToday}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Today" }));
      fireEvent.click(view.getByRole("button", { name: /Saturday, August 22/ }));
      await Promise.resolve();
    });

    expect(onToday).toHaveBeenCalledOnce();
    expect(formatLocalDateAsIso(onSelect.mock.calls[0]?.[0] as Date)).toBe("2026-08-22");
  });
});
