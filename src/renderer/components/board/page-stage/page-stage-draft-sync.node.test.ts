import { describe, expect, test } from "vitest";
import { buildPageStageDraftOverlay } from "./page-stage-draft-sync";

describe("page stage draft sync", () => {
  test("derives only changed metadata fields into the draft overlay", () => {
    const overlay = buildPageStageDraftOverlay({
      assignee: "alex",
    }, {
      assignee: "sam",
    });

    expect(overlay.assignee).toBe("sam");
    expect("title" in overlay).toBe(false);
    expect("description" in overlay).toBe(false);
  });
});
