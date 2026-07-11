import { describe, expect, test } from "vitest";
import {
  buildCardStageDraftOverlay,
  shouldPublishCardStagePatch,
} from "./card-stage-draft-sync";

describe("card stage draft sync", () => {
  test("keeps freeform text drafts local to the stage", () => {
    expect(shouldPublishCardStagePatch({ title: "Next title" })).toBe(false);
    expect(shouldPublishCardStagePatch({ description: "Next description" })).toBe(false);
    expect(shouldPublishCardStagePatch({ assignee: "alex" })).toBe(false);
    expect(shouldPublishCardStagePatch({ agentStatus: "waiting" })).toBe(false);
    expect(shouldPublishCardStagePatch({
      title: "Next title",
      description: "Next description",
    })).toBe(false);
  });

  test("still publishes discrete card property patches", () => {
    expect(shouldPublishCardStagePatch({ priority: "p1-high" })).toBe(true);
    expect(shouldPublishCardStagePatch({ estimate: "m" })).toBe(true);
    expect(shouldPublishCardStagePatch({ agentBlocked: true })).toBe(true);
    expect(shouldPublishCardStagePatch({
      description: "Next description",
      priority: "p1-high",
    })).toBe(true);
  });

  test("derives only changed text fields into the draft overlay", () => {
    const overlay = buildCardStageDraftOverlay({
      title: "Persisted title",
      description: "Persisted body",
      assignee: "alex",
      agentStatus: "waiting",
    }, {
      title: "Draft title",
      description: "Draft body",
      assignee: "alex",
      agentStatus: "blocked",
    });

    expect(overlay.title).toBe("Draft title");
    expect(overlay.agentStatus).toBe("blocked");
    expect("description" in overlay).toBe(false);
    expect("assignee" in overlay).toBe(false);
  });
});
