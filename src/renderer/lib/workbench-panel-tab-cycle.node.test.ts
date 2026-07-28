import { describe, expect, test } from "vitest";
import {
  panelTabCycleRequestDirectionToOffset,
  resolveNextPanelTabId,
  resolvePanelTabCloseShortcut,
  resolvePanelTabCycleDirection,
} from "./workbench-panel-tab-cycle";
import type { AppShellTabItem } from "@/components/workbench/app-shell-tabs";

function keyEvent(
  input: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">,
): KeyboardEvent {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...input,
  } as KeyboardEvent;
}

const tabs = ["one", "two", "three"].map((id) => ({
  id,
  label: id,
})) as unknown as AppShellTabItem[];

describe("workbench panel tab cycle", () => {
  test.each([
    ["mac previous", keyEvent({ key: "[", code: "BracketLeft", metaKey: true, shiftKey: true }), true, -1],
    ["mac next", keyEvent({ key: "]", code: "BracketRight", metaKey: true, shiftKey: true }), true, 1],
    ["windows previous", keyEvent({ key: "{", ctrlKey: true, shiftKey: true }), false, -1],
    ["windows next", keyEvent({ key: "}", ctrlKey: true, shiftKey: true }), false, 1],
    ["missing shift", keyEvent({ key: "]", metaKey: true }), true, null],
    ["alt blocked", keyEvent({ key: "]", metaKey: true, shiftKey: true, altKey: true }), true, null],
  ] as const)("%s", (_label, event, isMac, expected) => {
    expect(resolvePanelTabCycleDirection(event, isMac)).toBe(expected);
  });

  test("wraps and rejects missing or singular active scopes", () => {
    expect(resolveNextPanelTabId(tabs, "one", -1)).toBe("three");
    expect(resolveNextPanelTabId(tabs, "three", 1)).toBe("one");
    expect(resolveNextPanelTabId(tabs, "missing", 1)).toBeNull();
    expect(resolveNextPanelTabId(tabs, null, 1)).toBeNull();
    expect(resolveNextPanelTabId(tabs.slice(0, 1), "one", 1))
      .toBeNull();
  });

  test("maps native directions and platform close shortcuts", () => {
    expect(panelTabCycleRequestDirectionToOffset("previous")).toBe(-1);
    expect(panelTabCycleRequestDirectionToOffset("next")).toBe(1);
    expect(resolvePanelTabCloseShortcut(
      keyEvent({ key: "w", metaKey: true }),
      true,
    )).toBe(true);
    expect(resolvePanelTabCloseShortcut(
      keyEvent({ key: "W", ctrlKey: true }),
      false,
    )).toBe(true);
    expect(resolvePanelTabCloseShortcut(
      keyEvent({ key: "w", ctrlKey: true, shiftKey: true }),
      false,
    )).toBe(false);
  });
});
