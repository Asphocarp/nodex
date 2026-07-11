import { describe, expect, test } from "vitest";
import {
  resolveNfmDeferredExternalContentSyncDecision,
  resolveNfmExternalContentSyncDecision,
  shouldReplaceNfmExternalContent,
} from "./nfm-external-content-sync";

describe("nfm external content sync", () => {
  test("skips replacement when incoming content is already the editor document", () => {
    const decision = resolveNfmExternalContentSyncDecision({
      incomingContent: "Current body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Current body",
    });

    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" ? decision.cancelPending : false).toBe(true);
  });

  test("skips replacement for the editor's own emitted value", () => {
    const decision = resolveNfmExternalContentSyncDecision({
      incomingContent: "Draft body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Different body",
    });

    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" ? decision.cancelPending : true).toBe(false);
  });

  test("does not cancel a newer pending edit for an old save acknowledgement", () => {
    const decision = resolveNfmExternalContentSyncDecision({
      incomingContent: "Last emitted body",
      previousContent: "Persisted body",
      lastEmittedContent: "Last emitted body",
      currentSerializedContent: "Newer local body",
      hasActiveLocalEdit: true,
    });

    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" ? decision.cancelPending : true).toBe(false);
  });

  test("defers different external content while local editing is active", () => {
    const decision = resolveNfmExternalContentSyncDecision({
      incomingContent: "Remote body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Current body",
      hasActiveLocalEdit: true,
    });

    expect(decision.action).toBe("defer");
  });

  test("allows replacement for a truly different external document", () => {
    const decision = resolveNfmExternalContentSyncDecision({
      incomingContent: "Remote body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Current body",
    });

    expect(decision.action).toBe("replace");
  });

  test("keeps the legacy boolean replacement helper", () => {
    const shouldReplace = shouldReplaceNfmExternalContent({
      incomingContent: "Remote body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Current body",
    });

    expect(shouldReplace).toBe(true);
  });
});

describe("nfm deferred external content sync", () => {
  test("keeps deferred content while local editing is still active", () => {
    const decision = resolveNfmDeferredExternalContentSyncDecision({
      deferred: {
        content: "Remote body",
        baselineSerializedContent: "Local body",
        shouldReplayWhenSafe: false,
      },
      currentSerializedContent: "Local body",
      hasActiveLocalEdit: true,
    });

    expect(decision.action).toBe("keep-deferred");
  });

  test("drops deferred remote content when a pending local draft caused the defer", () => {
    const decision = resolveNfmDeferredExternalContentSyncDecision({
      deferred: {
        content: "Remote body",
        baselineSerializedContent: "Local body",
        shouldReplayWhenSafe: false,
      },
      currentSerializedContent: "Local body",
    });

    expect(decision.action).toBe("drop");
  });

  test("drops replayable deferred content after the local document diverges", () => {
    const decision = resolveNfmDeferredExternalContentSyncDecision({
      deferred: {
        content: "Remote body",
        baselineSerializedContent: "Original body",
        shouldReplayWhenSafe: true,
      },
      currentSerializedContent: "Local body",
    });

    expect(decision.action).toBe("drop");
  });

  test("replays focused-only deferred content when the baseline is unchanged", () => {
    const decision = resolveNfmDeferredExternalContentSyncDecision({
      deferred: {
        content: "Remote body",
        baselineSerializedContent: "Original body",
        shouldReplayWhenSafe: true,
      },
      currentSerializedContent: "Original body",
    });

    expect(decision.action).toBe("replace");
  });

  test("skips deferred content that already matches the editor document", () => {
    const decision = resolveNfmDeferredExternalContentSyncDecision({
      deferred: {
        content: "Remote body",
        baselineSerializedContent: "Original body",
        shouldReplayWhenSafe: true,
      },
      currentSerializedContent: "Remote body",
    });

    expect(decision.action).toBe("skip");
    expect(decision.action === "skip" ? decision.cancelPending : false).toBe(true);
  });
});
