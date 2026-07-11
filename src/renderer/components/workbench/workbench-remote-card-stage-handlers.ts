import { invoke } from "@/lib/api";
import type { CardInput, CardUpdateMutationResult, CardUpdateResult } from "@/lib/types";
import type { CardStageHandlers } from "@/lib/use-card-stage";
import { createUuidV7 } from "../../../shared/card-id";
import { isCardStatus } from "../../../shared/card-status";
import { commitCardLifecycleIntent } from "@/lib/card-lifecycle-runtime";
import { commitPrimaryDatabaseCardDrag } from "@/lib/primary-database-card-drag-runtime";

export function makeRemoteCardStageHandlers(projectId: string): CardStageHandlers {
  return {
    onPatch: () => {
      // no-op for remote-opened sessions
    },
    onUpdate: async (columnId: string, cardId: string, updates: Partial<CardInput>) => {
      const result = await invoke("card:update", projectId, columnId, cardId, updates) as CardUpdateResult;
      return result as CardUpdateMutationResult;
    },
    onDelete: async (columnId: string, cardId: string) => {
      void columnId;
      await commitCardLifecycleIntent({
        kind: "delete",
        projectId,
        operationId: createUuidV7(),
        cardId,
      });
    },
    onMove: async (fromStatus: string, cardId: string, toStatus: string) => {
      if (!isCardStatus(fromStatus) || !isCardStatus(toStatus)) {
        throw new Error("Card Stage move requires canonical Card statuses");
      }
      await commitPrimaryDatabaseCardDrag({
        projectId,
        operationId: createUuidV7(),
        move: { cardId, fromStatus, toStatus },
      });
    },
    onCompleteOccurrence: async (cardId: string, occurrenceStart: Date) => {
      await invoke("card:occurrence:complete", projectId, { cardId, occurrenceStart });
    },
    onSkipOccurrence: async (cardId: string, occurrenceStart: Date) => {
      await invoke("card:occurrence:skip", projectId, { cardId, occurrenceStart });
    },
  };
}
