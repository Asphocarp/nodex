import { describe, expect, test } from "vitest";
import {
  deriveToggleListFilterRule,
  getDefaultToggleListSettings,
  normalizeToggleListSettings,
  resolveToggleListPrimarySort,
  resolveToggleListSecondarySort,
  setToggleListRulesV2,
} from "./settings";

describe("toggle-list settings rules v2", () => {
  test("ignores legacy persisted filter and rank fields", () => {
    const normalized = normalizeToggleListSettings({
      filter: {
        statuses: ["plan", "plan"],
        priorities: ["p0-critical", "p1-high"],
        tags: ["infra"],
        tagMode: "none",
        includeHostCard: true,
      },
      rank: {
        primary: "priority",
        primaryDirection: "asc",
        secondary: "created",
        secondaryDirection: "desc",
      },
      propertyOrder: ["status", "priority", "estimate", "tags"],
      hiddenProperties: ["estimate"],
      showEmptyEstimate: true,
    });

    const defaults = getDefaultToggleListSettings();
    expect(JSON.stringify(normalized.rulesV2)).toBe(JSON.stringify(defaults.rulesV2));
    expect(JSON.stringify(normalized.propertyOrder)).toBe(
      JSON.stringify(["status", "priority", "estimate", "tags"]),
    );
    expect(JSON.stringify(normalized.hiddenProperties)).toBe(JSON.stringify(["estimate"]));
    expect(normalized.showEmptyEstimate).toBe(true);
  });

  test("setToggleListRulesV2 keeps canonical rules only", () => {
    const defaults = getDefaultToggleListSettings();
    const next = setToggleListRulesV2(defaults, {
      mode: "advanced",
      includeHostCard: true,
      filter: {
        any: [
          {
            all: [
              { field: "status", op: "in", values: ["triage", "plan"] },
              { field: "priority", op: "in", values: ["p0-critical", "p1-high"] },
              { field: "tags", op: "hasNone", values: ["blocked"] },
            ],
          },
        ],
      },
      sort: [
        { field: "status", direction: "asc" },
        { field: "priority", direction: "asc" },
        { field: "created", direction: "desc" },
      ],
    });

    const derivedFilter = deriveToggleListFilterRule(next.rulesV2);
    expect(next.rulesV2.mode).toBe("advanced");
    expect(next.rulesV2.includeHostCard).toBe(true);
    expect(JSON.stringify(derivedFilter.statuses)).toBe(JSON.stringify(["triage", "plan"]));
    expect(JSON.stringify(derivedFilter.priorities)).toBe(
      JSON.stringify(["p0-critical", "p1-high"]),
    );
    expect(derivedFilter.includeEmptyPriority).toBe(false);
    expect(JSON.stringify(derivedFilter.tags)).toBe(JSON.stringify(["blocked"]));
    expect(derivedFilter.tagMode).toBe("none");
    expect(resolveToggleListPrimarySort(next.rulesV2).field).toBe("status");
    expect(resolveToggleListSecondarySort(next.rulesV2).field).toBe("priority");
  });

  test("normalizes legacy all-priority clauses to include empty priority", () => {
    const normalized = normalizeToggleListSettings({
      rulesV2: {
        mode: "advanced",
        includeHostCard: false,
        filter: {
          any: [
            {
              all: [
                {
                  field: "priority",
                  op: "in",
                  values: ["p0-critical", "p1-high", "p2-medium", "p3-low"],
                },
              ],
            },
          ],
        },
        sort: [{ field: "board-order", direction: "asc" }],
      },
    });

    const clause = normalized.rulesV2.filter.any[0]?.all[0];
    expect(clause && "includeEmpty" in clause ? clause.includeEmpty : false).toBe(true);
  });
});
