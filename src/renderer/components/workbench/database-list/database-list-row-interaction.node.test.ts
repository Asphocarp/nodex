import { describe, expect, test } from "vitest";

import { resolveDatabaseListRowDropPosition } from "./database-list-row-interaction";

describe("Database List row pointer intent", () => {
  test.each([
    { clientY: 100, expected: "before" },
    { clientY: 121.999, expected: "before" },
    { clientY: 122, expected: "after" },
    { clientY: 143, expected: "after" },
  ] as const)(
    "keeps an ordinary row drop in the $expected reorder zone at y=$clientY",
    ({ clientY, expected }) => {
      expect(resolveDatabaseListRowDropPosition({
        clientY,
        rowTop: 100,
        rowHeight: 44,
        explicitNest: false,
      })).toBe(expected);
    },
  );

  test("uses an explicit Option/Alt gesture for nesting", () => {
    expect(resolveDatabaseListRowDropPosition({
      clientY: 100,
      rowTop: 100,
      rowHeight: 44,
      explicitNest: true,
    })).toBe("nest");
    expect(resolveDatabaseListRowDropPosition({
      clientY: 143,
      rowTop: 100,
      rowHeight: 44,
      explicitNest: true,
    })).toBe("nest");
  });

  test("falls back to an after insertion instead of nesting without layout", () => {
    expect(resolveDatabaseListRowDropPosition({
      clientY: 0,
      rowTop: 0,
      rowHeight: 0,
      explicitNest: false,
    })).toBe("after");
  });
});
