import { describe, expect, test } from "vitest";
import {
  PRIORITY_VALUES,
  comparePriorities,
  isPriority,
  parsePriority,
  priorityRank,
} from "./priority";

describe("priority", () => {
  test("defines the four assigned levels in stable rank order", () => {
    expect(PRIORITY_VALUES).toEqual(["p0-critical", "p1-high", "p2-medium", "p3-low"]);
    expect(PRIORITY_VALUES.map(priorityRank)).toEqual([0, 1, 2, 3]);
    expect(comparePriorities("p0-critical", "p3-low")).toBeLessThan(0);
  });

  test("accepts current priorities and rejects retired or malformed values", () => {
    for (const priority of PRIORITY_VALUES) {
      expect(isPriority(priority)).toBe(true);
      expect(parsePriority(priority)).toBe(priority);
    }

    for (const value of ["p4-later", "unknown", null, 4, {}]) {
      expect(isPriority(value)).toBe(false);
      expect(() => parsePriority(value)).toThrow(TypeError);
    }
  });
});
