import { describe, expect, test } from "vite-plus/test";
import { getDefaultToggleListSettings } from "../../../lib/toggle-list/settings";
import type { BoardSummary, DatabasePageSummary } from "../../../lib/types";
import { plainTextToPortableRichText } from "../../../../shared/block-documents/portable-rich-text";
import {
  inferInlineViewDropImport,
  type InlineViewProjectedRow,
} from "./inline-view-drop-inference";

function makeCard(id: string, overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const title = overrides.title ?? `Card ${id}`;
  return {
    id,
    status: "triage",
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
    priority: "p2-medium",
    tags: [],
    created: new Date("2026-02-16T00:00:00.000Z"),
    order: 0,
    ...overrides,
    pageKey: overrides.pageKey ?? null,
  };
}

function makeBoard(): BoardSummary {
  return {
    columns: [
      {
        id: "triage",
        name: "Ideas",
        cards: [
          makeCard("ideas-1", { order: 0, priority: "p1-high", estimate: "s" }),
          makeCard("ideas-2", { order: 1, priority: "p1-high", estimate: "m" }),
        ],
      },
      {
        id: "plan",
        name: "Plan",
        cards: [makeCard("backlog-1", { order: 0, priority: "p3-low" })],
      },
    ],
  };
}

describe("inline view drop inference", () => {
  test("infers target column and insert index from pointed projected rows", () => {
    const settings = getDefaultToggleListSettings();
    const projectedRows: InlineViewProjectedRow[] = [
      { blockId: "row-1", pageId: "ideas-1", sourceStatus: "triage" },
      { blockId: "row-2", pageId: "ideas-2", sourceStatus: "triage" },
    ];

    const inferred = inferInlineViewDropImport({
      settings,
      projectedRows,
      insertRowIndex: 1,
      board: makeBoard(),
      cards: [{ title: "Dropped block" }],
    });

    expect(inferred.targetStatus).toBe("triage");
    expect(inferred.insertIndex).toBe(1);
  });

  test("falls back to first allowed status when no neighboring rows exist", () => {
    const settings = getDefaultToggleListSettings();
    settings.rulesV2 = {
      ...settings.rulesV2,
      filter: {
        any: [
          {
            all: [
              { field: "status", op: "in", values: ["plan"] },
              {
                field: "priority",
                op: "in",
                values: ["p0-critical", "p1-high", "p2-medium", "p3-low"],
              },
            ],
          },
        ],
      },
    };

    const inferred = inferInlineViewDropImport({
      settings,
      projectedRows: [],
      insertRowIndex: 0,
      board: makeBoard(),
      cards: [{ title: "Dropped block" }],
    });

    expect(inferred.targetStatus).toBe("plan");
    expect(inferred.insertIndex).toBe(undefined);
  });

  test("infers ranking defaults from nearest card when missing", () => {
    const settings = getDefaultToggleListSettings();
    settings.rulesV2 = {
      ...settings.rulesV2,
      sort: [
        { field: "priority", direction: "asc" },
        { field: "estimate", direction: "asc" },
      ],
    };

    const projectedRows: InlineViewProjectedRow[] = [
      { blockId: "row-1", pageId: "ideas-2", sourceStatus: "triage" },
    ];

    const inferred = inferInlineViewDropImport({
      settings,
      projectedRows,
      insertRowIndex: 0,
      board: makeBoard(),
      cards: [{ title: "Dropped block" }],
    });

    expect(inferred.cards[0]?.priority).toBe("p1-high");
    expect(inferred.cards[0]?.estimate).toBe("m");
  });

  test("infers null priority when the filter only allows empty priority", () => {
    const settings = getDefaultToggleListSettings();
    settings.rulesV2 = {
      ...settings.rulesV2,
      filter: {
        any: [
          {
            all: [
              { field: "status", op: "in", values: ["triage"] },
              { field: "priority", op: "in", values: [], includeEmpty: true },
            ],
          },
        ],
      },
    };

    const inferred = inferInlineViewDropImport({
      settings,
      projectedRows: [],
      insertRowIndex: 0,
      board: makeBoard(),
      cards: [{ title: "Dropped block" }],
    });

    expect("priority" in (inferred.cards[0] ?? {})).toBe(true);
    expect(inferred.cards[0]?.priority ?? null).toBe(null);
  });
});
