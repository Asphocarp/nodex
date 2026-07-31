import { afterEach, beforeEach, describe, expect, vi, test } from "vitest";
import type { WorkbenchTabProjection } from "@/lib/types";
import { render, settleAsyncRender } from "../../test/dom";
import { browserSidebarRendererWebviewManager } from "./browser-sidebar-webview-manager";

let BrowserSidebarHiddenWebviewHosts: typeof import("./browser-sidebar-hidden-webview-hosts")["BrowserSidebarHiddenWebviewHosts"];
let invokeCalls: unknown[][] = [];

vi.mock("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return { ok: true };
  },
  subscribeBoardChanges: () => () => undefined,
  subscribeProjectSessionChanges: () => () => undefined,
  subscribeProjectChanges: () => () => undefined,
  subscribeCodexHostMessages: () => () => undefined,
  subscribeDesktopNotificationActions: () => () => undefined,
  subscribeGitBranchChanges: () => () => undefined,
  subscribeAppUpdateStatus: () => () => undefined,
  getWindowFocusState: async () => true,
  subscribeWindowFocusChanges: () => () => undefined,
}));

vi.mock("@/lib/use-theme", () => ({
  useTheme: () => ({
    theme: "dark",
    resolved: "dark",
    setTheme: () => undefined,
  }),
}));

beforeEach(async () => {
  invokeCalls = [];
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      on: () => () => undefined,
    },
  });
  const module = await import("./browser-sidebar-hidden-webview-hosts");
  BrowserSidebarHiddenWebviewHosts = module.BrowserSidebarHiddenWebviewHosts;
});

afterEach(() => {
  browserSidebarRendererWebviewManager.disposeAll();
  document.body.innerHTML = "";
});

describe("BrowserSidebarHiddenWebviewHosts", () => {
  test("does not bootstrap blank browser tabs in the background", async () => {
    render(
      <BrowserSidebarHiddenWebviewHosts
        sessionId="session-1"
        browserViewScopeId="window-session-1"
        tabs={[{ ...browserTab, config: { projectId: "alpha", url: "about:blank" } }]}
        mountedTabIds={new Set()}
        visibleTabIds={new Set()}
      />,
    );
    await settleAsyncRender();

    expect(document.body.querySelector("webview") === null).toBe(true);
    expect(invokeCalls.length).toBe(0);
  });

  test("mounts inactive loaded browser tabs in an offscreen host", async () => {
    render(
      <BrowserSidebarHiddenWebviewHosts
        sessionId="session-1"
        browserViewScopeId="window-session-1"
        tabs={[browserTab]}
        mountedTabIds={new Set()}
        visibleTabIds={new Set()}
      />,
    );
    await settleAsyncRender();

    const host = document.body.querySelector<HTMLElement>(
      "[data-browser-sidebar-webview-manager-root][data-browser-sidebar-browser-tab-id='tab-browser']",
    );
    const reactHost = viewContainerHost();
    const webview = host?.querySelector("webview");
    const registerCommand = invokeCalls.find((call) =>
      call[0] === "browser-sidebar-command"
      && (call[1] as { type?: string } | undefined)?.type === "register-tab"
    );

    expect(host === null).toBe(false);
    expect(reactHost === null).toBe(true);
    expect(host?.hasAttribute("hidden")).toBe(false);
    expect(host?.style.position).toBe("fixed");
    expect(host?.style.left).toBe("-10000px");
    expect(webview === null).toBe(false);
    expect(webview?.getAttribute("data-browser-sidebar-webview-host-kind")).toBe("background");
    expect(registerCommand !== undefined).toBe(true);
  });

  test("does not claim a tab while its closing panel host is still mounted", async () => {
    render(
      <BrowserSidebarHiddenWebviewHosts
        sessionId="session-1"
        browserViewScopeId="window-session-1"
        tabs={[browserTab]}
        mountedTabIds={new Set(["tab-browser"])}
        visibleTabIds={new Set()}
      />,
    );
    await settleAsyncRender();

    expect(document.body.querySelector("webview")).toBeNull();
    expect(
      invokeCalls.some((call) =>
        call[0] === "browser-sidebar-command"
        && (call[1] as { type?: string } | undefined)?.type === "register-host"
      ),
    ).toBe(false);
  });
});

function viewContainerHost() {
  return document.body.querySelector("[data-browser-sidebar-hidden-webview-host='tab-browser']");
}

const browserTab = {
  id: "tab-browser",
  sessionId: "session-1",
  browserTabId: "tab-browser",
  projectId: "alpha",
  panelId: "right",
  kind: "browser",
  title: "Browser",
  order: 0,
  config: {
    projectId: "alpha",
    url: "https://www.google.com/",
    title: "Google",
  },
  stateKey: 0,
  state: null,
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
} satisfies WorkbenchTabProjection;
