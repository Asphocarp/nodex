import { invoke } from "@/lib/api";
import type { CardInput, CardUpdateMutationResult } from "@/lib/types";
import type { CardStageHandlers } from "@/lib/use-card-stage";
import { createUuidV7 } from "../../../shared/card-id";
import { isCardStatus } from "../../../shared/card-status";
import { commitCardLifecycleIntent } from "@/lib/card-lifecycle-runtime";
import { commitPrimaryDatabaseCardDrag } from "@/lib/primary-database-card-drag-runtime";
import {
  commitCardMetadataPropertyPatch,
  isCardMetadataPropertyPatch,
} from "@/lib/card-metadata-property-runtime";
import {
  CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
  findCardDocumentPatchFields,
} from "../../../shared/card-content-authority";

export function makeRemoteCardStageHandlers(projectId: string): CardStageHandlers {
  return {
    onPatch: () => {
      // no-op for remote-opened sessions
    },
    onUpdate: async (columnId: string, cardId: string, updates: Partial<CardInput>) => {
      void columnId;
      if (findCardDocumentPatchFields(updates).length > 0) {
        return {
          status: "error",
          error: CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
        } satisfies CardUpdateMutationResult;
      }
      if (!isCardMetadataPropertyPatch(updates)) {
        return {
          status: "error",
          error: "No mutable Card metadata was specified",
        } satisfies CardUpdateMutationResult;
      }
      return await commitCardMetadataPropertyPatch({
        projectId,
        cardBlockId: cardId,
        mutationId: crypto.randomUUID(),
        patch: updates,
      });
    },
    onDelete: async (columnId: string, cardId: string) => {
      void columnId;
      await commitCardLifecycleIntent({
        kind: "delete",
        projectId,
        operationId: crypto.randomUUID(),
        cardId,
      });
    },
    onMove: async (fromStatus: string, cardId: string, toStatus: string) => {
      if (!isCardStatus(fromStatus) || !isCardStatus(toStatus)) {
        throw new Error("Card Stage move requires canonical Card statuses");
      }
      await commitPrimaryDatabaseCardDrag({
        projectId,
        operationId: crypto.randomUUID(),
        move: { cardId, fromStatus, toStatus },
      });
    },
    onCompleteOccurrence: async (cardId: string, occurrenceStart: Date) => {
      await invoke("card:occurrence:complete", projectId, {
        operationId: crypto.randomUUID(),
        createdCardId: createUuidV7(),
        cardId,
        occurrenceStart,
        source: "card-stage",
      });
    },
    onSkipOccurrence: async (cardId: string, occurrenceStart: Date) => {
      await invoke("card:occurrence:skip", projectId, {
        operationId: crypto.randomUUID(),
        cardId,
        occurrenceStart,
        source: "card-stage",
      });
    },
  };
}
