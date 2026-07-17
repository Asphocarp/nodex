import { describe, expect, test } from "vitest";
import {
  createCommandPalettePageSearchIndex,
  hydrateCommandPalettePageSearchIndex,
  normalizeCommandPaletteSearchText,
  resetCommandPalettePageSearchCacheForTests,
  type CommandPalettePageSearchCacheSnapshot,
  type CommandPalettePageSearchCacheStore,
} from "./command-palette-page-search";
import type { CommandPalettePage } from "./command-palette";
import type { DatabasePageSummary } from "./types";
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

function cloneSnapshot(
  snapshot: CommandPalettePageSearchCacheSnapshot,
): CommandPalettePageSearchCacheSnapshot {
  return {
    version: snapshot.version,
    documentRefs: snapshot.documentRefs.map((ref) => ({ ...ref })),
    data: JSON.parse(JSON.stringify(snapshot.data)) as CommandPalettePageSearchCacheSnapshot["data"],
  };
}

function createMemoryCacheStore(): {
  store: CommandPalettePageSearchCacheStore;
  stats: { reads: number; writes: number };
} {
  let snapshot: CommandPalettePageSearchCacheSnapshot | null = null;
  const stats = { reads: 0, writes: 0 };

  return {
    store: {
      async read() {
        stats.reads += 1;
        return snapshot ? cloneSnapshot(snapshot) : null;
      },
      async write(next) {
        stats.writes += 1;
        snapshot = cloneSnapshot(next);
      },
    },
    stats,
  };
}

describe("command palette page search index", () => {
  test("keeps command palette normalization as a shared search-text alias", () => {
    expect(normalizeCommandPaletteSearchText("  Command   Palette  ")).toBe("command palette");
  });

  test("matches fuzzy title queries", () => {
    resetCommandPalettePageSearchCacheForTests();
    const index = createCommandPalettePageSearchIndex([
      makePalettePage({
        page: makePage({ id: "fuzzy-target", title: "Command palette" }),
      }),
      makePalettePage({
        page: makePage({ id: "other-page", title: "Terminal panel" }),
      }),
    ]);

    const results = index.search("commnd palete");

    expect(results.length > 0).toBe(true);
    expect(results[0]?.item.page.id).toBe("fuzzy-target");
    expect(results[0]?.item.searchDecorations?.titleSegments?.some((segment) => segment.highlight)).toBe(true);
  });

  test("matches description-only queries", () => {
    resetCommandPalettePageSearchCacheForTests();
    const index = createCommandPalettePageSearchIndex([
      makePalettePage({
        page: makePage({
          id: "description-hit",
          title: "Misc task",
          descriptionPreview: "Document the OCR pipeline and index refresh behavior.",
        }),
      }),
    ]);

    const results = index.search("ocr pipeline");

    expect(results.length).toBe(1);
    expect(results[0]?.item.page.id).toBe("description-hit");
    expect(results[0]?.item.searchPreview?.excerpt.includes("OCR pipeline")).toBe(true);
    expect(results[0]?.item.searchPreview?.segments.some((segment) => segment.highlight)).toBe(true);
  });

  test("supports prefix matching for multi-term queries", () => {
    resetCommandPalettePageSearchCacheForTests();
    const index = createCommandPalettePageSearchIndex([
      makePalettePage({
        page: makePage({
          id: "prefix-hit",
          title: "Terminal panel polish",
          descriptionPreview: "Tighten terminal status affordances.",
        }),
      }),
    ]);

    const results = index.search("term pol");

    expect(results.length).toBe(1);
    expect(results[0]?.item.page.id).toBe("prefix-hit");
  });

  test("requires all query terms to match", () => {
    resetCommandPalettePageSearchCacheForTests();
    const index = createCommandPalettePageSearchIndex([
      makePalettePage({
        page: makePage({
          id: "alpha-beta",
          title: "Alpha",
          descriptionPreview: "Contains both alpha and beta terms.",
        }),
      }),
      makePalettePage({
        page: makePage({
          id: "alpha-only",
          title: "Alpha only",
          descriptionPreview: "Contains alpha but not the other term.",
        }),
      }),
    ]);

    const results = index.search("alpha beta");

    expect(results.length).toBe(1);
    expect(results[0]?.item.page.id).toBe("alpha-beta");
  });

  test("omits preview when the description has no matched text", () => {
    resetCommandPalettePageSearchCacheForTests();
    const index = createCommandPalettePageSearchIndex([
      makePalettePage({
        page: makePage({
          id: "title-hit",
          title: "Telemetry dashboard",
          descriptionPreview: "A general notes page without the searched word.",
        }),
      }),
    ]);

    const results = index.search("telemetry");

    expect(results.length).toBe(1);
    expect(results[0]?.item.page.id).toBe("title-hit");
    expect(results[0]?.item.searchPreview ?? null).toBe(null);
    expect(results[0]?.item.searchDecorations?.titleSegments?.some((segment) => segment.highlight)).toBe(true);
  });

  test("adds matched field badges for secondary field hits", () => {
    resetCommandPalettePageSearchCacheForTests();
    const index = createCommandPalettePageSearchIndex([
      makePalettePage({
        page: makePage({
          id: "tag-hit",
          title: "General task",
          descriptionPreview: "No search terms in the body.",
          tags: ["telemetry", "search"],
          assignee: "telemetry-owner",
        }),
      }),
    ]);

    const results = index.search("telemetry");

    expect(results.length).toBe(1);
    expect(results[0]?.item.searchDecorations?.badges.some((badge) => badge.label === "tag")).toBe(true);
    expect(results[0]?.item.searchDecorations?.badges.some((badge) => badge.label === "assignee")).toBe(true);
  });

  test("rebuilds version 1 cache snapshots without retired Page search fields", async () => {
    resetCommandPalettePageSearchCacheForTests();
    const pages = [makePalettePage({ page: makePage({ title: "Telemetry dashboard" }) })];
    const seed = createMemoryCacheStore();
    await hydrateCommandPalettePageSearchIndex(pages, seed.store);
    const currentSnapshot = await seed.store.read();
    if (!currentSnapshot) throw new Error("Expected a seeded search cache snapshot");

    let snapshot: CommandPalettePageSearchCacheSnapshot = {
      ...cloneSnapshot(currentSnapshot),
      version: 1,
    };
    const store: CommandPalettePageSearchCacheStore = {
      read: async () => cloneSnapshot(snapshot),
      write: async (nextSnapshot) => {
        snapshot = cloneSnapshot(nextSnapshot);
      },
    };
    resetCommandPalettePageSearchCacheForTests();

    const index = await hydrateCommandPalettePageSearchIndex(pages, store);

    expect(index.search("telemetry")).toHaveLength(1);
    expect(snapshot.version).toBe(2);
  });

  test("hydrates a persisted cache snapshot and incrementally updates changed pages", async () => {
    resetCommandPalettePageSearchCacheForTests();
    const { store, stats } = createMemoryCacheStore();
    const initialPages = [
      makePalettePage({
        page: makePage({
          id: "alpha",
          title: "Telemetry dashboard",
          descriptionPreview: "Track search latency over time.",
        }),
      }),
      makePalettePage({
        page: makePage({
          id: "beta",
          title: "Old panel",
          descriptionPreview: "This page will be removed.",
        }),
      }),
    ];

    const initialIndex = await hydrateCommandPalettePageSearchIndex(initialPages, store);
    expect(initialIndex.search("telemetry").length).toBe(1);
    expect(stats.reads).toBe(1);
    expect(stats.writes).toBe(1);

    resetCommandPalettePageSearchCacheForTests();
    const nextPages = [
      makePalettePage({
        page: makePage({
          id: "alpha",
          title: "Telemetry board",
          descriptionPreview: "Track search latency over time.",
          revision: 2,
        }),
      }),
      makePalettePage({
        page: makePage({
          id: "gamma",
          title: "Executor queue",
          descriptionPreview: "Document the cached palette hydrator.",
        }),
      }),
    ];

    const nextIndex = await hydrateCommandPalettePageSearchIndex(nextPages, store);

    expect(stats.reads).toBe(2);
    expect(stats.writes).toBe(2);
    expect(nextIndex.search("telemetry board").length).toBe(1);
    expect(nextIndex.search("telemetry board")[0]?.item.page.id).toBe("alpha");
    expect(nextIndex.search("old panel").length).toBe(0);
    expect(nextIndex.search("executor")[0]?.item.page.id).toBe("gamma");
  });
});
