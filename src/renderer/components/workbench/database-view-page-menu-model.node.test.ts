import { describe, expect, test } from "vite-plus/test";

import {
  buildDatabaseViewPageMenuEntries,
  databaseViewPageMoveDirection,
  filterDatabaseViewPageMenuEntries,
} from "./database-view-page-menu-model";

const capabilities = {
  hasPageKey: true,
  canMoveUp: false,
  canMoveDown: true,
  canCopyMarkdown: true,
  canOpenInNewChat: true,
  canSendToChat: true,
  canDelete: true,
};

describe("Database View Page menu model", () => {
  test("builds the shared Page hierarchy in product order", () => {
    const actions = buildDatabaseViewPageMenuEntries(capabilities);

    expect(actions.map((action) => action.label)).toEqual(["Open in", "Copy", "Move", "Delete"]);
    expect(
      actions
        .find((action) => action.id === "move")
        ?.children?.map((action) => [action.label, action.disabled]),
    ).toEqual([
      ["Move to top", true],
      ["Move up", true],
      ["Move down", false],
      ["Move to bottom", false],
    ]);
    expect(
      actions.find((action) => action.id === "copy")?.children?.map((action) => action.label),
    ).toEqual(["Copy ID", "Copy deeplink", "Copy title", "Copy content as Markdown"]);
    expect(
      actions.find((action) => action.id === "open-in")?.children?.map((action) => action.label),
    ).toEqual(["Open in new chat", "Send to chat…"]);
  });

  test("does not invent an ID when a Page has no current key", () => {
    const actions = buildDatabaseViewPageMenuEntries({
      ...capabilities,
      hasPageKey: false,
    });

    expect(
      actions
        .find((action) => action.id === "copy")
        ?.children?.some((action) => action.id === "copy-id"),
    ).toBe(false);
  });

  test("keeps a parent trigger and only matching descendants during search", () => {
    const actions = filterDatabaseViewPageMenuEntries(
      buildDatabaseViewPageMenuEntries(capabilities),
      "markdown",
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("copy");
    expect(actions[0]?.children?.map((action) => action.id)).toEqual(["copy-markdown"]);
  });

  test("matching a parent keeps its complete submenu", () => {
    const actions = filterDatabaseViewPageMenuEntries(
      buildDatabaseViewPageMenuEntries(capabilities),
      "move",
    );

    expect(actions.map((action) => action.id)).toEqual(["move"]);
    expect(actions[0]?.children).toHaveLength(4);
    expect(databaseViewPageMoveDirection("move-bottom")).toBe("bottom");
    expect(databaseViewPageMoveDirection("copy-title")).toBeNull();
  });
});
