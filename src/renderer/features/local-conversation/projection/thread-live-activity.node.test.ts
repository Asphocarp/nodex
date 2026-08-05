import { describe, expect, it } from "vitest";
import { resolveThreadLiveActivityPresentation } from "./thread-live-activity";
import type {
  ThreadAgentRenderUnit,
  ThreadTranscriptBlockModel,
} from "../thread-stage-types";

function reasoning(markdownText: string): ThreadTranscriptBlockModel {
  return {
    id: "reasoning-1",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "",
    type: "reasoning",
    status: "inProgress",
    entry: {
      itemId: "reasoning-1",
      threadId: "thread-1",
      turnId: "turn-1",
      type: "reasoning",
      kind: "reasoning",
      semanticKind: "reasoning",
      createdAt: 1,
      updatedAt: 2,
      markdownText,
    },
  };
}

function activityGroup(liveHeaderKind: "active" | "thinking"): ThreadAgentRenderUnit {
  return {
    kind: "agentActivityGroup",
    block: {
      id: "activity-1",
      turnId: "turn-1",
      createdAt: 1,
      updatedAt: 2,
      searchableText: "",
      type: "agentActivityGroup",
      entries: [],
      summary: "Edited files",
      liveHeaderKind,
    },
  };
}

describe("resolveThreadLiveActivityPresentation", () => {
  it("keeps commentary text from closing the live activity slice", () => {
    const result = resolveThreadLiveActivityPresentation({
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
      showSafetyBufferingUi: false,
      latestAssistantMessage: {
        ...reasoning("commentary"),
        id: "commentary",
        type: "assistantMessage",
        entry: {
          itemId: "commentary",
          threadId: "thread-1",
          turnId: "turn-1",
          type: "message",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          assistantPhase: "commentary",
          createdAt: 1,
          updatedAt: 2,
          markdownText: "I am checking the repository.",
        },
      },
      proposedPlanItem: null,
      agentItems: [reasoning("**Checking the patch stream.**")],
      agentBodyUnits: [activityGroup("active")],
      isExploring: false,
    });

    expect(result).toMatchObject({
      state: "active",
      placement: "activity-group",
      isActivitySliceClosed: false,
      reasoningSummary: { text: "Checking the patch stream." },
    });
  });

  it("projects a standalone shimmer when reasoning is the only hidden live item", () => {
    const result = resolveThreadLiveActivityPresentation({
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
      showSafetyBufferingUi: false,
      latestAssistantMessage: null,
      proposedPlanItem: null,
      agentItems: [reasoning("**Reading the bundle.**")],
      agentBodyUnits: [],
      isExploring: false,
    });

    expect(result).toMatchObject({
      state: "thinking",
      placement: "standalone",
      reasoningSummary: { text: "Reading the bundle." },
    });
  });

  it("keeps live activity visible while the independent worked-for timer is running", () => {
    const result = resolveThreadLiveActivityPresentation({
      isLatestTurn: true,
      isStreamingTurn: true,
      isBlocked: false,
      showSafetyBufferingUi: false,
      latestAssistantMessage: null,
      proposedPlanItem: null,
      agentItems: [{
        id: "worked-for-1",
        turnId: "turn-1",
        createdAt: 1,
        updatedAt: 2,
        searchableText: "",
        type: "workedFor",
        status: "working",
        startedAtMs: 1,
        completedAtMs: null,
      }],
      agentBodyUnits: [],
      isExploring: false,
    });

    expect(result).toMatchObject({
      state: "thinking",
      placement: "standalone",
      isActivitySliceClosed: false,
    });
  });
});
