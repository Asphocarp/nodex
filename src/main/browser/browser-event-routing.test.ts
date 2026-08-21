import { describe, expect, test } from "vite-plus/test";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarStateSnapshot,
  BrowserSidebarTabSnapshot,
  BrowserUseTabState,
} from "../../shared/browser-sidebar";
import {
  filterBrowserStateForViewScope,
  filterBrowserUseStateForViewScope,
} from "./browser-event-routing";

const makeTab = (browserViewScopeId: string, browserTabId: string): BrowserSidebarTabSnapshot => ({
  browserConversationId: "session-1",
  browserViewScopeId,
  browserTabId,
  projectId: "project-1",
  webContentsId: null,
  mountGeneration: 0,
  url: "about:blank",
  title: "New tab",
  isLoading: false,
  isWaitingForResponse: false,
  canGoBack: false,
  canGoForward: false,
  zoomPercent: 100,
  deviceToolbarVisible: false,
  viewport: {
    width: 390,
    height: 844,
    zoomPercent: 100,
    presetId: "responsive",
  },
  deviceToolbarState: {
    responsiveViewportSize: null,
    toolbarState: {
      isEnabled: false,
      presetId: "responsive",
      width: 390,
      height: 844,
    },
  },
  interactionMode: "browse",
  findState: {
    open: false,
    query: "",
    activeMatchOrdinal: null,
    matchCount: null,
    caseSensitive: false,
  },
  hasBrowserPage: false,
  pageActionsDisabled: true,
  updatedAt: 1,
});

const makeBrowserUseTab = (
  browserViewScopeId: string,
  browserTabId: string,
): BrowserUseTabState => ({
  browserConversationId: "session-1",
  browserViewScopeId,
  browserTabId,
  codexSessionId: "thread-1",
  projectId: "project-1",
  title: "Tab",
  url: "https://example.com/",
  webContentsId: null,
  viewport: {
    width: 390,
    height: 844,
    zoomPercent: 100,
    presetId: "responsive",
  },
  captureActive: false,
  released: false,
  updatedAt: 1,
});

describe("Browser event routing", () => {
  test("filters ordinary Browser state by Window Session scope", () => {
    const snapshot: BrowserSidebarStateSnapshot = {
      tabs: [makeTab("window-session-1", "shared-tab"), makeTab("window-session-2", "shared-tab")],
    };

    expect(filterBrowserStateForViewScope(snapshot, "window-session-2").tabs).toEqual([
      expect.objectContaining({
        browserViewScopeId: "window-session-2",
      }),
    ]);
  });

  test("filters Browser Use tabs, cursors, and active ids together", () => {
    const snapshot: BrowserSidebarBrowserUseStateSnapshot = {
      tabs: [
        makeBrowserUseTab("window-session-1", "shared-tab"),
        makeBrowserUseTab("window-session-2", "shared-tab"),
      ],
      cursors: [
        {
          browserConversationId: "session-1",
          browserViewScopeId: "window-session-1",
          browserTabId: "shared-tab",
          moveSequence: 1,
          x: 1,
          y: 2,
          visible: true,
          updatedAt: 1,
        },
        {
          browserConversationId: "session-1",
          browserViewScopeId: "window-session-2",
          browserTabId: "shared-tab",
          moveSequence: 2,
          x: 3,
          y: 4,
          visible: true,
          updatedAt: 1,
        },
      ],
      activeBrowserTabIdsByConversationScope: {
        "session-1\0window-session-1": "shared-tab",
        "session-1\0window-session-2": "shared-tab",
      },
    };

    expect(filterBrowserUseStateForViewScope(snapshot, "window-session-2")).toEqual({
      tabs: [
        expect.objectContaining({
          browserViewScopeId: "window-session-2",
        }),
      ],
      cursors: [
        expect.objectContaining({
          browserViewScopeId: "window-session-2",
          x: 3,
        }),
      ],
      activeBrowserTabIdsByConversationScope: {
        "session-1\0window-session-2": "shared-tab",
      },
    });
  });
});
