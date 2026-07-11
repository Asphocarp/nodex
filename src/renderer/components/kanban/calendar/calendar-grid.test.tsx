import { afterEach, describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act, type ComponentProps } from "react";
import {
  installAsyncRequestAnimationFrame,
  installMeasuredResizeObserver,
} from "@/test/browser-globals";
import { render, settleAsyncRender } from "@/test/dom";
import { CalendarGrid } from "./calendar-grid";
import {
  forgetRetainedScrollPosition,
  rememberRetainedScrollPosition,
} from "@/lib/retained-scroll-position";

const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const elementClientWidthDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
const elementClientHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");

function restoreElementMetrics(): void {
  if (clientWidthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype as HTMLElement & { clientWidth?: number }, "clientWidth");
  }

  if (clientHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype as HTMLElement & { clientHeight?: number }, "clientHeight");
  }

  if (elementClientWidthDescriptor) {
    Object.defineProperty(Element.prototype, "clientWidth", elementClientWidthDescriptor);
  } else {
    Reflect.deleteProperty(Element.prototype as Element & { clientWidth?: number }, "clientWidth");
  }

  if (elementClientHeightDescriptor) {
    Object.defineProperty(Element.prototype, "clientHeight", elementClientHeightDescriptor);
  } else {
    Reflect.deleteProperty(Element.prototype as Element & { clientHeight?: number }, "clientHeight");
  }
}

function installCalendarGridMetrics(): void {
  installAsyncRequestAnimationFrame();
  installMeasuredResizeObserver({ blockSize: 640, inlineSize: 760 });

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 760;
    },
  });
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 760;
    },
  });

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 640;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 640;
    },
  });
}

function buildVisibleDays(): Date[] {
  const start = new Date(2026, 3, 20);
  return Array.from({ length: 4 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function renderCalendarGrid(
  props: Partial<ComponentProps<typeof CalendarGrid>> = {},
) {
  const noop = () => undefined;

  return render(
    <CalendarGrid
      visibleDays={buildVisibleDays()}
      createRequestId={0}
      scheduledCards={[]}
      cardStageCardId={undefined}
      onClickCard={noop}
      onCreateCard={noop}
      onCompleteOccurrence={noop}
      onSkipOccurrence={noop}
      onUpdateCardSchedule={noop}
      onNavigatePrev={noop}
      onNavigateNext={noop}
      allDayLaneHeight={72}
      onAllDayLaneHeightChange={noop}
      {...props}
    />,
  );
}

function dispatchShiftWheel(target: Element, deltaY = 1000): boolean {
  const event = new Event("wheel", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    shiftKey: { value: true },
    ctrlKey: { value: false },
    metaKey: { value: false },
    deltaX: { value: 0 },
    deltaY: { value: deltaY },
    deltaMode: { value: 0 },
  });

  return fireEvent(
    target,
    event,
  );
}

afterEach(() => {
  restoreElementMetrics();
});

describe("CalendarGrid retained scroll", () => {
  test("restores saved scroll instead of applying the default 8am position", async () => {
    installCalendarGridMetrics();
    const key = "test:calendar-grid:saved-scroll";
    forgetRetainedScrollPosition(key);
    const source = document.createElement("div");
    source.scrollTop = 777;
    rememberRetainedScrollPosition(key, source);

    const view = renderCalendarGrid({ scrollStateKey: key });
    const scroller = view.getByTestId("calendar-grid-scroll");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });

    await settleAsyncRender();
    await settleAsyncRender();

    expect(scroller.scrollTop).toBe(777);
  });

  test("keeps the default initial timeline position when no saved scroll exists", async () => {
    installCalendarGridMetrics();
    const key = "test:calendar-grid:default-scroll";
    forgetRetainedScrollPosition(key);

    const view = renderCalendarGrid({ scrollStateKey: key });
    const scroller = view.getByTestId("calendar-grid-scroll");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });

    await settleAsyncRender();

    expect(scroller.scrollTop === 0).toBe(false);
  });
});

describe("CalendarGrid Shift+Wheel navigation", () => {
  test("does not change the anchor date immediately on wheel input", async () => {
    installCalendarGridMetrics();
    let nextCount = 0;
    const view = renderCalendarGrid({
      onNavigateNext: () => {
        nextCount += 1;
      },
    });
    await settleAsyncRender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 16));
    });
    const slide = view.getByTestId("calendar-day-columns-slide");
    const beforeTransform = slide.getAttribute("style") ?? "";
    await act(async () => {
      dispatchShiftWheel(view.getByTestId("calendar-grid-scroll"), 100);
      await new Promise((resolve) => setTimeout(resolve, 16));
    });
    const afterTransform = slide.getAttribute("style") ?? "";
    expect(afterTransform === beforeTransform).toBe(false);

    expect(nextCount).toBe(0);
  });

  test("settles a wheel burst by accumulated distance", async () => {
    installCalendarGridMetrics();
    let nextCount = 0;
    const view = renderCalendarGrid({
      onNavigateNext: () => {
        nextCount += 1;
      },
    });
    await settleAsyncRender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 16));
    });
    const scroller = view.getByTestId("calendar-grid-scroll");

    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        dispatchShiftWheel(scroller, 400);
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    });

    expect(nextCount > 1).toBe(true);
  });
});
