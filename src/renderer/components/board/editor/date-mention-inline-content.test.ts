import { describe, expect, test } from "vite-plus/test";
import { buildDateMentionUpdate } from "./date-mention-inline-content";

describe("date mention inline content", () => {
  test("repairs reversed ranges before emitting an inline-content update", () => {
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
