import { describe, expect, test } from "vitest";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import {
  buildNfmMoveToSections,
  flattenNfmMoveToRows,
  getDefaultNfmMoveToExpandedProjectIds,
  getInitialNfmMoveToFocusedRowId,
  moveNfmMoveToFocusedRowId,
  resolveNfmMoveToFocusedRowId,
} from "./nfm-move-to-menu-model";

const TEST_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeProject(id: string, name: string, icon?: string): Project {
  return {
    id,
    name,
    description: "",
    icon,
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: TEST_DATE,
    updated: TEST_DATE,
  };
}

function makeCard(
  id: string,
  title: string,
  status: CardSummary["status"],
  order: number,
  overrides: Partial<CardSummary> = {},
): CardSummary {
  const effectiveTitle = overrides.title ?? title;
  return {
    id,
    status,
    archived: false,
    title: effectiveTitle,
    richTitle: plainTextToPortableRichText(effectiveTitle),
    tags: [],
    agentBlocked: false,
    created: TEST_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
    ...overrides,
  };
}

const PROJECTS = [
  makeProject("alpha", "Alpha DB", "A"),
  makeProject("beta", "Beta DB", "B"),
];

const BOARD_MAP = new Map<string, BoardSummary>([
  [
    "alpha",
    {
      columns: [
        {
          id: "draft",
          name: "Draft",
          cards: [
            makeCard("source-card", "Source", "draft", 0),
            makeCard("draft-spec", "Draft spec", "draft", 1),
            makeCard("command-palette", "Command palette polish", "draft", 2, {
              tags: ["secret-tag"],
              assignee: "alex",
              agentStatus: "Waiting on hidden telemetry",
              descriptionPreview: "Hidden body-only OCR pipeline note.",
              descriptionLength: "Hidden body-only OCR pipeline note.".length,
              hasDescription: true,
            }),
          ],
        },
        {
          id: "done",
          name: "Done",
          cards: [makeCard("ship-plan", "Ship plan", "done", 0)],
        },
      ],
    },
  ],
  [
    "beta",
    {
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          cards: [makeCard("runtime", "Runtime polish", "backlog", 0)],
        },
      ],
    },
  ],
]);

function buildSections(query = "", expandedProjectIds = new Set(["alpha"])) {
  return buildNfmMoveToSections({
    projects: PROJECTS,
    boardMap: BOARD_MAP,
    sourceProjectId: "alpha",
    sourceCardId: "source-card",
    expandedProjectIds,
    query,
  });
}

describe("nfm move-to menu model", () => {
  test("keeps DB before Card and expands the source project by default", () => {
    const sections = buildSections();
    const rows = flattenNfmMoveToRows(sections);

    expect(sections.map((section) => section.label).join(",")).toBe("DB,Card");
    expect(rows.map((row) => row.id).join(",")).toBe(
      "db:alpha,db-column:alpha:draft,db-column:alpha:done,db:beta,card:alpha:draft-spec,card:alpha:command-palette,card:alpha:ship-plan,card:beta:runtime",
    );
    expect(rows[0]?.kind).toBe("db");
    const firstRow = rows[0];
    if (!firstRow || firstRow.kind !== "db") throw new Error("First row is not a DB row.");
    expect(firstRow.expanded).toBe(true);
  });

  test("creates the default expansion set from the source project when possible", () => {
    const expanded = getDefaultNfmMoveToExpandedProjectIds(PROJECTS, "beta");

    expect(expanded.has("beta")).toBe(true);
    expect(expanded.has("alpha")).toBe(false);
  });

  test("filters DB, column, and card rows while excluding the source card", () => {
    const cardRows = flattenNfmMoveToRows(buildSections("runtime"));
    const columnRows = flattenNfmMoveToRows(buildSections("done"));
    const projectRows = flattenNfmMoveToRows(buildSections("beta"));
    const sourceRows = flattenNfmMoveToRows(buildSections("source"));

    expect(cardRows.map((row) => row.id).join(",")).toBe("card:beta:runtime");
    expect(columnRows.map((row) => row.id).join(",")).toBe("db:alpha,db-column:alpha:done,card:alpha:ship-plan");
    expect(projectRows.map((row) => row.id).join(",")).toBe("db:beta,db-column:beta:backlog,card:beta:runtime");
    expect(sourceRows.map((row) => row.id).join(",")).toBe("");
  });

  test("can restrict results to DB destinations for Card in", () => {
    const cardTitleSections = buildNfmMoveToSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      sourceProjectId: "alpha",
      sourceCardId: "source-card",
      expandedProjectIds: new Set(["alpha"]),
      query: "runtime",
      resultScope: "db-only",
    });
    const dbSections = buildNfmMoveToSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      sourceProjectId: "alpha",
      sourceCardId: "source-card",
      expandedProjectIds: new Set(["alpha"]),
      query: "beta",
      resultScope: "db-only",
    });
    const cardTitleRows = flattenNfmMoveToRows(cardTitleSections);
    const dbRows = flattenNfmMoveToRows(dbSections);

    expect(cardTitleSections.map((section) => section.label).join(",")).toBe("DB");
    expect(cardTitleRows.map((row) => row.id).join(",")).toBe("");
    expect(dbRows.map((row) => row.id).join(",")).toBe("db:beta,db-column:beta:backlog");
  });

  test("uses command-palette-style fuzzy and prefix card search without description-only fields", () => {
    const fuzzyRows = flattenNfmMoveToRows(buildSections("commnd pal"));
    const descriptionRows = flattenNfmMoveToRows(buildSections("ocr pipeline"));
    const tagRows = flattenNfmMoveToRows(buildSections("secret-tag"));
    const assigneeRows = flattenNfmMoveToRows(buildSections("alex"));

    expect(fuzzyRows.map((row) => row.id).join(",")).toBe("card:alpha:command-palette");
    expect(descriptionRows.map((row) => row.id).join(",")).toBe("");
    expect(tagRows.map((row) => row.id).join(",")).toBe("");
    expect(assigneeRows.map((row) => row.id).join(",")).toBe("");
  });

  test("uses query focus reset and wrapping row-id navigation", () => {
    const rows = flattenNfmMoveToRows(buildSections());

    expect(getInitialNfmMoveToFocusedRowId("", rows) === null).toBe(true);
    expect(getInitialNfmMoveToFocusedRowId("ship", rows)).toBe("db:alpha");
    expect(resolveNfmMoveToFocusedRowId("missing", "ship", rows)).toBe("db:alpha");
    expect(moveNfmMoveToFocusedRowId(null, 1, rows)).toBe("db:alpha");
    expect(moveNfmMoveToFocusedRowId("db:alpha", -1, rows)).toBe(rows[rows.length - 1]?.id);
    expect(moveNfmMoveToFocusedRowId(rows[rows.length - 1]?.id ?? null, 1, rows)).toBe("db:alpha");
  });
});
