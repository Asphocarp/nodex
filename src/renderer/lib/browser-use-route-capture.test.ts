import { describe, expect, test } from "vitest";
import { buildBrowserUseRouteCaptureCommand } from "./browser-use-route-capture";

describe("buildBrowserUseRouteCaptureCommand", () => {
  test("captures a projectless task as a valid Browser Use route", () => {
    expect(buildBrowserUseRouteCaptureCommand({
      browserConversationId: "project-session-1",
      browserViewScopeId: "window-session-1",
      codexSessionId: "codex-session-1",
      projectId: null,
    })).toEqual({
      type: "capture-browser-use-route",
      browserConversationId: "project-session-1",
      browserViewScopeId: "window-session-1",
      codexSessionId: "codex-session-1",
      projectId: null,
    });
  });

  test("waits until every required route identity exists", () => {
    expect(buildBrowserUseRouteCaptureCommand({
      browserConversationId: null,
      browserViewScopeId: "window-session-1",
      codexSessionId: null,
      projectId: null,
    })).toBeNull();
    expect(buildBrowserUseRouteCaptureCommand({
      browserConversationId: "project-session-1",
      browserViewScopeId: "",
      codexSessionId: "codex-session-1",
      projectId: null,
    })).toBeNull();
  });
});
