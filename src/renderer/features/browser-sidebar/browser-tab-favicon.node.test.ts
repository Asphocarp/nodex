import { describe, expect, test } from "vite-plus/test";

import {
  createBrowserTabFaviconState,
  reconcileBrowserTabFaviconState,
  resolveBrowserTabFaviconPhase,
} from "./browser-tab-favicon";

describe("Browser tab favicon state", () => {
  test("maps the navigation lifecycle onto the three production phases", () => {
    expect(resolveBrowserTabFaviconPhase(true, true)).toBe("spinner-only");
    expect(resolveBrowserTabFaviconPhase(true, false)).toBe("loading-favicon");
    expect(resolveBrowserTabFaviconPhase(false, false)).toBe("settled");
  });

  test("pins the last viable favicon until the completion transition ends", () => {
    const settled = createBrowserTabFaviconState({
      faviconUrl: "https://example.com/old.ico",
      isLoading: false,
      isWaitingForResponse: false,
      reduceMotion: false,
    });
    const loading = reconcileBrowserTabFaviconState(settled, {
      faviconUrl: "https://example.com/old.ico",
      isLoading: true,
      isWaitingForResponse: false,
      reduceMotion: false,
    });
    const finished = reconcileBrowserTabFaviconState(loading, {
      faviconUrl: undefined,
      isLoading: false,
      isWaitingForResponse: false,
      reduceMotion: false,
    });

    expect(finished.pinnedCompletionFaviconUrl).toBe("https://example.com/old.ico");
    expect(finished.skipCompletionTransition).toBe(false);
  });

  test("settles immediately when reduced motion is active", () => {
    const loading = createBrowserTabFaviconState({
      faviconUrl: "https://example.com/favicon.ico",
      isLoading: true,
      isWaitingForResponse: false,
      reduceMotion: false,
    });
    const finished = reconcileBrowserTabFaviconState(loading, {
      faviconUrl: "https://example.com/favicon.ico",
      isLoading: false,
      isWaitingForResponse: false,
      reduceMotion: true,
    });

    expect(finished.pinnedCompletionFaviconUrl).toBe(null);
    expect(finished.skipCompletionTransition).toBe(true);
  });

  test("clears a failed favicon when navigation supplies a new URL", () => {
    const failed = {
      ...createBrowserTabFaviconState({
        faviconUrl: "https://example.com/broken.ico",
        isLoading: false,
        isWaitingForResponse: false,
        reduceMotion: false,
      }),
      failedFaviconUrl: "https://example.com/broken.ico",
    };
    const next = reconcileBrowserTabFaviconState(failed, {
      faviconUrl: "https://example.com/healthy.ico",
      isLoading: true,
      isWaitingForResponse: true,
      reduceMotion: false,
    });

    expect(next.failedFaviconUrl).toBe(null);
  });
});
