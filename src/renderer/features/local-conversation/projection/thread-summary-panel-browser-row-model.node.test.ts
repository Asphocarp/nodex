import { describe, expect, test } from "vitest";
import {
  buildThreadSummaryPanelBrowserRow,
  buildThreadSummaryPanelBrowserRows,
  isThreadSummaryBrowserRowAgentWorking,
} from "./thread-summary-panel-browser-row-model";

describe("buildThreadSummaryPanelBrowserRow", () => {
  test("normalizes URL metadata to the Browser summary display model", () => {
    const row = buildThreadSummaryPanelBrowserRow({
      id: "browser-1",
      browserTabId: "runtime-browser-1",
      workbenchTabId: "browser-1",
      tabTitle: "New tab",
      configTitle: "Release notes",
      url: "https://www.example.com/docs/page",
      faviconUrl: " https://example.com/favicon.ico ",
      panelId: "right",
      leafId: "leaf-a",
      isAgentWorking: true,
    });

    expect(row.title).toBe("Release notes");
    expect(row.displayUrl).toBe("example.com");
    expect(row.url).toBe("https://www.example.com/docs/page");
    expect(row.faviconUrl).toBe("https://example.com/favicon.ico");
    expect(row.isAgentWorking).toBe(true);
    expect(row.panelId).toBe("right");
    expect(row.leafId).toBe("leaf-a");
  });

  test("uses display URL when the browser title is blank or a new-tab placeholder", () => {
    const row = buildThreadSummaryPanelBrowserRow({
      id: "browser-1",
      browserTabId: "runtime-browser-1",
      tabTitle: "New tab",
      url: "https://openai.com/",
    });

    expect(row.title).toBe("openai.com");
    expect(row.displayUrl).toBe("openai.com");
  });

  test("hides blank and attach-token URLs from the row contract", () => {
    const row = buildThreadSummaryPanelBrowserRow({
      id: "browser-1",
      browserTabId: "runtime-browser-1",
      tabTitle: "about:blank#codex-browser-sidebar-attach-token=abc",
      url: "about:blank#codex-browser-sidebar-attach-token=abc",
    });

    expect(row.title).toBe("Browser");
    expect(row.displayUrl === null).toBe(true);
    expect(row.url).toBe("");
  });
});

describe("isThreadSummaryBrowserRowAgentWorking", () => {
  test("marks only the conversation-active BrowserUse identity as working", () => {
    expect(isThreadSummaryBrowserRowAgentWorking("browser-1", "browser-1")).toBe(true);
    expect(isThreadSummaryBrowserRowAgentWorking("browser-2", "browser-1")).toBe(false);
    expect(isThreadSummaryBrowserRowAgentWorking(null, "browser-1")).toBe(false);
  });
});

describe("buildThreadSummaryPanelBrowserRows", () => {
  test("unions Workbench and runtime-only Browser pages by logical identity", () => {
    const runtimeBase = {
      browserConversationId: "session-1",
      browserViewScopeId: "window-1",
      codexSessionId: "thread-1",
      projectId: "project-1",
      webContentsId: null,
      viewport: {
        width: 1_280,
        height: 720,
        presetId: "browser-use",
        zoomPercent: 100,
      },
      captureActive: true,
      released: false,
      updatedAt: 1,
    };
    const rows = buildThreadSummaryPanelBrowserRows({
      rightTabs: [
        {
          browserTabId: "browser-one",
          workbenchTabId: "tab-one",
          tabTitle: "Stale",
          panelId: "right",
          leafId: "leaf-right",
        },
      ],
      bottomTabs: [],
      pendingTabs: [
        {
          browserTabId: "browser-one",
          workbenchTabId: "preview-one",
          tabTitle: "Duplicate",
          panelId: "bottom",
        },
      ],
      runtimeTabs: [
        {
          ...runtimeBase,
          browserTabId: "browser-one",
          title: "Live One",
          url: "https://one.example",
        },
        {
          ...runtimeBase,
          browserTabId: "browser-two",
          title: "Live Two",
          url: "https://two.example",
        },
      ],
      snapshots: [],
      activeBrowserUseTabId: "browser-two",
    });

    expect(
      rows.map((row) => ({
        browserTabId: row.browserTabId,
        id: row.id,
        isAgentWorking: row.isAgentWorking,
        isMaterialized: row.isMaterialized,
      })),
    ).toEqual([
      {
        browserTabId: "browser-one",
        id: "tab-one",
        isAgentWorking: false,
        isMaterialized: true,
      },
      {
        browserTabId: "browser-two",
        id: "browser-use:browser-two",
        isAgentWorking: true,
        isMaterialized: false,
      },
    ]);
  });
});
