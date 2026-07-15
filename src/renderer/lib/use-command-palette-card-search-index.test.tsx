import { beforeEach, describe, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { render, settleAsyncRender } from "@/test/dom";
import type { CommandPaletteCard } from "./command-palette";
import {
  resetCommandPaletteCardSearchCacheForTests,
  type CommandPaletteCardSearchIndex,
} from "./command-palette-card-search";
import { useCommandPaletteCardSearchIndex } from "./use-command-palette-card-search-index";
import type { CardSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents";

function makeCard(overrides: Partial<CardSummary> = {}): CardSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Shared picker search.";
  const title = overrides.title ?? "Mention search card";
  return {
    id: overrides.id ?? "card-1",
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    descriptionPreview,
    descriptionLength: overrides.descriptionLength ?? descriptionPreview.length,
    hasDescription: overrides.hasDescription ?? descriptionPreview.length > 0,
    status: overrides.status ?? "in_progress",
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

function makePaletteCard(overrides: Partial<CommandPaletteCard> = {}): CommandPaletteCard {
  const card = overrides.card ?? makeCard();
  return {
    kind: "card",
    id: overrides.id ?? `${overrides.projectId ?? "project-1"}:${card.id}`,
    projectId: overrides.projectId ?? "project-1",
    projectName: overrides.projectName ?? "Project",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "Doing",
    card,
    inActiveProject: overrides.inActiveProject ?? true,
    recentIndex: overrides.recentIndex ?? null,
    boardIndex: overrides.boardIndex ?? 0,
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
  };
}

function CardSearchIndexHarness({
  cards,
  snapshots,
}: {
  cards: CommandPaletteCard[];
  snapshots: Array<CommandPaletteCardSearchIndex | null>;
}) {
  const index = useCommandPaletteCardSearchIndex(cards);
  snapshots.push(index);

  return <div>{index ? "ready" : "loading"}</div>;
}

describe("useCommandPaletteCardSearchIndex", () => {
  beforeEach(() => {
    resetCommandPaletteCardSearchCacheForTests();
  });

  test("returns a synchronous metadata index before async hydration settles", () => {
    const snapshots: Array<CommandPaletteCardSearchIndex | null> = [];
    render(
      <CardSearchIndexHarness
        cards={[makePaletteCard({
          card: makeCard({
            id: "fast-card",
            title: "Unrelated title",
            tags: ["handoff"],
          }),
        })]}
        snapshots={snapshots}
      />,
    );

    const firstSnapshot = snapshots[0];
    expect(firstSnapshot === null).toBe(false);
    expect(firstSnapshot?.search("handoff")[0]?.item.card.id).toBe("fast-card");
  });

  test("keeps the existing index for semantically identical card arrays", async () => {
    const snapshots: Array<CommandPaletteCardSearchIndex | null> = [];
    const view = render(
      <CardSearchIndexHarness
        cards={[makePaletteCard()]}
        snapshots={snapshots}
      />,
    );

    await waitFor(() => {
      if (view.getByText("ready").textContent !== "ready") {
        throw new Error("Expected card search index to become ready.");
      }
    });

    snapshots.length = 0;
    view.rerender(
      <CardSearchIndexHarness
        cards={[makePaletteCard()]}
        snapshots={snapshots}
      />,
    );
    await settleAsyncRender();

    expect(view.getByText("ready").textContent).toBe("ready");
    expect(snapshots.length > 0).toBe(true);
    expect(snapshots.some((entry) => entry === null)).toBe(false);
  });
});
