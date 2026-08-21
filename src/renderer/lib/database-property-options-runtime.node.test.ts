import { describe, expect, test } from "vitest";
import {
  mergePropertyOptionPages,
  propertyOptionWindowMatchesProjection,
} from "./database-property-options-runtime";

describe("Property option registry pagination", () => {
  test("appends pages in authority order and refreshes duplicate identities", () => {
    expect(
      mergePropertyOptionPages(
        [
          { id: "one", name: "One" },
          { id: "two", name: "Old" },
        ],
        [
          { id: "two", name: "Two" },
          { id: "three", name: "Three" },
        ],
      ),
    ).toEqual([
      { id: "one", name: "One" },
      { id: "two", name: "Two" },
      { id: "three", name: "Three" },
    ]);
  });

  test("rejects a continuation from a different authority projection", () => {
    expect(propertyOptionWindowMatchesProjection(null, 2)).toBe(true);
    expect(propertyOptionWindowMatchesProjection(2, 2)).toBe(true);
    expect(propertyOptionWindowMatchesProjection(1, 2)).toBe(false);
  });
});
