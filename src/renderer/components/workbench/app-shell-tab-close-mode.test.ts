import { describe, expect, test } from "bun:test";
import {
  buildAppShellTabCloseModeSnapshot,
  expandAppShellTabCloseModeHotZone,
  isPointInsideAppShellTabCloseModeHotZone,
  makeAppShellTabCloseModeTabIdsSignature,
  type AppShellTabCloseModeMeasuredTab,
  type AppShellTabCloseModeTab,
} from "./app-shell-tab-close-mode";

describe("app shell tab close mode helpers", () => {
  test("locks following short tabs to the long source tab width", () => {
    const snapshot = buildAppShellTabCloseModeSnapshot({
      tabs: makeClosableTabs(["long", "short", "tiny"]),
      sourceTabId: "long",
      measuredTabs: makeMeasuredTabs([
        ["long", 152.4],
        ["short", 74],
        ["tiny", 52],
      ]),
      rowScrollLeft: 24,
      rowRect: makeRect(),
    });

    if (!snapshot) throw new Error("Expected close mode snapshot");
    expect(snapshot.sourceWidthPx).toBe(152);
    expect(snapshot.widthByTabId.long).toBe(152);
    expect(snapshot.widthByTabId.short).toBe(152);
    expect(snapshot.widthByTabId.tiny).toBe(152);
    expect(snapshot.runTabIds.join(",")).toBe("short,tiny");
    expect(snapshot.scrollLeft).toBe(24);
  });

  test("locks following long tabs to the short source tab width", () => {
    const snapshot = buildAppShellTabCloseModeSnapshot({
      tabs: makeClosableTabs(["short", "long"]),
      sourceTabId: "short",
      measuredTabs: makeMeasuredTabs([
        ["short", 68],
        ["long", 156],
      ]),
      rowScrollLeft: 0,
      rowRect: makeRect(),
    });

    if (!snapshot) throw new Error("Expected close mode snapshot");
    expect(snapshot.widthByTabId.short).toBe(68);
    expect(snapshot.widthByTabId.long).toBe(68);
    expect(snapshot.runTabIds.join(",")).toBe("long");
  });

  test("stops the close run at labels and non-closable tabs", () => {
    const snapshot = buildAppShellTabCloseModeSnapshot({
      tabs: [
        { id: "one", closable: true },
        { id: "two", closable: true },
        { id: "history", closable: false, isLabel: true },
        { id: "three", closable: true },
      ],
      sourceTabId: "one",
      measuredTabs: makeMeasuredTabs([
        ["one", 120],
        ["two", 80],
        ["history", 72],
        ["three", 96],
      ]),
      rowScrollLeft: 0,
      rowRect: makeRect(),
    });

    if (!snapshot) throw new Error("Expected close mode snapshot");
    expect(snapshot.runTabIds.join(",")).toBe("two");
    expect(snapshot.widthByTabId.two).toBe(120);
    expect(snapshot.widthByTabId.history).toBe(72);
    expect(snapshot.widthByTabId.three).toBe(96);
  });

  test("does not enter close mode when no following closable tab can inherit the target", () => {
    const noFollowingTab = buildAppShellTabCloseModeSnapshot({
      tabs: makeClosableTabs(["one", "two"]),
      sourceTabId: "two",
      measuredTabs: makeMeasuredTabs([
        ["one", 88],
        ["two", 100],
      ]),
      rowScrollLeft: 0,
      rowRect: makeRect(),
    });
    const blockedByLabel = buildAppShellTabCloseModeSnapshot({
      tabs: [
        { id: "one", closable: true },
        { id: "history", closable: false, isLabel: true },
        { id: "two", closable: true },
      ],
      sourceTabId: "one",
      measuredTabs: makeMeasuredTabs([
        ["one", 100],
        ["history", 60],
        ["two", 84],
      ]),
      rowScrollLeft: 0,
      rowRect: makeRect(),
    });

    expect(noFollowingTab).toBe(null);
    expect(blockedByLabel).toBe(null);
  });

  test("expands the row hot zone and tests points against it", () => {
    const hotZone = expandAppShellTabCloseModeHotZone(
      { left: 100, right: 400, top: 10, bottom: 38 },
      { left: 8, right: 60, top: 6, bottom: 40 },
    );

    expect(hotZone.left).toBe(92);
    expect(hotZone.right).toBe(460);
    expect(hotZone.top).toBe(4);
    expect(hotZone.bottom).toBe(78);
    expect(isPointInsideAppShellTabCloseModeHotZone({ clientX: 92, clientY: 78, hotZone })).toBeTrue();
    expect(isPointInsideAppShellTabCloseModeHotZone({ clientX: 91, clientY: 20, hotZone })).toBeFalse();
    expect(isPointInsideAppShellTabCloseModeHotZone({ clientX: 200, clientY: 79, hotZone })).toBeFalse();
  });

  test("builds stable tab id signatures from the visible order", () => {
    expect(makeAppShellTabCloseModeTabIdsSignature(makeClosableTabs(["one", "two", "three"]))).toBe("one\u001ftwo\u001fthree");
  });
});

function makeClosableTabs(ids: string[]): AppShellTabCloseModeTab[] {
  return ids.map((id) => ({ id, closable: true }));
}

function makeMeasuredTabs(entries: [string, number][]): AppShellTabCloseModeMeasuredTab[] {
  return entries.map(([id, width]) => ({ id, width }));
}

function makeRect() {
  return { left: 10, right: 500, top: 4, bottom: 34 };
}
