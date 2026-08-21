import { describe, expect, test } from "vite-plus/test";

import {
  buildDatabaseListSelectionCommands,
  databaseListMoveDirection,
} from "./database-list-commands";

describe("Database List command registry", () => {
  test("builds the stable ordered move commands for a bulk selection", () => {
    const capabilities = { canMoveUp: false, canMoveDown: true };
    const selectionMoves = buildDatabaseListSelectionCommands(capabilities);

    expect(selectionMoves.map((command) => [command.id, command.disabled])).toEqual([
      ["move-top", true],
      ["move-up", true],
      ["move-down", false],
      ["move-bottom", false],
    ]);
  });

  test("resolves movement command directions", () => {
    expect(databaseListMoveDirection("move-bottom")).toBe("bottom");
  });
});
