import { describe, expect, test } from "vitest";
import type { BoardSummary, DatabasePageSummary, Project } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../../shared/block-documents/portable-rich-text";
import {
  buildNfmMoveToSections,
  flattenNfmMoveToRows,
  getDefaultNfmMoveToExpandedProjectIds,
  getInitialNfmMoveToFocusedRowId,
  moveNfmMoveToFocusedRowId,
  resolveNfmMoveToFocusedRowId,
} from "./nfm-move-to-menu-model";

const TEST_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeProject(
  id: string,
  name: string,
  icon?: "heart" | "plant",
): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name,
    description: "",
    appearance: icon
      ? { color: "black", marker: { kind: "icon", icon } }
      : { color: "black", marker: { kind: "icon", icon: "folder" } },
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: TEST_DATE,
    updated: TEST_DATE,
  };
}

function makePage(
  id: string,
  title: string,
  status: DatabasePageSummary["status"],
  order: number,
  overrides: Partial<DatabasePageSummary> = {},
): DatabasePageSummary {
  const effectiveTitle = overrides.title ?? title;
  return {
    id,
    status,
    archived: false,
    title: effectiveTitle,
    richTitle: plainTextToPortableRichText(effectiveTitle),
    tags: [],
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
  makeProject("alpha", "Alpha DB", "heart"),
  makeProject("beta", "Beta DB", "plant"),
];

const BOARD_MAP = new Map<string, BoardSummary>([
  [
    "alpha",
    {
      columns: [
        {
          id: "triage",
          name: "Triage",
          cards: [
            makePage("source-page", "Source", "triage", 0),
            makePage("draft-spec", "Triage spec", "triage", 1),
            makePage("command-palette", "Command palette polish", "triage", 2, {
              tags: ["secret-tag"],
              assignee: "alex",
              descriptionPreview: "Hidden body-only OCR pipeline note.",
              descriptionLength: "Hidden body-only OCR pipeline note.".length,
              hasDescription: true,
            }),
          ],
        },
        {
          id: "ship",
          name: "Ship",
          cards: [makePage("ship-plan", "Ship plan", "ship", 0)],
        },
      ],
    },
  ],
  [
    "beta",
    {
      columns: [
        {
          id: "plan",
          name: "Plan",
          cards: [makePage("runtime", "Runtime polish", "plan", 0)],
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
    sourcePageId: "source-page",
    expandedProjectIds,
    query,
  });
}

describe("nfm move-to menu model", () => {
  test("keeps DB before Page and expands the source project by default", () => {
    const sections = buildSections();
    const rows = flattenNfmMoveToRows(sections);

    expect(sections.map((section) => section.label).join(",")).toBe("DB,Page");
    expect(rows.map((row) => row.id).join(",")).toBe(
      "db:alpha,db-column:alpha:triage,db-column:alpha:ship,db:beta,page:alpha:draft-spec,page:alpha:command-palette,page:alpha:ship-plan,page:beta:runtime",
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

  test("filters DB, column, and page rows while excluding the source page", () => {
    const pageRows = flattenNfmMoveToRows(buildSections("runtime"));
    const columnRows = flattenNfmMoveToRows(buildSections("ship"));
    const projectRows = flattenNfmMoveToRows(buildSections("beta"));
    const sourceRows = flattenNfmMoveToRows(buildSections("source"));

    expect(pageRows.map((row) => row.id).join(",")).toBe("page:beta:runtime");
    expect(columnRows.map((row) => row.id).join(",")).toBe("db:alpha,db-column:alpha:ship,page:alpha:ship-plan");
    expect(projectRows.map((row) => row.id).join(",")).toBe("db:beta,db-column:beta:plan,page:beta:runtime");
    expect(sourceRows.map((row) => row.id).join(",")).toBe("");
  });

  test("can restrict results to DB destinations for Page in", () => {
    const pageTitleSections = buildNfmMoveToSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      sourceProjectId: "alpha",
      sourcePageId: "source-page",
      expandedProjectIds: new Set(["alpha"]),
      query: "runtime",
      resultScope: "db-only",
    });
    const dbSections = buildNfmMoveToSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      sourceProjectId: "alpha",
      sourcePageId: "source-page",
      expandedProjectIds: new Set(["alpha"]),
      query: "beta",
      resultScope: "db-only",
    });
    const pageTitleRows = flattenNfmMoveToRows(pageTitleSections);
    const dbRows = flattenNfmMoveToRows(dbSections);

    expect(pageTitleSections.map((section) => section.label).join(",")).toBe("DB");
    expect(pageTitleRows.map((row) => row.id).join(",")).toBe("");
    expect(dbRows.map((row) => row.id).join(",")).toBe("db:beta,db-column:beta:plan");
  });

  test("uses command-palette-style fuzzy and prefix page search without description-only fields", () => {
    const fuzzyRows = flattenNfmMoveToRows(buildSections("commnd pal"));
    const descriptionRows = flattenNfmMoveToRows(buildSections("ocr pipeline"));
    const tagRows = flattenNfmMoveToRows(buildSections("secret-tag"));
    const assigneeRows = flattenNfmMoveToRows(buildSections("alex"));

    expect(fuzzyRows.map((row) => row.id).join(",")).toBe("page:alpha:command-palette");
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
