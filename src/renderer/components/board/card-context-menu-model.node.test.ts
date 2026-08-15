import { describe, expect, test } from "vitest";
import {
  getPageActionMenuEntries,
} from "./card-context-menu-model";

describe("card context menu model", () => {
  test("returns only real actions in production order when search is empty", () => {
    const actions = getPageActionMenuEntries({ query: "", showMockActions: false });

    expect(actions.map((action) => action.label).join(",")).toBe(
      [
        "Open Page",
        "Open in New Chat",
        "Send Page to Chat…",
        "Copy Page key",
        "Copy deeplink",
        "Delete",
      ].join(","),
    );
    expect(actions.some((action) => action.mockReason !== undefined)).toBe(false);
  });

  test("keeps mock actions disabled and marked in dev order", () => {
    const actions = getPageActionMenuEntries({ query: "", showMockActions: true });
    const duplicate = actions.find((action) => action.id === "duplicate");

    expect(actions.map((action) => action.label).join(",")).toBe(
      [
        "Add to Favorites",
        "Edit icon",
        "Layout",
        "Property visibility",
        "Open Page",
        "Open in New Chat",
        "Send Page to Chat…",
        "Copy Page key",
        "Copy deeplink",
        "Duplicate",
        "Delete",
      ].join(","),
    );
    expect(duplicate?.disabled).toBe(true);
    expect(Boolean(duplicate?.mockReason)).toBe(true);
  });

  test("keeps delete and copy deeplink enabled for real actions", () => {
    const actions = getPageActionMenuEntries({ query: "", showMockActions: false });
    const copyLink = actions.find((action) => action.id === "copy-link");
    const deleteAction = actions.find((action) => action.id === "delete");

    expect(copyLink?.disabled ?? false).toBe(false);
    expect(deleteAction?.disabled ?? false).toBe(false);
  });

  test("filters action entries by label and keyword matches", () => {
    const actions = getPageActionMenuEntries({ query: "link", showMockActions: false });

    expect(actions.map((action) => action.label).join(",")).toBe("Copy deeplink");
  });

  test("keeps the new chat actions searchable by their intent", () => {
    expect(
      getPageActionMenuEntries({ query: "new chat", showMockActions: false })
        .map((action) => action.id),
    ).toEqual(["open-in-new-chat"]);
    expect(
      getPageActionMenuEntries({ query: "send", showMockActions: false })
        .map((action) => action.id),
    ).toEqual(["send-to-chat"]);
  });

  test("filters mock action entries only when mock actions are visible", () => {
    const productionActions = getPageActionMenuEntries({ query: "favorite", showMockActions: false });
    const devActions = getPageActionMenuEntries({ query: "favorite", showMockActions: true });

    expect(productionActions.length).toBe(0);
    expect(devActions.map((action) => action.label).join(",")).toBe("Add to Favorites");
  });

});
