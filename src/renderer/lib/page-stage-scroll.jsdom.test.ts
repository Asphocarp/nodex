import { beforeEach, describe, expect, test } from "vitest";
import { forgetScrollPosition, loadScrollPosition, saveScrollPosition } from "./page-stage-scroll";

describe("Page Stage scroll state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("keeps independent scroll positions for two PageTabs showing the same Page", () => {
    const projectId = "project-scroll-session";
    const pageId = "page-scroll-session";
    const firstSessionKey = "session-1\u0000tab-page-1";
    const secondSessionKey = "session-1\u0000tab-page-2";

    saveScrollPosition(projectId, pageId, 120, firstSessionKey);
    saveScrollPosition(projectId, pageId, 480, secondSessionKey);

    expect(loadScrollPosition(projectId, pageId, firstSessionKey)).toBe(120);
    expect(loadScrollPosition(projectId, pageId, secondSessionKey)).toBe(480);

    forgetScrollPosition(projectId, pageId, firstSessionKey);
    expect(loadScrollPosition(projectId, pageId, firstSessionKey)).toBeNull();
    expect(loadScrollPosition(projectId, pageId, secondSessionKey)).toBe(480);
  });
});
