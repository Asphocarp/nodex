import { describe, expect, test } from "vitest";
import {
  RECENTLY_SELECTED_BROWSER_PAGE_PROTECTION_MS,
  selectBrowserTabsToSuspend,
  type BrowserTabBudgetEntry,
} from "./browser-tab-budget";

function entry(
  browserTabId: string,
  overrides: Partial<BrowserTabBudgetEntry> = {},
): BrowserTabBudgetEntry {
  return {
    browserConversationId: "conversation-1",
    browserViewScopeId: "window-session-1",
    browserTabId,
    activeDownload: false,
    audible: false,
    browserUseActive: false,
    captureActive: false,
    isLoading: false,
    lastSelectedAt: 0,
    lifecycleState: "live-detached",
    mediaActive: false,
    presented: false,
    updatedAt: 0,
    ...overrides,
  };
}

describe("selectBrowserTabsToSuspend", () => {
  test("suspends the oldest unprotected pages above the per-window budget", () => {
    const entries = Array.from({ length: 35 }, (_, index) =>
      entry(`tab-${index}`, {
        lastSelectedAt: index,
        updatedAt: index,
      })
    );

    expect(selectBrowserTabsToSuspend(entries, {
      now: RECENTLY_SELECTED_BROWSER_PAGE_PROTECTION_MS + 100,
    }).map((candidate) => candidate.browserTabId)).toEqual([
      "tab-0",
      "tab-1",
      "tab-2",
    ]);
  });

  test("protects active, recent, Browser Use, capture and media pages", () => {
    const now = RECENTLY_SELECTED_BROWSER_PAGE_PROTECTION_MS * 2;
    const entries = [
      ...Array.from({ length: 32 }, (_, index) =>
        entry(`base-${index}`, {
          lastSelectedAt: now - RECENTLY_SELECTED_BROWSER_PAGE_PROTECTION_MS - index - 1,
        })
      ),
      entry("recent", { lastSelectedAt: now }),
      entry("browser-use", {
        browserUseActive: true,
        lastSelectedAt: 0,
      }),
      entry("capture", { captureActive: true, lastSelectedAt: 0 }),
      entry("audible", { audible: true, lastSelectedAt: 0 }),
      entry("loading", { isLoading: true, lastSelectedAt: 0 }),
    ];

    const suspended = selectBrowserTabsToSuspend(entries, { now });
    expect(suspended).toHaveLength(5);
    expect(suspended.every((candidate) =>
      candidate.browserTabId.startsWith("base-")
    )).toBe(true);
  });

  test("does not count cold, suspended or presented pages as live detached", () => {
    const entries = [
      ...Array.from({ length: 32 }, (_, index) => entry(`live-${index}`)),
      entry("cold", { lifecycleState: "cold" }),
      entry("suspended", { lifecycleState: "suspended" }),
      entry("presented", {
        lifecycleState: "live-attached",
        presented: true,
      }),
    ];
    expect(selectBrowserTabsToSuspend(entries, {
      now: RECENTLY_SELECTED_BROWSER_PAGE_PROTECTION_MS + 1,
    })).toEqual([]);
  });
});
