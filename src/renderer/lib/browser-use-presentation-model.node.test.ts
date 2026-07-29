import { describe, expect, test } from "vitest";
import type {
  BrowserSidebarTabSnapshot,
  BrowserUsePresentationRequest,
} from "../../shared/browser-sidebar";
import {
  buildBrowserUseWorkbenchTabCreateInput,
  findWorkbenchBrowserTabByRuntimeId,
} from "./browser-use-presentation-model";
import type { WorkbenchTabProjection } from "./types";

const request: BrowserUsePresentationRequest = {
  browserConversationId: "session-1",
  browserViewScopeId: "window-1",
  browserTabId: "browser-use:one",
  requestId: "request-1",
  codexSessionId: "thread-1",
  projectId: "project-1",
  visible: true,
  transition: "default",
  source: "browser-use",
};

describe("Browser Use presentation model", () => {
  test("materializes the exact Browser runtime and storage identities", () => {
    const input = buildBrowserUseWorkbenchTabCreateInput({
      request,
      sessionId: "session-1",
      targetLeafId: "leaf-right",
      snapshot: {
        ...request,
        browserStorageId: "browser-storage-1",
        projectId: "project-1",
        webContentsId: 42,
        mountGeneration: 1,
        url: "https://example.com",
        title: "Example",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        zoomPercent: 100,
        deviceToolbarVisible: false,
        viewport: {
          width: 1_280,
          height: 720,
          presetId: "browser-use",
          zoomPercent: 100,
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
        hasBrowserPage: true,
        pageActionsDisabled: false,
        updatedAt: 1,
      } satisfies BrowserSidebarTabSnapshot,
    });

    expect(input).toMatchObject({
      sessionId: "session-1",
      panelId: "right",
      targetLeafId: "leaf-right",
      kind: "browser",
      browserTabId: "browser-use:one",
      config: {
        browserStorageId: "browser-storage-1",
        url: "https://example.com",
        title: "Example",
      },
    });
  });

  test("finds an existing Workbench shell by logical Browser identity", () => {
    const tabs = [{
      id: "workbench-browser",
      sessionId: "session-1",
      projectId: "project-1",
      panelId: "bottom",
      title: "Example",
      order: 0,
      stateKey: 0,
      state: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      kind: "browser",
      browserTabId: "browser-use:one",
      config: {
        projectId: "project-1",
        browserStorageId: "browser-storage-1",
      },
    }] satisfies WorkbenchTabProjection[];

    expect(
      findWorkbenchBrowserTabByRuntimeId(tabs, "browser-use:one")?.id,
    ).toBe("workbench-browser");
    expect(findWorkbenchBrowserTabByRuntimeId(tabs, "missing")).toBe(null);
  });
});
