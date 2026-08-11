import { describe, expect, test } from "vitest";

import {
  databasePropertyListInlineLabelLimit,
  databasePropertyListOptionDotColor,
} from "./property-list-chip";

describe("Database List property chip presentation", () => {
  test("uses the List label limits at the reference viewport boundaries", () => {
    expect(databasePropertyListInlineLabelLimit(640)).toBe(2);
    expect(databasePropertyListInlineLabelLimit(641)).toBe(3);
    expect(databasePropertyListInlineLabelLimit(1_024)).toBe(3);
    expect(databasePropertyListInlineLabelLimit(1_025)).toBe(4);
    expect(databasePropertyListInlineLabelLimit(1_399)).toBe(4);
    expect(databasePropertyListInlineLabelLimit(1_400)).toBe(6);
  });

  test("preserves explicit CSS colors and maps named option colors", () => {
    expect(databasePropertyListOptionDotColor("#BB87FC", "feature")).toBe("#BB87FC");
    expect(databasePropertyListOptionDotColor("lch(66% 80 48)", "date")).toBe(
      "lch(66% 80 48)",
    );
    expect(databasePropertyListOptionDotColor("purple", "feature")).toBe("#BB87FC");
    expect(databasePropertyListOptionDotColor(undefined, "feature")).toMatch(/^#[0-9A-F]{6}$/);
  });
});
