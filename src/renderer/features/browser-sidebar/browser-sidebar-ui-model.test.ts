import { describe, expect, test } from "vitest";
import type { BrowserSidebarLocalServersSnapshot, BrowserSidebarViewport } from "../../../shared/browser-sidebar";
import {
  readBrowserAddressValue,
  resolveBrowserLocalServerSettings,
  resolveBrowserZoomOptions,
  resolveVisibleLocalServers,
  rotateBrowserViewport,
  shouldCommitBrowserAddressEdit,
  shouldSkipBrowserAddressCommit,
  updateBrowserViewportDimension,
  writeBrowserLocalServerExpandedProjects,
} from "./browser-sidebar-ui-model";

describe("browser-sidebar-ui-model", () => {
  test("formats address bar values like the Codex browser chrome", () => {
    expect(readBrowserAddressValue("about:blank")).toBe("");
    expect(readBrowserAddressValue("https://www.google.com/")).toBe("google.com");
    expect(readBrowserAddressValue("https://localhost:5001/dashboard?tab=1")).toBe("localhost:5001/dashboard?tab=1");
  });

  test("commits address edits only for meaningful URL changes", () => {
    expect(shouldCommitBrowserAddressEdit("https://www.google.com/", "google.com")).toBe(false);
    expect(shouldCommitBrowserAddressEdit("about:blank", "")).toBe(false);
    expect(shouldCommitBrowserAddressEdit("https://example.com", "")).toBe(true);
    expect(shouldCommitBrowserAddressEdit("https://example.com", "openai.com")).toBe(true);
  });

  test("skips address commits for browser action targets", () => {
    const root = document.createElement("button");
    root.dataset.browserSidebarOpenExternal = "true";
    const child = document.createElement("span");
    root.appendChild(child);

    expect(shouldSkipBrowserAddressCommit(child)).toBe(true);
    expect(shouldSkipBrowserAddressCommit(document.createElement("div"))).toBe(false);
  });

  test("filters, sorts, hides, and caps local server rows", () => {
    const snapshot: BrowserSidebarLocalServersSnapshot = {
      projectId: "alpha",
      isLoading: false,
      updatedAt: 20,
      hiddenServerIds: ["http://localhost:5003"],
      hiddenRouteIds: [],
      servers: [
        makeServer("http://localhost:5001", 50, true, false),
        makeServer("http://localhost:5002", 80, false, false),
        makeServer("http://localhost:5003", 90, true, true),
        makeServer("http://localhost:5004", 70, true, false),
        makeServer("http://localhost:5005", 60, true, false),
        makeServer("http://localhost:5006", 40, true, false),
        makeServer("http://localhost:5007", 30, true, false),
      ],
    };

    const online = resolveVisibleLocalServers(snapshot, {
      showMode: "online",
      sortMode: "recently-used",
      expandedProjectIds: new Set(),
    });
    expect(online.servers.length).toBe(5);
    expect(online.servers[0]?.origin).toBe("http://localhost:5004");
    expect(online.servers[4]?.origin).toBe("http://localhost:5007");
    expect(online.hasMore).toBe(false);

    const all = resolveVisibleLocalServers(snapshot, {
      showMode: "all",
      sortMode: "recently-used",
      expandedProjectIds: new Set(),
    });
    expect(all.servers.length).toBe(5);
    expect(all.hasMore).toBe(true);

    const hidden = resolveVisibleLocalServers(snapshot, {
      showMode: "hidden",
      sortMode: "origin",
      expandedProjectIds: new Set(),
    });
    expect(hidden.hiddenServers.length).toBe(1);
    expect(hidden.hiddenServers[0]?.origin).toBe("http://localhost:5003");
  });

  test("persists expanded local server projects with Codex storage key", () => {
    window.localStorage.clear();
    writeBrowserLocalServerExpandedProjects(window.localStorage, new Set(["alpha", "beta"]));

    const settings = resolveBrowserLocalServerSettings(window.localStorage);
    expect(settings.expandedProjectIds.has("alpha")).toBe(true);
    expect(settings.expandedProjectIds.has("beta")).toBe(true);
  });

  test("resolves custom zoom options and viewport math", () => {
    expect(resolveBrowserZoomOptions(110).join(",")).toBe("50,75,100,110,125,150,200");

    const viewport: BrowserSidebarViewport = {
      width: 390,
      height: 844,
      zoomPercent: 100,
      presetId: "iphone-15-pro",
    };
    const rotated = rotateBrowserViewport(viewport);
    expect(rotated.width).toBe(844);
    expect(rotated.height).toBe(390);
    expect(rotated.presetId).toBe("responsive");

    const resized = updateBrowserViewportDimension(viewport, "width", 120);
    expect(resized.width).toBe(240);
    expect(resized.presetId).toBe("responsive");
  });
});

function makeServer(
  origin: string,
  lastSeenAt: number,
  online: boolean,
  hidden: boolean,
): BrowserSidebarLocalServersSnapshot["servers"][number] {
  const parsed = new URL(origin);
  return {
    id: origin,
    origin,
    host: parsed.hostname,
    port: Number.parseInt(parsed.port, 10),
    protocol: parsed.protocol === "https:" ? "https:" : "http:",
    lastSeenAt,
    online,
    hidden,
    routes: [{
      id: `${origin}/`,
      path: "/",
      title: origin,
      lastSeenAt,
      hidden: false,
    }],
  };
}
