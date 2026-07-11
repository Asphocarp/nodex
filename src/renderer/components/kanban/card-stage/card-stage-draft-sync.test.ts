import { describe, expect, test } from "vitest";
import { buildCardStageDraftOverlay } from "./card-stage-draft-sync";

describe("card stage draft sync", () => {
  test("derives only changed metadata fields into the draft overlay", () => {
    const overlay = buildCardStageDraftOverlay({
      assignee: "alex",
      agentStatus: "waiting",
    }, {
      assignee: "alex",
      agentStatus: "blocked",
    });

    expect(overlay.agentStatus).toBe("blocked");
    expect("title" in overlay).toBe(false);
    expect("description" in overlay).toBe(false);
    expect("assignee" in overlay).toBe(false);
  });
});
