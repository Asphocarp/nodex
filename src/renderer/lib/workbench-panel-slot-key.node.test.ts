import { describe, expect, test } from "vitest";
import {
  clearTransientPanelSelection,
  makeWorkbenchPanelSlotKey,
  resolveWorkbenchPanelSlotLeafId,
} from "./workbench-panel-slot-key";

describe("workbench panel slot keys", () => {
  test("encodes panel and leaf slots and only decodes matching scope", () => {
    expect(makeWorkbenchPanelSlotKey("session:one", "right"))
      .toBe("session:one:right");
    const key = makeWorkbenchPanelSlotKey(
      "session:one",
      "bottom",
      "leaf:two",
    );
    expect(key).toBe("session:one:bottom:leaf:two");
    expect(
      resolveWorkbenchPanelSlotLeafId(
        key,
        "session:one",
        "bottom",
      ),
    ).toBe("leaf:two");
    expect(
      resolveWorkbenchPanelSlotLeafId(
        key,
        "session:other",
        "bottom",
      ),
    ).toBeNull();
    expect(
      resolveWorkbenchPanelSlotLeafId(
        key,
        "session:one",
        "right",
      ),
    ).toBeNull();
    expect(
      resolveWorkbenchPanelSlotLeafId(
        makeWorkbenchPanelSlotKey("session:one", "bottom"),
        "session:one",
        "bottom",
      ),
    ).toBeNull();
  });

  test("preserves object identity on no-op and removes only requested keys", () => {
    const current = {
      right: "right-tab",
      bottom: "bottom-tab",
      other: "other-tab",
    };
    expect(clearTransientPanelSelection(current, "missing"))
      .toBe(current);

    const next = clearTransientPanelSelection(
      current,
      "right",
      "bottom",
    );
    expect(next).toEqual({ other: "other-tab" });
    expect(current).toEqual({
      right: "right-tab",
      bottom: "bottom-tab",
      other: "other-tab",
    });
  });
});
