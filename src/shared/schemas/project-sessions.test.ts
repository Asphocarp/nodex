import { describe, expect, test } from "vitest";
import { MAX_PAGE_STAGE_ANCESTOR_DEPTH } from "../page-stage-ancestors";
import { parseProjectSessionTabConfig } from "./project-sessions";

describe("project session Page Stage config", () => {
  test("persists only stable Page identities in a bounded ancestor trail", () => {
    const ancestors = [
      { pageId: "root" },
      { pageId: "child" },
    ];

    expect(parseProjectSessionTabConfig("page_stage", {
      projectId: "alpha",
      pageId: "nested",
      titleSnapshot: "Nested",
      ancestors,
    })).toEqual({
      projectId: "alpha",
      pageId: "nested",
      titleSnapshot: "Nested",
      ancestors,
    });
  });

  test("discards legacy ancestor title and Project snapshots", () => {
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
      ancestors: [{ pageId: "root" }],
    });
  });

  test("rejects ancestor trails beyond the navigation depth limit", () => {
    const ancestors = Array.from({
      length: MAX_PAGE_STAGE_ANCESTOR_DEPTH + 1,
    }, (_, index) => ({
      pageId: `page-${index}`,
    }));

    expect(() => parseProjectSessionTabConfig("page_stage", {
      projectId: "alpha",
      pageId: "nested",
      ancestors,
    })).toThrow();
  });
});
