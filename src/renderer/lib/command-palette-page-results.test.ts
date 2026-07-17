import { describe, expect, test } from "vitest";
import type { CommandPalettePage } from "./command-palette";
import {
  buildCommandPalettePageItemsFromBoardSummaries,
  type CommandPalettePageDescriptionSearchBatch,
  selectCommandPalettePageResults,
} from "./command-palette-page-results";
import { createCommandPalettePageSearchIndex } from "./command-palette-page-search";
import type { BoardSummary, DatabasePageSummary, PageSearchResult, Project } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents";

function makePage(overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Add quick page switching and commands.";
  const title = overrides.title ?? "Polish command palette";
  return {
    id: overrides.id ?? "page-1",
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    descriptionPreview,
    descriptionLength: overrides.descriptionLength ?? descriptionPreview.length,
    hasDescription: overrides.hasDescription ?? descriptionPreview.length > 0,
    status: overrides.status ?? "build",
    archived: overrides.archived ?? false,
    priority: overrides.priority,
    estimate: overrides.estimate,
    tags: overrides.tags ?? ["search"],
    dueDate: overrides.dueDate,
    scheduledStart: overrides.scheduledStart,
    scheduledEnd: overrides.scheduledEnd,
    isAllDay: overrides.isAllDay ?? false,
    recurrence: overrides.recurrence,
    reminders: overrides.reminders ?? [],
    scheduleTimezone: overrides.scheduleTimezone,
    assignee: overrides.assignee,
    runInTarget: overrides.runInTarget ?? "localProject",
    runInLocalPath: overrides.runInLocalPath,
    runInBaseBranch: overrides.runInBaseBranch,
    runInWorktreePath: overrides.runInWorktreePath,
    runInEnvironmentPath: overrides.runInEnvironmentPath,
    revision: overrides.revision ?? 1,
    created: overrides.created ?? new Date("2026-03-13T00:00:00.000Z"),
    order: overrides.order ?? 0,
  };
}

function makePalettePage(overrides: Partial<CommandPalettePage> = {}): CommandPalettePage {
  const page = overrides.page ?? makePage();
  return {
    kind: "page",
    id: overrides.id ?? `${overrides.projectId ?? "default"}:${page.id}`,
    projectId: overrides.projectId ?? "default",
    projectName: overrides.projectName ?? "Default",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "In progress",
    page,
    inActiveProject: overrides.inActiveProject ?? true,
    recentIndex: overrides.recentIndex ?? null,
    boardIndex: overrides.boardIndex ?? 0,
  };
}

function makeProject(id: string, name: string): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: "database:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name,
    description: "",
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-13T00:00:00.000Z"),
    updated: new Date("2026-03-13T00:00:00.000Z"),
  };
}

function makeDescriptionResult(overrides: Partial<PageSearchResult> = {}): PageSearchResult {
  return {
    projectId: overrides.projectId ?? "default",
    pageId: overrides.pageId ?? "page-1",
    status: overrides.status ?? "build",
    score: overrides.score ?? -1,
    excerpt: overrides.excerpt ?? "Server excerpt",
  };
}

function makeDescriptionBatch(
  query: string,
  results: readonly PageSearchResult[],
): CommandPalettePageDescriptionSearchBatch {
  return {
    query,
    scopeKey: "",
    results,
    loading: false,
  };
}

describe("command palette page result selection", () => {
  test("returns metadata fuzzy and prefix matches through the shared page selector", () => {
    const target = makePalettePage({
      page: makePage({ id: "target", title: "Command palette page search" }),
    });
    const other = makePalettePage({
      page: makePage({ id: "other", title: "Terminal panel" }),
    });
    const pages = [other, target];
    const index = createCommandPalettePageSearchIndex(pages);

    const fuzzyResults = selectCommandPalettePageResults({
      query: "commnd palete",
      pages,
      pageSearchIndex: index,
    });
    const prefixResults = selectCommandPalettePageResults({
      query: "comm page",
      pages,
      pageSearchIndex: index,
    });

    expect(fuzzyResults[0]?.page.id).toBe("target");
    expect(prefixResults[0]?.page.id).toBe("target");
  });

  test("merges content-only Page hits from pages:search excerpts", () => {
    const page = makePalettePage({
      page: makePage({
        id: "content-only",
        title: "Assorted implementation note",
        descriptionPreview: "No local preview match.",
      }),
    });

    const results = selectCommandPalettePageResults({
      query: "vector clocks",
      pages: [page],
      pageSearchIndex: createCommandPalettePageSearchIndex([page]),
      pageDescriptionSearchBatch: makeDescriptionBatch("vector clocks", [
        makeDescriptionResult({
          pageId: "content-only",
          excerpt: "Document vector clocks and replicated queue recovery.",
        }),
      ]),
    });

    expect(results.length).toBe(1);
    expect(results[0]?.page.id).toBe("content-only");
    expect(results[0]?.searchPreview?.excerpt.includes("vector clocks")).toBe(true);
  });

  test("can prioritize active-project description hits before final result limits", () => {
    const activeProjectPage = makePalettePage({
      page: makePage({
        id: "active-content-only",
        title: "General implementation note",
        descriptionPreview: "No local metadata match.",
      }),
      inActiveProject: true,
    });
    const otherProjectPage = makePalettePage({
      projectId: "ops",
      projectName: "Ops",
      page: makePage({
        id: "other-metadata",
        title: "Approval heuristic",
      }),
      inActiveProject: false,
    });
    const pages = [otherProjectPage, activeProjectPage];
    const pageSearchIndex = createCommandPalettePageSearchIndex(pages);
    const pageDescriptionSearchBatch = makeDescriptionBatch("approval heuristic", [
      makeDescriptionResult({
        projectId: activeProjectPage.projectId,
        pageId: activeProjectPage.page.id,
        excerpt: "Approval heuristic appears only in the active page body.",
      }),
    ]);

    const defaultResults = selectCommandPalettePageResults({
      query: "approval heuristic",
      pages,
      pageSearchIndex,
      pageDescriptionSearchBatch,
      metadataPageLimit: 1,
      mergedPageLimit: 1,
    });
    const prioritizedResults = selectCommandPalettePageResults({
      query: "approval heuristic",
      pages,
      pageSearchIndex,
      pageDescriptionSearchBatch,
      metadataPageLimit: 1,
      mergedPageLimit: 1,
      preferActiveProject: true,
    });

    expect(defaultResults[0]?.page.id).toBe("other-metadata");
    expect(prioritizedResults[0]?.page.id).toBe("active-content-only");
    expect(prioritizedResults[0]?.searchPreview?.excerpt.includes("active page body")).toBe(true);
  });

  test("keeps current-project and board-order fallbacks for empty page queries", () => {
    const projects = [
      makeProject("ops", "Ops"),
      makeProject("app", "App"),
    ];
    const appBoard: BoardSummary = {
      columns: [
        {
          id: "plan",
          name: "Plan",
          cards: [
            makePage({ id: "app-first", title: "App first", status: "plan" }),
            makePage({ id: "app-second", title: "App second", status: "plan" }),
          ],
        },
      ],
    };
    const opsBoard: BoardSummary = {
      columns: [
        {
          id: "plan",
          name: "Plan",
          cards: [makePage({ id: "ops-first", title: "Ops first", status: "plan" })],
        },
      ],
    };
    const pages = buildCommandPalettePageItemsFromBoardSummaries({
      projects,
      boardMap: new Map([
        ["ops", opsBoard],
        ["app", appBoard],
      ]),
      activeProjectId: "app",
    });

    const results = selectCommandPalettePageResults({
      query: "",
      pages,
      pageSearchIndex: createCommandPalettePageSearchIndex(pages),
    });

    expect(results[0]?.page.id).toBe("app-first");
    expect(results[1]?.page.id).toBe("app-second");
    expect(results[2]?.page.id).toBe("ops-first");
  });

  test("does not replace a metadata preview with a later description search preview", () => {
    const page = makePalettePage({
      page: makePage({
        id: "preview-page",
        title: "Implementation note",
        descriptionPreview: "Local OCR pipeline metadata preview.",
      }),
    });

    const results = selectCommandPalettePageResults({
      query: "ocr pipeline",
      pages: [page],
      pageSearchIndex: createCommandPalettePageSearchIndex([page]),
      pageDescriptionSearchBatch: makeDescriptionBatch("ocr pipeline", [
        makeDescriptionResult({
          pageId: "preview-page",
          excerpt: "Server OCR pipeline body excerpt.",
        }),
      ]),
    });

    expect(results.length).toBe(1);
    expect(results[0]?.searchPreview?.excerpt.includes("Local OCR pipeline")).toBe(true);
    expect(results[0]?.searchPreview?.excerpt.includes("Server OCR")).toBe(false);
  });

  test("does not merge stale description batches from another query", () => {
    const page = makePalettePage({
      page: makePage({
        id: "content-only",
        title: "Assorted implementation note",
        descriptionPreview: "No local preview match.",
      }),
    });

    const results = selectCommandPalettePageResults({
      query: "vector clocks",
      pages: [page],
      pageSearchIndex: createCommandPalettePageSearchIndex([page]),
      pageDescriptionSearchBatch: makeDescriptionBatch("approval heuristic", [
        makeDescriptionResult({
          pageId: "content-only",
          excerpt: "Document vector clocks and replicated queue recovery.",
        }),
      ]),
    });

    expect(results.length).toBe(0);
  });
});
