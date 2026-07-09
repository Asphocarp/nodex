import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2/ThreadGoal";
import {
  buildCodexCanonicalSyntheticTurnParams,
  type CodexCanonicalConversationState,
  type CodexCanonicalTurnState,
} from "./codex-conversation-state";

const THREAD_GOAL_COMMAND = "/goal";

export interface CodexThreadGoalTranscriptProjection {
  readonly promptText: string;
  readonly message: string;
  readonly sentAtMs: number;
}

export function readCodexCanonicalThreadGoalTranscriptProjection(
  turn: CodexCanonicalTurnState,
): CodexThreadGoalTranscriptProjection | null {
  const input = turn.sidecar.params.input;
  const firstInput = input[0];
  const sentAtMs = turn.sidecar.turnStartedAtMs;
  if (
    turn.protocol.id !== null
    || turn.protocol.status !== "completed"
    || turn.items.length !== 0
    || input.length !== 1
    || firstInput?.type !== "text"
    || !firstInput.text.startsWith(`${THREAD_GOAL_COMMAND} `)
    || sentAtMs === null
  ) {
    return null;
  }

  return {
    promptText: firstInput.text,
    message: firstInput.text.slice(THREAD_GOAL_COMMAND.length + 1),
    sentAtMs,
  };
}

export function buildCodexThreadGoalTranscriptProjection(
  goal: ThreadGoal,
): CodexThreadGoalTranscriptProjection {
  return {
    promptText: `${THREAD_GOAL_COMMAND} ${goal.objective}`,
    message: goal.objective,
    sentAtMs: goal.updatedAt * 1_000,
  };
}

function isMatchingCodexThreadGoalTurn(
  turn: CodexCanonicalTurnState,
  projection: CodexThreadGoalTranscriptProjection,
): boolean {
  const input = turn.sidecar.params.input[0];
  return turn.protocol.id === null
    && turn.sidecar.turnStartedAtMs === projection.sentAtMs
    && turn.protocol.status === "completed"
    && turn.items.length === 0
    && turn.sidecar.params.input.length === 1
    && input?.type === "text"
    && input.text === projection.promptText;
}

/** Exact `N4e/P4e`: append the app-local raw goal turn; visibility comes from params.input. */
export function appendCodexCanonicalThreadGoalTranscriptTurn(
  state: CodexCanonicalConversationState,
  goal: ThreadGoal,
): CodexCanonicalConversationState {
  if (state.protocol.id !== goal.threadId) return state;
  const projection = buildCodexThreadGoalTranscriptProjection(goal);
  const previousTurn = state.turns.at(-1) ?? null;
  if (previousTurn && isMatchingCodexThreadGoalTurn(previousTurn, projection)) {
    return state;
  }

  const turn: CodexCanonicalTurnState = {
    protocol: {
      id: null,
      itemsView: "full",
      status: "completed",
      error: null,
      durationMs: null,
    },
    items: [],
    sidecar: {
      params: {
        ...buildCodexCanonicalSyntheticTurnParams(state, previousTurn),
        input: [{
          type: "text",
          text: projection.promptText,
          text_elements: [],
        }],
      },
      diff: null,
      turnStartedAtMs: projection.sentAtMs,
      firstTurnWorkItemStartedAtMs: null,
      finalAssistantStartedAtMs: null,
      hookRuns: [],
    },
  };

  return { ...state, turns: [...state.turns, turn] };
}
