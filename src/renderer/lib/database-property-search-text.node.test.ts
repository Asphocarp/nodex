import { describe, expect, test } from "vite-plus/test";

import { databasePropertyValueSearchText } from "./database-property-search-text";

describe("Database Property search text", () => {
  test("indexes registry labels without exposing canonical option identities", () => {
    expect(
      databasePropertyValueSearchText(["o_BBBBBBBB", "o_AAAAAAAA"], {
        optionBacked: true,
        options: [
          { id: "o_AAAAAAAA", name: "Product" },
          { id: "o_CCCCCCCC", name: "Not selected" },
        ],
      }),
    ).toBe("Unknown option Product");
    expect(databasePropertyValueSearchText(42)).toBe("42");
  });
});
