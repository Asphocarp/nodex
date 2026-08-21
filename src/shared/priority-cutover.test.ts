import { describe, expect, test } from "vitest";
import {
  legacyPrioritySelectionIncludesEveryAssigned,
  upgradeLegacyPriority,
} from "./priority-cutover";

describe("priority cutover", () => {
  test("maps retired P4 to the current lowest assigned priority", () => {
    expect(upgradeLegacyPriority("p4-later")).toBe("p3-low");
    expect(upgradeLegacyPriority("p0-critical")).toBe("p0-critical");
    expect(upgradeLegacyPriority("unknown")).toBeNull();
    expect(upgradeLegacyPriority(null)).toBeNull();
  });

  test("derives legacy include-empty semantics before collapsing P4 into P3", () => {
    expect(
      legacyPrioritySelectionIncludesEveryAssigned([
        "p0-critical",
        "p1-high",
        "p2-medium",
        "p3-low",
      ]),
    ).toBe(false);
    expect(
      legacyPrioritySelectionIncludesEveryAssigned([
        "p0-critical",
        "p1-high",
        "p2-medium",
        "p3-low",
        "p4-later",
      ]),
    ).toBe(true);
  });
});
