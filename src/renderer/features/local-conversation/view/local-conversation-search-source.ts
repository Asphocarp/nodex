import type { CodexConversationTurn } from "../../../lib/types";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import type { ThreadSearchUnitModel } from "../thread-stage-types";
import { buildTurnRenderModel } from "../projection/build-turn-render-model";

export interface LocalConversationSearchSourceTurn {
  turn: CodexConversationTurn;
  turnKey: string;
  requests: CodexTurnScopedConversationRequest[];
}

interface CachedSearchTurnState {
  turn: CodexConversationTurn;
  requests: CodexTurnScopedConversationRequest[];
  units: ThreadSearchUnitModel[];
}

export interface LocalConversationSearchSource {
  routeContextId: string;
  getTurns: () => LocalConversationSearchSourceTurn[];
  scrollAdapter: {
    scrollToTurn: (
      turnKey: string,
      options?: { signal?: AbortSignal },
    ) => Promise<void>;
    getTurnContainer: (turnKey: string) => HTMLElement | null;
  };
}

export function createLocalConversationSearchSource(input: LocalConversationSearchSource) {
  const cachedUnitsByTurnKey = new Map<string, CachedSearchTurnState>();

  return {
    ...input,
    findMatches(query: string): ThreadSearchUnitModel[] {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) return [];

      return input.getTurns().flatMap(({ turn, turnKey, requests }) => {
        const cached = cachedUnitsByTurnKey.get(turnKey);
        let units: ThreadSearchUnitModel[];

        if (cached && cached.turn === turn && cached.requests === requests) {
          units = cached.units;
        } else {
          units = buildTurnRenderModel({
            turn,
            requests,
            isLatestTurn: false,
            isStreamingTurn: turn.status === "inProgress",
            canEditTurnUserPrefix: false,
            canForkTurn: false,
          }).searchUnits;
          cachedUnitsByTurnKey.set(turnKey, { turn, requests, units });
        }

        return units.filter((unit) =>
          unit.text.toLowerCase().includes(normalizedQuery),
        );
      });
    },
  };
}
