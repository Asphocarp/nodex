import { describe, expect, test } from "vitest";
import { parseProjectSessionTabConfig } from "./project-sessions";

describe("project session Page Stage config", () => {
  test("persists only Page identity, access context, and a title snapshot", () => {
    expect(parseProjectSessionTabConfig("page_stage", {
      projectId: "alpha",
      pageId: "nested",
      titleSnapshot: "Nested",
    })).toEqual({
      projectId: "alpha",
      pageId: "nested",
      titleSnapshot: "Nested",
    });
  });

  test("discards legacy interaction-derived ancestor trails", () => {
    expect(parseProjectSessionTabConfig("page_stage", {
      projectId: "alpha",
      pageId: "nested",
      ancestors: [{
        projectId: "stale-project",
        pageId: "root",
        titleSnapshot: "Stale title",
      }],
    })).toEqual({
      projectId: "alpha",
      pageId: "nested",
    });
  });
});
