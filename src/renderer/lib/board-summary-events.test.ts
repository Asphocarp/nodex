import { describe, expect, test } from "vitest";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { BoardSummary, DatabasePageSummary } from "./types";
import {
  applyBoardChangeEventToBoard,
  upsertCardSummaryInBoard,
} from "./board-summary-events";

function makeCard(id: string, status: DatabasePageSummary["status"], order: number): DatabasePageSummary {
  return {
    id,
    status,
    archived: false,
    title: id,
    richTitle: plainTextToPortableRichText(id),
    priority: undefined,
    estimate: undefined,
    tags: [],
    dueDate: undefined,
    scheduledStart: undefined,
    scheduledEnd: undefined,
    isAllDay: undefined,
    recurrence: undefined,
    reminders: [],
    scheduleTimezone: undefined,
    assignee: undefined,
    runInTarget: undefined,
    runInLocalPath: undefined,
    runInBaseBranch: undefined,
    runInWorktreePath: undefined,
    runInEnvironmentPath: undefined,
    revision: 1,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

function makeBoard(): BoardSummary {
  return {
    columns: [
      { id: "draft", name: "Draft", cards: [makeCard("card-1", "draft", 0)] },
      { id: "done", name: "Done", cards: [] },
    ],
  };
}

function makeEvent(summary?: DatabasePageSummary): BoardChangeEvent {
  return {
    projectId: "project-1",
    changeType: "update",
    columnId: summary?.status ?? "draft",
    status: summary?.status ?? "draft",
    pageId: summary?.id ?? "card-1",
    summary,
  };
}

describe("board summary events", () => {
  test("patches an updated card summary without replacing unrelated columns", () => {
    const board = makeBoard();
    const nextSummary = { ...makeCard("card-1", "draft", 0), title: "Updated", revision: 2 };
    const next = applyBoardChangeEventToBoard(board, makeEvent(nextSummary));

    expect(next?.columns[0]?.cards[0]?.title).toBe("Updated");
    expect(next?.columns[1]).toBe(board.columns[1]);
  });

  test("moves a card when the summary status changes", () => {
    const board = makeBoard();
    const moved = { ...makeCard("card-1", "done", 0), title: "Moved", revision: 2 };
    const next = applyBoardChangeEventToBoard(board, makeEvent(moved));

    expect(next?.columns[0]?.cards.length).toBe(0);
    expect(next?.columns[1]?.cards[0]?.id).toBe("card-1");
  });

  test("removes archived summaries from the visible board", () => {
    const board = makeBoard();
    const archived = { ...makeCard("card-1", "draft", 0), archived: true };
    const next = applyBoardChangeEventToBoard(board, makeEvent(archived));

    expect(next?.columns[0]?.cards.length).toBe(0);
  });

  test("orders equal-tail summaries deterministically by Card identity", () => {
    const board = makeBoard();
    const tailOrder = Number.MAX_SAFE_INTEGER;
    const withLater = upsertCardSummaryInBoard(
      board,
      makeCard("card-z", "draft", tailOrder),
    );
    const withBoth = upsertCardSummaryInBoard(
      withLater,
      makeCard("card-a", "draft", tailOrder),
    );

    expect(withBoth.columns[0]?.cards.map((card) => card.id)).toEqual([
      "card-1",
      "card-a",
      "card-z",
    ]);
  });
});
