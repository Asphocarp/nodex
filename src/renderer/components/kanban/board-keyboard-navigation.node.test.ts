import { describe, expect, test } from "vitest";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import type { BoardSummary, DatabasePageSummary, WorkflowStatus } from "@/lib/types";
import {
  resolveBoardKeyboardActionPageIds,
  resolveBoardKeyboardNavigation,
} from "./board-keyboard-navigation";

const card = (id: string, status: WorkflowStatus): DatabasePageSummary => ({
  id,
  title: id,
  richTitle: plainTextToPortableRichText(id),
  archived: false,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
  status,
  priority: undefined,
  estimate: undefined,
  tags: [],
  assignee: undefined,
  dueDate: undefined,
  scheduledStart: undefined,
  scheduledEnd: undefined,
  order: 0,
  revision: 0,
  created: new Date(0),
});

const board: BoardSummary = {
  columns: [
    { id: "triage", name: "Triage", cards: [card("a", "triage"), card("b", "triage")] },
    { id: "plan", name: "Plan", cards: [] },
    { id: "build", name: "Build", cards: [card("c", "build")] },
  ],
};

describe("Board keyboard navigation", () => {
  test("uses column-major order for J/K navigation", () => {
    expect(resolveBoardKeyboardNavigation(board, "b", "next")?.pageId).toBe("c");
    expect(resolveBoardKeyboardNavigation(board, "c", "previous")?.pageId).toBe("b");
  });

  test("preserves the nearest row while crossing empty columns", () => {
    expect(resolveBoardKeyboardNavigation(board, "b", "right")?.pageId).toBe("c");
    expect(resolveBoardKeyboardNavigation(board, "c", "left")?.pageId).toBe("a");
  });

  test("starts from the first visible Page when no Page is highlighted", () => {
    expect(resolveBoardKeyboardNavigation(board, null, "next")?.pageId).toBe("a");
  });

  test("resolves selected actions in visible Board order", () => {
    expect(resolveBoardKeyboardActionPageIds(
      board,
      "c",
      new Set(["c", "a"]),
    )).toEqual(["a", "c"]);
    expect(resolveBoardKeyboardActionPageIds(
      board,
      "b",
      new Set(["a", "c"]),
    )).toEqual(["b"]);
  });
});
