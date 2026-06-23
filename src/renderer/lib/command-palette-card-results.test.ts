import { describe, expect, test } from "bun:test";
import type { CommandPaletteCard } from "./command-palette";
import {
  buildCommandPaletteCardItemsFromBoardSummaries,
  selectCommandPaletteCardResults,
} from "./command-palette-card-results";
import { createCommandPaletteCardSearchIndex } from "./command-palette-card-search";
import type { BoardSummary, CardSearchResult, CardSummary, Project } from "./types";

function makeCard(overrides: Partial<CardSummary> = {}): CardSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Add quick card switching and commands.";
  return {
    id: overrides.id ?? "card-1",
    title: overrides.title ?? "Polish command palette",
    descriptionPreview,
    descriptionLength: overrides.descriptionLength ?? descriptionPreview.length,
    hasDescription: overrides.hasDescription ?? descriptionPreview.length > 0,
    status: overrides.status ?? "in_progress",
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
    agentStatus: overrides.agentStatus,
    agentBlocked: overrides.agentBlocked ?? false,
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

function makePaletteCard(overrides: Partial<CommandPaletteCard> = {}): CommandPaletteCard {
  const card = overrides.card ?? makeCard();
  return {
    kind: "card",
    id: overrides.id ?? `${overrides.projectId ?? "default"}:${card.id}`,
    projectId: overrides.projectId ?? "default",
    projectName: overrides.projectName ?? "Default",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "In progress",
    card,
    inActiveProject: overrides.inActiveProject ?? true,
    recentIndex: overrides.recentIndex ?? null,
    boardIndex: overrides.boardIndex ?? 0,
  };
}

function makeProject(id: string, name: string): Project {
  return {
    id,
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

function makeDescriptionResult(overrides: Partial<CardSearchResult> = {}): CardSearchResult {
  return {
    projectId: overrides.projectId ?? "default",
    cardId: overrides.cardId ?? "card-1",
    status: overrides.status ?? "in_progress",
    score: overrides.score ?? -1,
    excerpt: overrides.excerpt ?? "Server excerpt",
  };
}

describe("command palette card result selection", () => {
  test("returns metadata fuzzy and prefix matches through the shared card selector", () => {
    const target = makePaletteCard({
      card: makeCard({ id: "target", title: "Command palette card search" }),
    });
    const other = makePaletteCard({
      card: makeCard({ id: "other", title: "Terminal panel" }),
    });
    const cards = [other, target];
    const index = createCommandPaletteCardSearchIndex(cards);

    const fuzzyResults = selectCommandPaletteCardResults({
      query: "commnd palete",
      cards,
      cardSearchIndex: index,
    });
    const prefixResults = selectCommandPaletteCardResults({
      query: "comm card",
      cards,
      cardSearchIndex: index,
    });

    expect(fuzzyResults[0]?.card.id).toBe("target");
    expect(prefixResults[0]?.card.id).toBe("target");
  });

  test("merges description-only card hits from cards:search excerpts", () => {
    const card = makePaletteCard({
      card: makeCard({
        id: "content-only",
        title: "Assorted implementation note",
        descriptionPreview: "No local preview match.",
      }),
    });

    const results = selectCommandPaletteCardResults({
      query: "vector clocks",
      cards: [card],
      cardSearchIndex: createCommandPaletteCardSearchIndex([card]),
      cardDescriptionSearchResults: [
        makeDescriptionResult({
          cardId: "content-only",
          excerpt: "Document vector clocks and replicated queue recovery.",
        }),
      ],
    });

    expect(results.length).toBe(1);
    expect(results[0]?.card.id).toBe("content-only");
    expect(results[0]?.searchPreview?.excerpt.includes("vector clocks")).toBeTrue();
  });

  test("can prioritize active-project description hits before final result limits", () => {
    const activeProjectCard = makePaletteCard({
      card: makeCard({
        id: "active-content-only",
        title: "General implementation note",
        descriptionPreview: "No local metadata match.",
      }),
      inActiveProject: true,
    });
    const otherProjectCard = makePaletteCard({
      projectId: "ops",
      projectName: "Ops",
      card: makeCard({
        id: "other-metadata",
        title: "Approval heuristic",
      }),
      inActiveProject: false,
    });
    const cards = [otherProjectCard, activeProjectCard];
    const cardSearchIndex = createCommandPaletteCardSearchIndex(cards);
    const cardDescriptionSearchResults = [
      makeDescriptionResult({
        projectId: activeProjectCard.projectId,
        cardId: activeProjectCard.card.id,
        excerpt: "Approval heuristic appears only in the active card body.",
      }),
    ];

    const defaultResults = selectCommandPaletteCardResults({
      query: "approval heuristic",
      cards,
      cardSearchIndex,
      cardDescriptionSearchResults,
      metadataCardLimit: 1,
      mergedCardLimit: 1,
    });
    const prioritizedResults = selectCommandPaletteCardResults({
      query: "approval heuristic",
      cards,
      cardSearchIndex,
      cardDescriptionSearchResults,
      metadataCardLimit: 1,
      mergedCardLimit: 1,
      preferActiveProject: true,
    });

    expect(defaultResults[0]?.card.id).toBe("other-metadata");
    expect(prioritizedResults[0]?.card.id).toBe("active-content-only");
    expect(prioritizedResults[0]?.searchPreview?.excerpt.includes("active card body")).toBeTrue();
  });

  test("keeps current-project and board-order fallbacks for empty card queries", () => {
    const projects = [
      makeProject("ops", "Ops"),
      makeProject("app", "App"),
    ];
    const appBoard: BoardSummary = {
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          cards: [
            makeCard({ id: "app-first", title: "App first", status: "backlog" }),
            makeCard({ id: "app-second", title: "App second", status: "backlog" }),
          ],
        },
      ],
    };
    const opsBoard: BoardSummary = {
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          cards: [makeCard({ id: "ops-first", title: "Ops first", status: "backlog" })],
        },
      ],
    };
    const cards = buildCommandPaletteCardItemsFromBoardSummaries({
      projects,
      boardMap: new Map([
        ["ops", opsBoard],
        ["app", appBoard],
      ]),
      activeProjectId: "app",
    });

    const results = selectCommandPaletteCardResults({
      query: "",
      cards,
      cardSearchIndex: createCommandPaletteCardSearchIndex(cards),
    });

    expect(results[0]?.card.id).toBe("app-first");
    expect(results[1]?.card.id).toBe("app-second");
    expect(results[2]?.card.id).toBe("ops-first");
  });

  test("does not replace a metadata preview with a later description search preview", () => {
    const card = makePaletteCard({
      card: makeCard({
        id: "preview-card",
        title: "Implementation note",
        descriptionPreview: "Local OCR pipeline metadata preview.",
      }),
    });

    const results = selectCommandPaletteCardResults({
      query: "ocr pipeline",
      cards: [card],
      cardSearchIndex: createCommandPaletteCardSearchIndex([card]),
      cardDescriptionSearchResults: [
        makeDescriptionResult({
          cardId: "preview-card",
          excerpt: "Server OCR pipeline body excerpt.",
        }),
      ],
    });

    expect(results.length).toBe(1);
    expect(results[0]?.searchPreview?.excerpt.includes("Local OCR pipeline")).toBeTrue();
    expect(results[0]?.searchPreview?.excerpt.includes("Server OCR")).toBeFalse();
  });
});
