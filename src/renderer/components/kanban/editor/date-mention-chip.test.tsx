import { afterEach, describe, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  createDateMentionClockStore,
  setDateMentionClockStoreForTest,
} from "@/lib/nfm/date-mention-clock";
import {
  buildDateMentionUpdate,
  DateMentionInlineContentView,
  dateMentionPayloadToProps,
} from "./date-mention-chip";
import type { DateMentionInlineContentUpdate, DateMentionProps } from "./date-mention-chip";

let restoreDateMentionClockStore: (() => void) | null = null;

afterEach(() => {
  restoreDateMentionClockStore?.();
  restoreDateMentionClockStore = null;
});

function renderDateMentionChip({
  props,
  onUpdate,
}: {
  props: Partial<DateMentionProps>;
  onUpdate?: (update: DateMentionInlineContentUpdate) => void;
}) {
  return render(
    <NodexTooltipProvider>
      <DateMentionInlineContentView
        inlineContent={{ props }}
        updateInlineContent={onUpdate ?? (() => undefined)}
      />
    </NodexTooltipProvider>,
  );
}

function installDateMentionClock(start: string) {
  let currentNow = new Date(start);
  const store = createDateMentionClockStore({
    now: () => new Date(currentNow.getTime()),
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  restoreDateMentionClockStore = setDateMentionClockStoreForTest(store);

  return {
    store,
    setNow: (value: string) => {
      currentNow = new Date(value);
    },
  };
}

describe("DateMentionInlineContentView", () => {
  test("renders a text-level date mention chip with stable non-editable guards", () => {
    const view = renderDateMentionChip({
      props: dateMentionPayloadToProps({
        type: "dateMention",
        start: "2050-06-28",
        format: "relative",
      }),
    });

    const chip = view.getByRole("button", { name: "@Jun 28, 2050" });
    expect(chip.getAttribute("contenteditable")).toBe("false");
    expect(chip.textContent).toBe("@Jun 28, 2050");
    expect(chip.getAttribute("data-date-mention-chip")).toBe("true");
    expect(view.container.querySelector('[data-date-mention-guard="start"]')).not.toBeNull();
    expect(view.container.querySelector('[data-date-mention-guard="end"]')).not.toBeNull();
  });

  test("refreshes relative labels across local day without mutating payload", async () => {
    const clock = installDateMentionClock("2026-06-28T12:00:00");
    let updateCount = 0;
    const view = renderDateMentionChip({
      props: dateMentionPayloadToProps({
        type: "dateMention",
        start: "2026-06-28",
        format: "relative",
      }),
      onUpdate: () => {
        updateCount += 1;
      },
    });

    expect(view.getByRole("button").textContent).toBe("@Today");

    await act(async () => {
      clock.setNow("2026-06-29T00:00:02");
      clock.store.refresh();
      await Promise.resolve();
    });

    expect(view.getByRole("button").textContent).toBe("@Yesterday");
    expect(updateCount).toBe(0);
  });

  test("opens the date popover and updates payload when Include time is toggled", async () => {
    let update: DateMentionInlineContentUpdate | null = null;
    const view = renderDateMentionChip({
      props: dateMentionPayloadToProps({
        type: "dateMention",
        start: "2050-06-28",
        format: "relative",
      }),
      onUpdate: (nextUpdate) => {
        update = nextUpdate;
      },
    });

    fireEvent.click(view.getByRole("button", { name: "@Jun 28, 2050" }));
    await settleAsyncRender();

    expect((view.getByLabelText("Date") as HTMLInputElement).value).toBe("2050-06-28");
    fireEvent.click(view.getByRole("switch", { name: "Include time" }));

    const capturedUpdate = update as DateMentionInlineContentUpdate | null;
    expect(capturedUpdate !== null).toBeTrue();
    if (!capturedUpdate) return;
    expect(capturedUpdate.type).toBe("dateMention");
    expect(capturedUpdate.props.start.startsWith("2050-06-28T")).toBeTrue();
    expect(capturedUpdate.props.start.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(capturedUpdate.props.start)).toBeTrue();
    expect(capturedUpdate.props.tz.length > 0).toBeTrue();
  });

  test("resolves pending and overdue reminder tones without mutating payload", () => {
    const pending = renderDateMentionChip({
      props: dateMentionPayloadToProps({
        type: "dateMention",
        start: "2999-06-28",
        format: "relative",
        reminder: "day:0@09:00",
      }),
    });
    expect(pending.getByRole("button").getAttribute("data-reminder-tone")).toBe("pending");
    pending.unmount();

    const overdue = renderDateMentionChip({
      props: dateMentionPayloadToProps({
        type: "dateMention",
        start: "2000-06-28",
        format: "relative",
        reminder: "day:0@09:00",
      }),
    });
    expect(overdue.getByRole("button").getAttribute("data-reminder-tone")).toBe("overdue");
  });

  test("refreshes reminder tone on the minute clock without mutating payload", async () => {
    const clock = installDateMentionClock("2026-06-28T08:59:30");
    let updateCount = 0;
    const view = renderDateMentionChip({
      props: dateMentionPayloadToProps({
        type: "dateMention",
        start: "2026-06-28",
        format: "relative",
        reminder: "day:0@09:00",
      }),
      onUpdate: () => {
        updateCount += 1;
      },
    });

    expect(view.getByRole("button").getAttribute("data-reminder-tone")).toBe("pending");

    await act(async () => {
      clock.setNow("2026-06-28T09:01:00");
      clock.store.refresh();
      await Promise.resolve();
    });

    expect(view.getByRole("button").getAttribute("data-reminder-tone")).toBe("overdue");
    expect(updateCount).toBe(0);
  });

  test("buildDateMentionUpdate repairs reversed ranges", () => {
    const update = buildDateMentionUpdate(
      {
        start: "2050-06-30",
        end: "2050-06-28",
        format: "ll",
      },
      {},
    );

    expect(update.props.start).toBe("2050-06-28");
    expect(update.props.end).toBe("2050-06-30");
    expect(update.props.format).toBe("ll");
  });
});
