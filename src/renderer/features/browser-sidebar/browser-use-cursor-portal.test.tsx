import { afterEach, describe, expect, test } from "vitest";
import { render, settleAsyncRender } from "../../test/dom";
import {
  BrowserUseCursorPortal,
  readCursorPresentationSize,
} from "./browser-use-cursor-portal";
import { browserSidebarRendererWebviewManager } from "./browser-sidebar-webview-manager";

const identity = {
  browserConversationId: "session-1",
  browserViewScopeId: "window-session-1",
  browserTabId: "tab-browser",
} as const;

afterEach(() => {
  browserSidebarRendererWebviewManager.disposeAll();
  document.body.innerHTML = "";
});

describe("BrowserUseCursorPortal", () => {
  test("positions the default cursor from the presented webview surface", async () => {
    browserSidebarRendererWebviewManager.syncWebview({
      ...identity,
      projectId: "alpha",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: { x: 800, y: 88, width: 600, height: 800 },
      mountGeneration:
        browserSidebarRendererWebviewManager.claimMountGeneration(identity),
      onHostCreated: () => undefined,
    });

    render(
      <BrowserUseCursorPortal
        cursor={null}
        fallbackViewportSize={{ width: 390, height: 844 }}
        identity={identity}
        isVisible
      />,
    );
    await settleAsyncRender();

    const cursor = document.body.querySelector<HTMLElement>(
      "[data-testid='browser-agent-cursor']",
    );
    expect(cursor?.style.transform).toContain(
      "translate3d(336px, 428px, 0)",
    );
  });

  test("ignores the one-pixel parked host as a presentation surface", () => {
    const parent = document.createElement("div");
    const overlayHost = document.createElement("div");
    parent.style.width = "1px";
    parent.style.height = "1px";
    parent.append(overlayHost);
    document.body.append(parent);

    expect(readCursorPresentationSize(overlayHost)).toBe(null);
  });
});
