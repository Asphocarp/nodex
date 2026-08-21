import { describe, expect, test } from "vite-plus/test";
import { mapCompatibleDatabasePropertyValue } from "./database-property-mapping";

describe("Database property mapping", () => {
  test("preserves stable option IDs and maps one unambiguous normalized name", () => {
    const source = {
      valueType: "select" as const,
      config: {
        options: [
          { id: "stable", name: "Stable" },
          { id: "source-review", name: "In Review" },
        ],
      },
    };
    const target = {
      valueType: "select" as const,
      config: {
        options: [
          { id: "stable", name: "Renamed" },
          { id: "target-review", name: "in review" },
        ],
      },
    };

    expect(mapCompatibleDatabasePropertyValue({ source, target, value: "stable" })).toEqual({
      compatible: true,
      value: "stable",
    });
    expect(
      mapCompatibleDatabasePropertyValue({
        source,
        target,
        value: "source-review",
      }),
    ).toEqual({ compatible: true, value: "target-review" });
  });

  test("fails closed for type changes, ambiguous options, and partial sets", () => {
    expect(
      mapCompatibleDatabasePropertyValue({
        source: { valueType: "number", config: {} },
        target: { valueType: "text", config: {} },
        value: 3,
      }),
    ).toEqual({ compatible: false });

    const source = {
      valueType: "multi_select" as const,
      config: {
        options: [
          { id: "one", name: "Same" },
          { id: "missing", name: "Missing" },
        ],
      },
    };
    const target = {
      valueType: "multi_select" as const,
      config: {
        options: [
          { id: "a", name: "Same" },
          { id: "b", name: "same" },
        ],
      },
    };
    expect(
      mapCompatibleDatabasePropertyValue({
        source,
        target,
        value: ["one", "missing"],
      }),
    ).toEqual({ compatible: false });
  });
});
