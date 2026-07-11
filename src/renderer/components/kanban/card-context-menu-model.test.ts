import { describe, expect, test } from "vitest";
import {
  getCardActionMenuEntries,
  getCardMoveTargets,
} from "./card-context-menu-model";

describe("card context menu model", () => {
  test("returns only real actions in production order when search is empty", () => {
    const actions = getCardActionMenuEntries({ query: "", showMockActions: false });

    expect(actions.map((action) => action.label).join(",")).toBe(
      [
        "Copy deeplink",
        "Move to",
        "Delete",
      ].join(","),
    );
    expect(actions.some((action) => action.mockReason !== undefined)).toBe(false);
  });

  test("keeps mock actions disabled and marked in dev order", () => {
    const actions = getCardActionMenuEntries({ query: "", showMockActions: true });
    const duplicate = actions.find((action) => action.id === "duplicate");

    expect(actions.map((action) => action.label).join(",")).toBe(
      [
        "Add to Favorites",
        "Edit icon",
        "Edit property",
        "Layout",
        "Property visibility",
        "Open in",
        "Copy deeplink",
        "Duplicate",
        "Move to",
        "Delete",
      ].join(","),
    );
    expect(duplicate?.disabled).toBe(true);
    expect(Boolean(duplicate?.mockReason)).toBe(true);
  });

  test("keeps delete and copy deeplink enabled for real actions", () => {
    const actions = getCardActionMenuEntries({ query: "", showMockActions: false });
    const copyLink = actions.find((action) => action.id === "copy-link");
    const deleteAction = actions.find((action) => action.id === "delete");

    expect(copyLink?.disabled ?? false).toBe(false);
    expect(deleteAction?.disabled ?? false).toBe(false);
  });

  test("filters action entries by label and keyword matches", () => {
    const actions = getCardActionMenuEntries({ query: "project", showMockActions: false });

    expect(actions.map((action) => action.label).join(",")).toBe("Move to");
  });

  test("filters mock action entries only when mock actions are visible", () => {
    const productionActions = getCardActionMenuEntries({ query: "favorite", showMockActions: false });
    const devActions = getCardActionMenuEntries({ query: "favorite", showMockActions: true });

    expect(productionActions.length).toBe(0);
    expect(devActions.map((action) => action.label).join(",")).toBe("Add to Favorites");
  });

  test("builds move targets with current-project state and metadata", () => {
    const targets = getCardMoveTargets(
      [
        { id: "default", name: "Default", description: "Core workspace" },
        { id: "ops", name: "Ops", primaryWorkspaceRoot: "/work/ops" },
        { id: "research", name: "Research" },
      ],
      "ops",
      "",
    );

    expect(targets.map((target) => target.label).join(",")).toBe("Default,Ops,Research");
    expect(targets[1]?.description).toBe("Current project · /work/ops");
    expect(targets[1]?.disabled).toBe(true);
    expect(targets[2]?.description).toBe("Project");
  });

  test("filters move targets without disturbing project order", () => {
    const targets = getCardMoveTargets(
      [
        { id: "default", name: "Default", description: "Core workspace" },
        { id: "ops", name: "Ops", primaryWorkspaceRoot: "/work/ops" },
        { id: "research", name: "Research" },
      ],
      "default",
      "/work",
    );

    expect(targets.map((target) => target.label).join(",")).toBe("Ops");
  });
});
