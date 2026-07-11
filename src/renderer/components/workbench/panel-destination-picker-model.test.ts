import { describe, expect, test } from "vitest";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import {
  buildPanelDestinationSections,
  flattenPanelDestinationRows,
  movePanelDestinationFocusedRowId,
  resolvePanelDestinationFocusedRowId,
} from "./panel-destination-picker-model";

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
): CardSummary {
  return {
    id,
    status,
    archived: false,
    title,
    tags: [],
    agentBlocked: false,
    created: TEST_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
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
            makeCard("command-palette", "Command palette polish", "draft", 0),
            makeCard("notes", "Meeting notes", "draft", 1),
          ],
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

describe("panel destination picker model", () => {
  test("keeps DB before Card for the combined panel picker", () => {
    const sections = buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "",
    });
    const rows = flattenPanelDestinationRows(sections);

    expect(sections.map((section) => section.label).join(",")).toBe("DB,Card");
    expect(rows.map((row) => row.id).join(",")).toBe(
      "panel-db:alpha,panel-db:beta,panel-card:alpha:command-palette,panel-card:alpha:notes,panel-card:beta:runtime",
    );
  });

  test("supports DB-only and card-only scopes", () => {
    const dbOnly = buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "",
      scope: "db-only",
    });
    const cardOnly = buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "",
      scope: "card-only",
    });

    expect(dbOnly.map((section) => section.label).join(",")).toBe("DB");
    expect(flattenPanelDestinationRows(dbOnly).map((row) => row.kind).join(",")).toBe("db,db");
    expect(cardOnly.map((section) => section.label).join(",")).toBe("Card");
    expect(flattenPanelDestinationRows(cardOnly).map((row) => row.kind).join(",")).toBe("card,card,card");
  });

  test("groups card-only rows with the current project first", () => {
    const sections = buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "",
      scope: "card-only",
      currentProjectId: "beta",
    });
    const rows = flattenPanelDestinationRows(sections);

    expect(sections.map((section) => section.label).join(",")).toBe("Current project,Other projects");
    expect(rows.map((row) => row.id).join(",")).toBe(
      "panel-card:beta:runtime,panel-card:alpha:command-palette,panel-card:alpha:notes",
    );
  });

  test("keeps search ranking inside current-project card groups", () => {
    const sections = buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "polish",
      scope: "card-only",
      currentProjectId: "beta",
    });
    const rows = flattenPanelDestinationRows(sections);

    expect(sections.map((section) => section.label).join(",")).toBe("Current project,Other projects");
    expect(rows.map((row) => row.id).join(",")).toBe(
      "panel-card:beta:runtime,panel-card:alpha:command-palette",
    );
  });

  test("omits the current-project group when it has no card matches", () => {
    const sections = buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "runtime",
      scope: "card-only",
      currentProjectId: "alpha",
    });
    const rows = flattenPanelDestinationRows(sections);

    expect(sections.map((section) => section.label).join(",")).toBe("Other projects");
    expect(rows.map((row) => row.id).join(",")).toBe("panel-card:beta:runtime");
  });

  test("uses shared fuzzy search semantics for card rows", () => {
    const sections = buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "commnd pal",
      scope: "card-only",
    });
    const rows = flattenPanelDestinationRows(sections);

    expect(rows.map((row) => row.id).join(",")).toBe("panel-card:alpha:command-palette");
  });

  test("resets query focus to the first visible row and wraps arrow movement", () => {
    const rows = flattenPanelDestinationRows(buildPanelDestinationSections({
      projects: PROJECTS,
      boardMap: BOARD_MAP,
      query: "beta",
    }));
    const initial = resolvePanelDestinationFocusedRowId(null, "beta", rows);

    expect(initial).toBe("panel-db:beta");
    expect(movePanelDestinationFocusedRowId(initial, 1, rows)).toBe("panel-card:beta:runtime");
    expect(movePanelDestinationFocusedRowId("panel-card:beta:runtime", 1, rows)).toBe("panel-db:beta");
  });
});
