import { describe, expect, test } from "vitest";
import {
  clearTransientPanelSelection,
  makeWorkbenchPanelSlotKey,
  makeWorkbenchSessionPanelOwnerKey,
  makeWorkbenchSessionPanelSlotKey,
  resolveWorkbenchPanelSlotLeafId,
} from "./workbench-panel-slot-key";

describe("workbench panel slot keys", () => {
  test("encodes panel and leaf slots and only decodes matching scope", () => {
    const ownerKey = makeWorkbenchSessionPanelOwnerKey("session:one");
    expect(makeWorkbenchPanelSlotKey(ownerKey, "right"))
      .toBe(`${ownerKey}:right`);
    const key = makeWorkbenchSessionPanelSlotKey(
      "session:one",
      "bottom",
      "leaf:two",
    );
    expect(key).toBe(`${ownerKey}:bottom:leaf:two`);
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
        makeWorkbenchSessionPanelSlotKey("session:one", "bottom"),
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
