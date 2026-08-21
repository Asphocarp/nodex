import { describe, expect, test } from "vite-plus/test";

import { normalizeDatabaseViewPresentationPreferences } from "./database-view-presentation-preferences";

describe("Database View presentation preferences", () => {
  test("keeps valid View-local overrides when a sibling entry is stale", () => {
    expect(
      normalizeDatabaseViewPresentationPreferences({
        "view-valid": {
          layout: "list",
          layouts: {
            list: {
              fields: [{ kind: "property", propertyId: "priority" }],
            },
          },
        },
        "view-stale": { layout: "calendar" },
        "": { layout: "board" },
      }),
    ).toEqual({
      "view-valid": {
        layout: "list",
        layouts: {
          list: {
            fields: [{ kind: "property", propertyId: "priority" }],
          },
        },
      },
    });
  });
});
