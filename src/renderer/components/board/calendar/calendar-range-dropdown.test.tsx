import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act, useState } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import type { CalendarRangeState } from "@/lib/calendar-range";
import { CalendarRangeDropdown } from "./calendar-range-dropdown";

function CalendarRangeDropdownHarness({
  initialRange,
}: {
  initialRange: CalendarRangeState;
}) {
  const [range, setRange] = useState(initialRange);
  return <CalendarRangeDropdown range={range} onRangeChange={setRange} />;
}

async function openRangeMenu(view: ReturnType<typeof render>) {
  const trigger = view.getByLabelText("Calendar range");
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await settleAsyncRender();
  });
}

describe("CalendarRangeDropdown", () => {
  test("selects simple range modes", async () => {
    const view = render(
      <CalendarRangeDropdownHarness
        initialRange={{ mode: "multi-day", multiDayCount: 4, multiWeekCount: 2 }}
      />,
    );

    await openRangeMenu(view);

    await act(async () => {
      fireEvent.click(view.getByText("Week"));
      await settleAsyncRender();
    });

    expect(view.getByLabelText("Calendar range").textContent?.includes("Week") ?? false).toBe(true);
  });

  test("keeps the menu open while incrementing a custom range", async () => {
    const view = render(
      <CalendarRangeDropdownHarness
        initialRange={{ mode: "multi-day", multiDayCount: 4, multiWeekCount: 2 }}
      />,
    );

    await openRangeMenu(view);

    await act(async () => {
      fireEvent.click(view.getByLabelText("Increase Multi-Day"));
      await settleAsyncRender();
    });

    expect(view.getByLabelText("Calendar range").textContent?.includes("5 Days") ?? false).toBe(true);
    expect(view.container.ownerDocument.body.textContent?.includes("Multi-Day") ?? false).toBe(true);
  });

  test("selects an inactive custom mode when its stepper changes", async () => {
    const view = render(
      <CalendarRangeDropdownHarness
        initialRange={{ mode: "week", multiDayCount: 4, multiWeekCount: 2 }}
      />,
    );

    await openRangeMenu(view);

    await act(async () => {
      fireEvent.click(view.getByLabelText("Increase Multi-Week"));
      await settleAsyncRender();
    });

    expect(view.getByLabelText("Calendar range").textContent?.includes("3 Weeks") ?? false).toBe(true);
  });

  test("supports keyboard adjustment from the custom row", async () => {
    const view = render(
      <CalendarRangeDropdownHarness
        initialRange={{ mode: "multi-day", multiDayCount: 4, multiWeekCount: 2 }}
      />,
    );

    await openRangeMenu(view);

    const row = view.getByText("Multi-Day").closest("[role='menuitem']");
    expect(row === null).toBe(false);

    await act(async () => {
      fireEvent.keyDown(row!, { key: "ArrowRight" });
      await settleAsyncRender();
    });

    expect(view.getByLabelText("Calendar range").textContent?.includes("5 Days") ?? false).toBe(true);
  });
});
