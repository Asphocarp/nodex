import { describe, expect, test } from "vitest";
import {
  buildBackgroundSubagentCompactStripModel,
  getBackgroundSubagentListRows,
} from "./background-subagent-summary-model";

function row(
  id: string,
  input: { showInlineActivity: boolean; status: "active" | "waiting" | "done" },
) {
  return {
    id,
    showInlineActivity: input.showInlineActivity,
    status: input.status,
  };
}

describe("background subagent summary model", () => {
  test("shows up to four working inline avatars but counts every inline row", () => {
    const model = buildBackgroundSubagentCompactStripModel([
      row("working-1", { showInlineActivity: true, status: "active" }),
      row("working-2", { showInlineActivity: true, status: "waiting" }),
      row("working-3", { showInlineActivity: true, status: "active" }),
      row("working-4", { showInlineActivity: true, status: "waiting" }),
      row("working-5", { showInlineActivity: true, status: "active" }),
      row("done-1", { showInlineActivity: true, status: "done" }),
      row("listed-1", { showInlineActivity: false, status: "active" }),
    ]);

    expect(model.displayRows.map((entry) => entry.id).join(",")).toBe(
      "working-1,working-2,working-3,working-4",
    );
    expect(`${model.workingCount}:${model.doneCount}`).toBe("5:1");
  });

  test("shows the first four done inline avatars when no inline row is working", () => {
    const model = buildBackgroundSubagentCompactStripModel([
      row("done-1", { showInlineActivity: true, status: "done" }),
      row("done-2", { showInlineActivity: true, status: "done" }),
      row("done-3", { showInlineActivity: true, status: "done" }),
      row("done-4", { showInlineActivity: true, status: "done" }),
      row("done-5", { showInlineActivity: true, status: "done" }),
    ]);

    expect(model.displayRows.map((entry) => entry.id).join(",")).toBe(
      "done-1,done-2,done-3,done-4",
    );
    expect(`${model.workingCount}:${model.doneCount}`).toBe("0:5");
  });

  test("lists only non-inline rows below the compact strip", () => {
    const rows = [
      row("inline", { showInlineActivity: true, status: "active" }),
      row("listed", { showInlineActivity: false, status: "active" }),
    ];

    expect(
      getBackgroundSubagentListRows(rows)
        .map((entry) => entry.id)
        .join(","),
    ).toBe("listed");
  });
});
