import { beforeEach, describe, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { render, settleAsyncRender } from "@/test/dom";
import type { CommandPalettePage } from "./command-palette";
import {
  resetCommandPalettePageSearchCacheForTests,
  type CommandPalettePageSearchIndex,
} from "./command-palette-page-search";
import { useCommandPalettePageSearchIndex } from "./use-command-palette-page-search-index";
import type { DatabasePageSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents";

function makePage(overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Shared picker search.";
  const title = overrides.title ?? "Mention search page";
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
    tags: overrides.tags ?? ["mention"],
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
    created: overrides.created ?? new Date("2026-06-24T00:00:00.000Z"),
    order: overrides.order ?? 0,
  };
}

function makePalettePage(overrides: Partial<CommandPalettePage> = {}): CommandPalettePage {
  const page = overrides.page ?? makePage();
  return {
    kind: "page",
    id: overrides.id ?? `${overrides.projectId ?? "project-1"}:${page.id}`,
    projectId: overrides.projectId ?? "project-1",
    projectName: overrides.projectName ?? "Project",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "Doing",
    page,
    inActiveProject: overrides.inActiveProject ?? true,
    recentIndex: overrides.recentIndex ?? null,
    boardIndex: overrides.boardIndex ?? 0,
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
  };
}

function PageSearchIndexHarness({
  pages,
  snapshots,
}: {
  pages: CommandPalettePage[];
  snapshots: Array<CommandPalettePageSearchIndex | null>;
}) {
  const index = useCommandPalettePageSearchIndex(pages);
  snapshots.push(index);

  return <div>{index ? "ready" : "loading"}</div>;
}

describe("useCommandPalettePageSearchIndex", () => {
  beforeEach(() => {
    resetCommandPalettePageSearchCacheForTests();
  });

  test("returns a synchronous metadata index before async hydration settles", () => {
    const snapshots: Array<CommandPalettePageSearchIndex | null> = [];
    render(
      <PageSearchIndexHarness
        pages={[makePalettePage({
          page: makePage({
            id: "fast-page",
            title: "Unrelated title",
            tags: ["handoff"],
          }),
        })]}
        snapshots={snapshots}
      />,
    );

    const firstSnapshot = snapshots[0];
    expect(firstSnapshot === null).toBe(false);
    expect(firstSnapshot?.search("handoff")[0]?.item.page.id).toBe("fast-page");
  });

  test("keeps the existing index for semantically identical page arrays", async () => {
    const snapshots: Array<CommandPalettePageSearchIndex | null> = [];
    const view = render(
      <PageSearchIndexHarness
        pages={[makePalettePage()]}
        snapshots={snapshots}
      />,
    );

    await waitFor(() => {
      if (view.getByText("ready").textContent !== "ready") {
        throw new Error("Expected page search index to become ready.");
      }
    });

    snapshots.length = 0;
    view.rerender(
      <PageSearchIndexHarness
        pages={[makePalettePage()]}
        snapshots={snapshots}
      />,
    );
    await settleAsyncRender();

    expect(view.getByText("ready").textContent).toBe("ready");
    expect(snapshots.length > 0).toBe(true);
    expect(snapshots.some((entry) => entry === null)).toBe(false);
  });
});
