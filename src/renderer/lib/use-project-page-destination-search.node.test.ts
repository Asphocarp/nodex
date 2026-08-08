import { describe, expect, test } from "vitest";
import type { Project } from "./types";
import {
  buildRemoteDestinationSearchResult,
  mergeDestinationSearchResults,
} from "./use-project-page-destination-search";
import { DEFAULT_PROJECT_APPEARANCE } from "../../shared/project-appearance";

const TEST_DATE = new Date("2026-07-25T00:00:00.000Z");

function makeProject(id: string, name: string): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: `database:${id}`,
    defaultDatabaseViewId: `view:${id}`,
    lifecycle: "active",
    bindingRevision: 1,
    name,
    description: "",
    appearance: DEFAULT_PROJECT_APPEARANCE,
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: TEST_DATE,
    updated: TEST_DATE,
  };
}

describe("Project Page destination search", () => {
  test("maps bounded Core search hits without hydrating every Project board", () => {
    const result = buildRemoteDestinationSearchResult({
      projects: [makeProject("alpha", "Alpha"), makeProject("beta", "Beta")],
      query: "release notes",
      results: [{
        projectId: "beta",
        pageId: "page:release",
        pageKey: "BETA-7",
        matchedPageKey: "BETA-7",
        matchedPageKeyIsCurrent: true,
        title: "Release notes",
        status: "review",
        score: 1_000_000,
        excerpt: "Review release notes before shipping.",
      }],
    });

    expect(result.pageHits).toEqual([{
      id: "page:beta:page:release",
      projectId: "beta",
      projectName: "Beta",
      projectAppearance: DEFAULT_PROJECT_APPEARANCE,
      columnId: "review",
      columnName: "Review",
      pageId: "page:release",
      pageKey: "BETA-7",
      matchedPageKey: "BETA-7",
      matchedPageKeyIsCurrent: true,
      pageTitle: "Release notes",
      boardOrder: 0,
      score: 1_000_000,
    }]);
  });

  test("merges server hits with already-loaded local matches by stable Page identity", () => {
    const local = buildRemoteDestinationSearchResult({
      projects: [makeProject("alpha", "Alpha")],
      query: "release",
      results: [{
        projectId: "alpha",
        pageId: "page:release",
        pageKey: "RND-7",
        matchedPageKey: "LAB-7",
        matchedPageKeyIsCurrent: false,
        title: "Stale title",
        status: "build",
        score: 5,
        excerpt: "release",
      }],
    });
    const remote = buildRemoteDestinationSearchResult({
      projects: [makeProject("alpha", "Alpha")],
      query: "release",
      results: [{
        projectId: "alpha",
        pageId: "page:release",
        pageKey: null,
        matchedPageKey: null,
        matchedPageKeyIsCurrent: null,
        title: "Canonical title",
        status: "review",
        score: 1_000_000,
        excerpt: "release",
      }],
    });

    const result = mergeDestinationSearchResults(local, remote);
    expect(result.pageHits).toHaveLength(1);
    expect(result.pageHits[0]).toMatchObject({
      pageTitle: "Canonical title",
      columnId: "review",
      pageKey: "RND-7",
      matchedPageKey: "LAB-7",
      matchedPageKeyIsCurrent: false,
    });
  });
});
