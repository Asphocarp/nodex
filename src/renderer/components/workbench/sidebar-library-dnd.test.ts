import { describe, expect, test } from "vitest";

import { resolveSidebarLibraryDropDecision } from "./sidebar-library-dnd";

const resource = {
  kind: "sidebar-library-resource",
  target: { kind: "page", pageId: "page-1" },
  title: "Research",
  expectedLocationRevision: 3,
  dragOverlay: null,
} as const;

describe("Sidebar Library drop semantics", () => {
  test("separates ownership moves from Project grants", () => {
    expect(resolveSidebarLibraryDropDecision(resource, {
      kind: "sidebar-library-ownership-target",
      parent: { kind: "library" },
    }, null)).toMatchObject({ kind: "move", parent: { kind: "library" } });

    expect(resolveSidebarLibraryDropDecision(resource, undefined, "project-2"))
      .toMatchObject({ kind: "grant", projectId: "project-2" });
  });

  test("rejects self-parenting and unrelated targets", () => {
    expect(resolveSidebarLibraryDropDecision(resource, {
      kind: "sidebar-library-ownership-target",
      parent: {
        kind: "page",
        pageId: "page-1",
        expectedDocumentGeneration: 1,
        expectedDocumentHeadSeq: 2,
      },
    }, null, true)).toEqual({ kind: "reject" });
    expect(resolveSidebarLibraryDropDecision(undefined, undefined, "project-2"))
      .toEqual({ kind: "reject" });
  });
});
