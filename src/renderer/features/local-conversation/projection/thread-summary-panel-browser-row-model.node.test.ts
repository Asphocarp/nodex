import { describe, expect, test } from "vitest";
import {
  buildThreadSummaryPanelBrowserRow,
  isThreadSummaryBrowserRowAgentWorking,
} from "./thread-summary-panel-browser-row-model";

describe("buildThreadSummaryPanelBrowserRow", () => {
  test("normalizes URL metadata to the Browser summary display model", () => {
    const row = buildThreadSummaryPanelBrowserRow({
      id: "browser-1",
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
      tabTitle: "New tab",
      url: "https://openai.com/",
    });

    expect(row.title).toBe("openai.com");
    expect(row.displayUrl).toBe("openai.com");
  });

  test("hides blank and attach-token URLs from the row contract", () => {
    const row = buildThreadSummaryPanelBrowserRow({
      id: "browser-1",
      tabTitle: "about:blank#codex-browser-sidebar-attach-token=abc",
      url: "about:blank#codex-browser-sidebar-attach-token=abc",
    });

    expect(row.title).toBe("Browser");
    expect(row.displayUrl === null).toBe(true);
    expect(row.url).toBe("");
  });
});

describe("isThreadSummaryBrowserRowAgentWorking", () => {
  test("marks only the active unreleased BrowserUse tab as working", () => {
    const released = new Set(["browser-2"]);

    expect(isThreadSummaryBrowserRowAgentWorking("browser-1", released, "browser-1")).toBe(true);
    expect(isThreadSummaryBrowserRowAgentWorking("browser-2", released, "browser-2")).toBe(false);
    expect(isThreadSummaryBrowserRowAgentWorking("browser-1", released, "browser-3")).toBe(false);
    expect(isThreadSummaryBrowserRowAgentWorking(null, released, "browser-1")).toBe(false);
  });
});
