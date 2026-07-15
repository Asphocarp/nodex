import { describe, expect, test } from "vitest";
import { buildCardStageDraftOverlay } from "./card-stage-draft-sync";

describe("card stage draft sync", () => {
  test("derives only changed metadata fields into the draft overlay", () => {
    const overlay = buildCardStageDraftOverlay({
      assignee: "alex",
    }, {
      assignee: "sam",
    });

    expect(overlay.assignee).toBe("sam");
    expect("title" in overlay).toBe(false);
    expect("description" in overlay).toBe(false);
  });
});
