import { describe, expect, test } from "vite-plus/test";
import { buildComposerThreadGoalDraft } from "./composer-thread-goal-draft";

describe("buildComposerThreadGoalDraft", () => {
  test("returns not-goal when goal actions are unavailable", () => {
    const result = buildComposerThreadGoalDraft({
      promptRaw: "/goal keep working",
      goalActionAvailable: false,
      goalModeActive: true,
      hasAttachments: false,
    });

    expect(result.status).toBe("not-goal");
  });

  test("parses canonical and repeated-o goal slash commands", () => {
    const canonical = buildComposerThreadGoalDraft({
      promptRaw: "  /goal keep working",
      goalActionAvailable: true,
      goalModeActive: false,
      hasAttachments: false,
    });
    const repeated = buildComposerThreadGoalDraft({
      promptRaw: "/gooal keep going",
      goalActionAvailable: true,
      goalModeActive: false,
      hasAttachments: false,
    });

    expect(canonical.status).toBe("ready");
    expect(canonical.status === "ready" ? canonical.draft.objective : "").toBe("keep working");
    expect(repeated.status).toBe("ready");
    expect(repeated.status === "ready" ? repeated.draft.objective : "").toBe("keep going");
  });

  test("does not parse goal text outside the leading slash command", () => {
    const result = buildComposerThreadGoalDraft({
      promptRaw: "please /goal keep working",
      goalActionAvailable: true,
      goalModeActive: false,
      hasAttachments: false,
    });

    expect(result.status).toBe("not-goal");
  });

  test("uses the whole prompt while goal mode is active", () => {
    const result = buildComposerThreadGoalDraft({
      promptRaw: "keep working",
      goalActionAvailable: true,
      goalModeActive: true,
      hasAttachments: false,
    });

    expect(result.status).toBe("ready");
    expect(result.status === "ready" ? result.draft.objective : "").toBe("keep working");
  });

  test("strips plugin and app markdown links to labels", () => {
    const result = buildComposerThreadGoalDraft({
      promptRaw: "/goal use [Browser](app://browser) and [Plug\\]in](plugin://abc)",
      goalActionAvailable: true,
      goalModeActive: false,
      hasAttachments: false,
    });

    expect(result.status).toBe("ready");
    expect(result.status === "ready" ? result.draft.objective : "").toBe("use Browser and Plug]in");
  });

  test("returns empty only when objective and attachments are both empty", () => {
    const empty = buildComposerThreadGoalDraft({
      promptRaw: "/goal",
      goalActionAvailable: true,
      goalModeActive: false,
      hasAttachments: false,
    });
    const attachmentOnly = buildComposerThreadGoalDraft({
      promptRaw: "/goal",
      goalActionAvailable: true,
      goalModeActive: false,
      hasAttachments: true,
    });

    expect(empty.status).toBe("empty");
    expect(attachmentOnly.status).toBe("ready");
    expect(attachmentOnly.status === "ready" ? attachmentOnly.draft.hasAttachments : false).toBe(
      true,
    );
  });
});
