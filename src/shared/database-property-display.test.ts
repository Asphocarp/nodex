import { describe, expect, test } from "vite-plus/test";
import { formatDatabasePropertyDisplayValue } from "./database-property-display";

const config = {
  options: [
    { id: "p1", name: "High priority" },
    { id: "p2", name: "Later" },
  ],
};

describe("formatDatabasePropertyDisplayValue", () => {
  test("resolves select identities to canonical names without locale formatting", () => {
    expect(formatDatabasePropertyDisplayValue({ valueType: "select", config }, "p1")).toBe(
      "High priority",
    );
    expect(
      formatDatabasePropertyDisplayValue({ valueType: "multi_select", config }, ["p2", "p1"]),
    ).toBe("Later High priority");
    expect(
      formatDatabasePropertyDisplayValue({ valueType: "date", config: {} }, "2026-07-16"),
    ).toBe("2026-07-16");
    expect(formatDatabasePropertyDisplayValue({ valueType: "number", config: {} }, 12.5)).toBe(
      "12.5",
    );
  });
});
