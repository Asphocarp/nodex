import { describe, expect, test } from "vitest";

import {
  buildDatabaseListRowCommands,
  buildDatabaseListSelectionCommands,
  databaseListMoveDirection,
} from "./database-list-commands";

describe("Database List command registry", () => {
  test("shares the same ordered move commands between a row and a bulk selection", () => {
    const capabilities = { canMoveUp: false, canMoveDown: true };
    const rowMoves = buildDatabaseListRowCommands({
      ...capabilities,
      selected: false,
    }).filter((command) => command.section === "position");
    const selectionMoves = buildDatabaseListSelectionCommands(capabilities);

    expect(rowMoves).toEqual(selectionMoves);
    expect(selectionMoves.map((command) => [command.id, command.disabled])).toEqual([
      ["move-top", true],
      ["move-up", true],
      ["move-down", false],
      ["move-bottom", false],
    ]);
  });

  test("describes selection state and resolves only movement commands", () => {
    const commands = buildDatabaseListRowCommands({
      selected: true,
      canMoveUp: true,
      canMoveDown: true,
    });

    expect(commands.find((command) => command.id === "toggle-selection")?.label)
      .toBe("Remove from selection");
    expect(databaseListMoveDirection("move-bottom")).toBe("bottom");
    expect(databaseListMoveDirection("open")).toBeNull();
  });

  test("offers Page-key copy only when the row has a current key", () => {
    const capabilities = {
      selected: false,
      canMoveUp: true,
      canMoveDown: true,
    };

    expect(buildDatabaseListRowCommands(capabilities)
      .some((command) => command.id === "copy-page-key")).toBe(false);
    expect(buildDatabaseListRowCommands({ ...capabilities, hasPageKey: true })
      .find((command) => command.id === "copy-page-key")?.label).toBe("Copy Page key");
  });
});
