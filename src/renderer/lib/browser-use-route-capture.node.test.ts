import { describe, expect, test, vi } from "vitest";
import {
  buildBrowserUseRouteCaptureCommand,
  captureBrowserUseRoute,
} from "./browser-use-route-capture";

describe("buildBrowserUseRouteCaptureCommand", () => {
  test("captures a projectless task as a valid Browser Use route", () => {
    expect(
      buildBrowserUseRouteCaptureCommand({
        browserConversationId: "project-session-1",
        browserViewScopeId: "window-session-1",
        codexSessionId: "codex-session-1",
        projectId: null,
      }),
    ).toEqual({
      type: "capture-browser-use-route",
      browserConversationId: "project-session-1",
      browserViewScopeId: "window-session-1",
      codexSessionId: "codex-session-1",
      projectId: null,
    });
  });

  test("waits until every required route identity exists", () => {
    expect(
      buildBrowserUseRouteCaptureCommand({
        browserConversationId: null,
        browserViewScopeId: "window-session-1",
        codexSessionId: null,
        projectId: null,
      }),
    ).toBeNull();
    expect(
      buildBrowserUseRouteCaptureCommand({
        browserConversationId: "project-session-1",
        browserViewScopeId: "",
        codexSessionId: "codex-session-1",
        projectId: null,
      }),
    ).toBeNull();
  });

  test("does not resolve until the Browser service accepts the route", async () => {
    let release: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );
    let settled = false;
    const operation = captureBrowserUseRoute(
      {
        browserConversationId: "project:alpha",
        browserViewScopeId: "window-session-1",
        codexSessionId: "session-1",
        projectId: "alpha",
      },
      run,
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await operation;
    expect(run).toHaveBeenCalledOnce();
  });

  test("surfaces a rejected Browser route before a turn can start", async () => {
    await expect(
      captureBrowserUseRoute(
        {
          browserConversationId: "project:alpha",
          browserViewScopeId: "window-session-1",
          codexSessionId: "session-1",
          projectId: "alpha",
        },
        async () => ({ ok: false, message: "route is busy" }),
      ),
    ).rejects.toThrow("route is busy");
  });
});
