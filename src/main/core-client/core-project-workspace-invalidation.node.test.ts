import { describe, expect, test } from "vitest";
import {
  allProjectSessionInvalidation,
  planCoreWorkspaceNotifications,
} from "./core-project-workspace-invalidation";

describe("Core Workspace notification planning", () => {
  test("preserves every old and new Session scope across a move", () => {
    expect(planCoreWorkspaceNotifications({
      projectIds: ["project:a", "project:b"],
      sessionIds: ["session:one"],
      threadIds: ["thread:one"],
      sessionSummaryScopes: [
        { kind: "project", projectId: "project:a" },
        { kind: "project", projectId: "project:b" },
      ],
      sessionDetailIds: ["session:one"],
    }).sessions).toEqual({
      summaryScopes: [
        { kind: "project", projectId: "project:a" },
        { kind: "project", projectId: "project:b" },
      ],
      detailInvalidation: {
        kind: "sessions",
        sessionIds: ["session:one"],
      },
      changeType: "update",
    });
  });

  test("maps catalog semantics without collapsing them to a generic update", () => {
    expect(planCoreWorkspaceNotifications({
      projectCatalogChange: "sources_updated",
      projectIds: ["project:a"],
      sessionIds: [],
      threadIds: [],
      sessionSummaryScopes: [],
      sessionDetailIds: [],
    }).project).toEqual({
      projectId: "project:a",
      changeType: "sources",
    });
  });

  test("uses a global summary scope when durable history must be resynced", () => {
    expect(allProjectSessionInvalidation()).toEqual({
      summaryScopes: [{ kind: "all" }],
      detailInvalidation: { kind: "all" },
      changeType: "update",
    });
  });
});
