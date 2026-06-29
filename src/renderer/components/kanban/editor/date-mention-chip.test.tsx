import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  buildDateMentionUpdate,
  DateMentionInlineContentView,
  dateMentionPayloadToProps,
} from "./date-mention-chip";
import type { DateMentionInlineContentUpdate, DateMentionProps } from "./date-mention-chip";

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
