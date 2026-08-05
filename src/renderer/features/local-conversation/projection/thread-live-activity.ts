import { resolveCodexReasoningSummaryPresentation } from "../../../../shared/codex-reasoning-presentation";
import type {
  ThreadAgentItemModel,
  ThreadAgentRenderUnit,
  ThreadLiveActivityPresentation,
  ThreadTranscriptBlockModel,
} from "../thread-stage-types";

interface ResolveThreadLiveActivityInput {
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isBlocked: boolean;
  showSafetyBufferingUi: boolean;
  latestAssistantMessage: ThreadTranscriptBlockModel | null;
  proposedPlanItem: ThreadTranscriptBlockModel | null;
  agentItems: readonly ThreadAgentItemModel[];
  agentBodyUnits: readonly ThreadAgentRenderUnit[];
  isExploring: boolean;
}

function resolveReasoningSummary(
  agentItems: readonly ThreadAgentItemModel[],
) {
  return resolveCodexReasoningSummaryPresentation(
    agentItems.flatMap((item) => {
      if (item.type !== "reasoning") return [];
      return [{
        itemId: item.entry.itemId,
        normalizedKind: item.entry.kind,
        semanticKind: item.entry.semanticKind,
        markdownText: item.entry.markdownText,
      }];
    }),
  );
}

function isIncompleteBlock(block: ThreadTranscriptBlockModel | null): boolean {
  return block?.status === "inProgress";
}

function hasVisibleFinalAssistantMessage(
  block: ThreadTranscriptBlockModel | null,
): boolean {
  if (block?.type !== "assistantMessage") return false;
  if (block.entry.assistantPhase !== "final_answer") return false;
  return block.status === "completed"
    || (block.entry.markdownText ?? "").trim().length > 0;
}

function isLiveActivityEligible(input: ResolveThreadLiveActivityInput): boolean {
  if (!input.isLatestTurn || !input.isStreamingTurn || input.isBlocked) return false;
  if (input.showSafetyBufferingUi) return false;
  if (isIncompleteBlock(input.proposedPlanItem)) return false;
  if (hasVisibleFinalAssistantMessage(input.latestAssistantMessage)) return false;
  return true;
}

function resolveGroupPlacement(
  units: readonly ThreadAgentRenderUnit[],
): "activity-group" | "standalone" {
  const latest = units.at(-1)?.block;
  return latest?.type === "agentActivityGroup" && latest.liveHeaderKind != null
    ? "activity-group"
    : "standalone";
}

/**
 * Electron keeps this as a render-time decision. It does not materialize a
 * synthetic transcript item for the fallback; reasoning stays hidden and its
 * latest summary is projected into either the live group or a standalone row.
 */
export function resolveThreadLiveActivityPresentation(
  input: ResolveThreadLiveActivityInput,
): ThreadLiveActivityPresentation {
  const reasoningSummary = resolveReasoningSummary(input.agentItems);
  const isEligible = isLiveActivityEligible(input);
  if (!isEligible) {
    return {
      state: "none",
      placement: "none",
      reasoningSummary,
      isActivitySliceClosed: true,
    };
  }

  const placement = resolveGroupPlacement(input.agentBodyUnits);
  const latest = input.agentBodyUnits.at(-1)?.block;
  if (latest?.type === "agentActivityGroup" && latest.liveHeaderKind === "active") {
    return {
      state: input.isExploring ? "exploring" : "active",
      placement,
      reasoningSummary,
      isActivitySliceClosed: false,
    };
  }
  if (latest?.type === "agentActivityGroup" && latest.liveHeaderKind === "thinking") {
    return {
      state: "thinking",
      placement,
      reasoningSummary,
      isActivitySliceClosed: false,
    };
  }

  return {
    state: "thinking",
    placement: "standalone",
    reasoningSummary,
    isActivitySliceClosed: false,
  };
}

export function resolveThreadLiveActivityInputState(
  input: Omit<ResolveThreadLiveActivityInput, "agentBodyUnits">,
): Pick<ThreadLiveActivityPresentation, "reasoningSummary" | "isActivitySliceClosed"> {
  const presentation = resolveThreadLiveActivityPresentation({
    ...input,
    agentBodyUnits: [],
  });
  return {
    reasoningSummary: presentation.reasoningSummary,
    isActivitySliceClosed: presentation.isActivitySliceClosed,
  };
}
