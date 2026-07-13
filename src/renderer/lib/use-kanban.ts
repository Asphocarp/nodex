import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  buildCompleteOrSkipOccurrenceTransform,
  buildCreateCardTransform,
  buildDeleteCardTransform,
  buildMoveCardTransform,
  buildMoveCardsTransform,
  buildPatchCardTransform,
  conflictKeyForCard,
  conflictKeysForCreate,
  conflictKeysForDelete,
  conflictKeysForMove,
  conflictKeysForMoveMany,
  conflictKeysForPatch,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import { createUuidV7 } from "../../shared/card-id";
import { isCardStatus } from "../../shared/card-status";
import {
  CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
  findCardDocumentPatchFields,
} from "../../shared/card-content-authority";
import type {
  CalendarOccurrence,
  Card,
  CardCreateInput,
  CardCreatePlacement,
  CardInput,
  CardUpdateMutationResult,
  CardUpdateResult,
  CardOccurrenceActionInput,
  CardOccurrenceCompleteInput,
  CardOccurrenceUpdateInput,
  MoveCardInput,
  MoveCardsInput,
} from "./types";
import {
  invoke,
  readPrimaryDatabaseDescriptor,
  transferCardProject,
} from "./api";
import type { CardProjectTransferReceipt } from "../../shared/card-project-transfer";
import { getKanbanProjectStore } from "./kanban-store";
import { getDatabaseRowDetail, setDatabaseRowDetail } from "./database-row-detail-store";
import { commitPrimaryDatabaseCardDrag } from "./primary-database-card-drag-runtime";
import { commitPrimaryDatabaseCardDragMany } from "./primary-database-card-drag-many-runtime";
import { commitCardLifecycleIntent } from "./card-lifecycle-runtime";
import {
  commitCardMetadataPropertyPatch,
  isCardMetadataPropertyPatch,
} from "./card-metadata-property-runtime";

interface UseKanbanOptions {
  projectId: string;
  databaseViewId?: string;
  sessionId?: string;
  onMutation?: () => void;
  enabled?: boolean;
}

type NewCardOccurrenceAction = Omit<
  CardOccurrenceActionInput,
  "operationId"
>;
type NewCardOccurrenceComplete = Omit<
  CardOccurrenceCompleteInput,
  "operationId" | "createdCardId"
>;
type NewCardOccurrenceUpdate = Omit<
  CardOccurrenceUpdateInput,
  "operationId" | "createdCardId"
>;

interface MoveCardToProjectIntentInput {
  readonly cardId: string;
  readonly sourceStatus: Card["status"];
  readonly targetProjectId: string;
  readonly targetStatus?: Card["status"];
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unknown error";
}

function ensureCreateInputId(input: CardCreateInput): CardCreateInput {
  if (input.id && input.id.trim().length > 0) return input;
  return {
    ...input,
    id: createUuidV7(),
  };
}

function normalizeOccurrenceUpdatesToCardPatch(
  input: CardOccurrenceUpdateInput,
): Partial<CardInput> {
  const patch: Partial<CardInput> = {};
  if (Object.prototype.hasOwnProperty.call(input.updates, "scheduledStart")) patch.scheduledStart = input.updates.scheduledStart;
  if (Object.prototype.hasOwnProperty.call(input.updates, "scheduledEnd")) patch.scheduledEnd = input.updates.scheduledEnd;
  if (Object.prototype.hasOwnProperty.call(input.updates, "isAllDay")) patch.isAllDay = input.updates.isAllDay;
  if (Object.prototype.hasOwnProperty.call(input.updates, "recurrence")) patch.recurrence = input.updates.recurrence;
  if (Object.prototype.hasOwnProperty.call(input.updates, "reminders")) patch.reminders = input.updates.reminders;
  if (Object.prototype.hasOwnProperty.call(input.updates, "scheduleTimezone")) patch.scheduleTimezone = input.updates.scheduleTimezone;
  return patch;
}

function buildCommittedCardDetailFromUpdate(
  existing: Card | null,
  result: Extract<CardUpdateResult, { status: "updated" }>,
): Card | null {
  if (!existing) return null;

  return {
    ...result.summary,
    description: existing.description,
  };
}

export function useKanban(options: UseKanbanOptions) {
  const {
    projectId,
    databaseViewId,
    sessionId,
    onMutation,
    enabled = true,
  } = options;
  const store = useMemo(
    () => getKanbanProjectStore(projectId, databaseViewId ?? null),
    [databaseViewId, projectId],
  );

  const subscribe = useCallback(
    (listener: () => void) => enabled
      ? store.subscribe(listener)
      : () => undefined,
    [enabled, store],
  );
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot);

  const fetchBoard = useCallback(async () => {
    await store.fetchBoard();
  }, [store]);

  const requireWritableSelectedView = useCallback((): boolean => {
    if (!databaseViewId) return true;
    const databaseView = store.getSnapshot().databaseView;
    if (databaseView?.primaryWriteCompatible) return true;
    store.setError(
      databaseView?.readOnlyReason ??
        "The selected Database View is not ready for writes",
    );
    return false;
  }, [databaseViewId, store]);

  const createCard = useCallback(
    async (
      columnId: string,
      input: CardCreateInput,
      placement: CardCreatePlacement = "bottom",
    ): Promise<Card | null> => {
      if (!requireWritableSelectedView()) return null;
      if (!isCardStatus(columnId)) {
        throw new Error("Card creation requires a canonical Card status");
      }
      const createInput = ensureCreateInputId(input);
      const optimisticCard = createOptimisticCard(createInput);
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<Card>({
        kind: "card:create",
        conflictKeys: conflictKeysForCreate(columnId, optimisticCard.id),
        apply: buildCreateCardTransform(columnId, optimisticCard, placement),
        runRemote: async () => {
          const committed = await commitCardLifecycleIntent({
            kind: "create",
            projectId,
            operationId,
            clientSessionId: sessionId,
            cardId: optimisticCard.id,
            status: columnId,
            input: createInput,
            placement,
          });
          if (!committed.card) {
            throw new Error("Created Card is missing from canonical authority");
          }
          return committed.card;
        },
      });

      if (!outcome.ok) return null;
      if (outcome.result) {
        setDatabaseRowDetail(projectId, outcome.result);
        store.applyRemoteCard(outcome.result);
      }
      onMutation?.();
      return outcome.result ?? null;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const updateCard = useCallback(
    async (
      columnId: string,
      cardId: string,
      updates: Partial<CardInput>,
    ): Promise<CardUpdateMutationResult> => {
      if (!requireWritableSelectedView()) {
        return { status: "error", error: "The selected Database View is read-only" };
      }
      const documentFields = findCardDocumentPatchFields(updates);
      if (documentFields.length > 0) {
        return {
          status: "error",
          error: CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
        };
      }
      if (!isCardMetadataPropertyPatch(updates)) {
        return { status: "error", error: "No mutable Card metadata was specified" };
      }
      const conflictKeys = conflictKeysForPatch(cardId, updates);
      const metadataMutationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<CardUpdateResult>({
        kind: "block:properties",
        conflictKeys,
        apply: buildPatchCardTransform(columnId, cardId, updates, { bumpRevision: true }),
        runRemote: async () => await commitCardMetadataPropertyPatch({
          projectId,
          cardBlockId: cardId,
          mutationId: metadataMutationId,
          clientSessionId: sessionId,
          patch: updates,
        }),
        refreshOnSuccess: false,
      });

      if (!outcome.ok) {
        return {
          status: "error",
          error: outcome.error?.message ?? "Failed to update card",
        };
      }

      const result = outcome.result;
      if (!result) {
        return {
          status: "error",
          error: "Missing card update result",
        };
      }

      if (result.status === "updated") {
        const committedDetail = buildCommittedCardDetailFromUpdate(
          getDatabaseRowDetail(projectId, cardId),
          result,
        );
        if (committedDetail) {
          setDatabaseRowDetail(projectId, committedDetail, { acceptEqualRevision: true });
        }
        store.applyRemoteCardSummary(result.summary);
        onMutation?.();
        return result;
      }

      if (result.status === "conflict") {
        setDatabaseRowDetail(projectId, result.card);
        store.applyRemoteCard(result.card);
        store.resolveConflict(conflictKeys);
        await store.refreshBoard();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("nodex:card-update-conflict", {
            detail: {
              projectId,
              cardId,
            },
          }));
        }
        return result;
      }

      await store.refreshBoard();
      return result;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const getCard = useCallback(
    async (cardId: string, columnId?: string): Promise<Card | null> => {
      try {
        const card = (await invoke("database-row:get", projectId, cardId, columnId)) as Card | null;
        if (card) setDatabaseRowDetail(projectId, card);
        return card;
      } catch (err) {
        store.setError(toErrorMessage(err));
        return null;
      }
    },
    [projectId, store],
  );

  const deleteCard = useCallback(
    async (columnId: string, cardId: string): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<boolean>({
        kind: "card:delete",
        conflictKeys: conflictKeysForDelete(cardId),
        apply: buildDeleteCardTransform(columnId, cardId),
        runRemote: async () => {
          const committed = await commitCardLifecycleIntent({
            kind: "delete",
            projectId,
            operationId,
            clientSessionId: sessionId,
            cardId,
          });
          return committed.receipt.lifecycle === "deleted";
        },
      });
      if (!outcome.ok) return false;
      if (!outcome.result) {
        store.setError("Failed to delete card");
        return false;
      }
      onMutation?.();
      return true;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const moveCard = useCallback(
    async (input: MoveCardInput): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<boolean>({
        kind: "database:position",
        conflictKeys: conflictKeysForMove(input),
        apply: buildMoveCardTransform(input),
        runRemote: async () => await commitPrimaryDatabaseCardDrag({
          projectId,
          clientSessionId: sessionId,
          operationId,
          move: input,
        }),
      });
      if (!outcome.ok) return false;
      if (!outcome.result) {
        store.setError("Failed to move card");
        return false;
      }
      onMutation?.();
      return true;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const moveCards = useCallback(
    async (input: MoveCardsInput): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<boolean>({
        kind: "database:position-many",
        conflictKeys: conflictKeysForMoveMany(input),
        apply: buildMoveCardsTransform(input),
        runRemote: async () => await commitPrimaryDatabaseCardDragMany({
          projectId,
          clientSessionId: sessionId,
          operationId,
          move: input,
        }),
      });
      if (!outcome.ok) return false;
      if (!outcome.result) {
        store.setError("Failed to move cards");
        return false;
      }
      onMutation?.();
      return true;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const moveCardToProject = useCallback(
    async (
      input: MoveCardToProjectIntentInput,
    ): Promise<CardProjectTransferReceipt | null> => {
      if (!requireWritableSelectedView()) return null;
      const targetDescriptor = await readPrimaryDatabaseDescriptor(
        input.targetProjectId,
      );
      const descriptor = targetDescriptor.ok
        ? targetDescriptor.value.value
        : null;
      const targetView = descriptor?.views.find(
        (view) => view.isPrimary && view.lifecycle === "active",
      );
      if (!descriptor || !targetView) {
        store.setError(
          targetDescriptor.ok
            ? "Target Project has no active primary Database View"
            : targetDescriptor.error.message,
        );
        return null;
      }

      const operationId = crypto.randomUUID();
      const outcome =
        await store.runOptimisticMutation<CardProjectTransferReceipt>({
          kind: "card:project-transfer",
          conflictKeys: conflictKeysForDelete(input.cardId),
          apply: buildDeleteCardTransform(input.sourceStatus, input.cardId),
          runRemote: async () => {
            const result = await transferCardProject(projectId, {
              version: 2,
              operationId,
              sourceProjectId: projectId,
              targetProjectId: input.targetProjectId,
              cardId: input.cardId,
              target: {
                databaseBlockId: descriptor.database.blockId,
                viewId: targetView.id,
                status: input.targetStatus ?? input.sourceStatus,
              },
            });
            if (result.ok) return result.value;
            throw new Error(result.error.message);
          },
        });

      if (!outcome.ok) return null;
      onMutation?.();
      return outcome.result ?? null;
    },
    [onMutation, projectId, requireWritableSelectedView, store],
  );

  const listCalendarOccurrences = useCallback(
    async (
      windowStart: Date,
      windowEnd: Date,
      searchQuery?: string,
    ): Promise<CalendarOccurrence[]> => {
      try {
        const result = (await invoke(
          "calendar:occurrences",
          projectId,
          windowStart,
          windowEnd,
          searchQuery,
        )) as { occurrences: CalendarOccurrence[] };
        return result.occurrences.map((occurrence) => ({
          ...occurrence,
          created: asDate(occurrence.created),
          dueDate: occurrence.dueDate ? asDate(occurrence.dueDate) : undefined,
          scheduledStart: asDate(occurrence.scheduledStart ?? occurrence.occurrenceStart),
          scheduledEnd: asDate(occurrence.scheduledEnd ?? occurrence.occurrenceEnd),
          occurrenceStart: asDate(occurrence.occurrenceStart),
          occurrenceEnd: asDate(occurrence.occurrenceEnd),
        }));
      } catch (err) {
        store.setError(toErrorMessage(err));
        return [];
      }
    },
    [projectId, store],
  );

  const completeOccurrence = useCallback(
    async (input: NewCardOccurrenceComplete): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const command: CardOccurrenceCompleteInput = {
        ...input,
        operationId: crypto.randomUUID(),
        createdCardId: createUuidV7(),
      };
      const outcome = await store.runOptimisticMutation<{ success: boolean; error?: string }>({
        kind: "card:occurrence:complete",
        conflictKeys: [conflictKeyForCard(command.cardId)],
        apply: buildCompleteOrSkipOccurrenceTransform(command.cardId),
        runRemote: async () => (await invoke(
          "card:occurrence:complete",
          projectId,
          command,
          sessionId,
        )) as { success: boolean; error?: string },
      });

      if (!outcome.ok) return false;
      if (!outcome.result?.success) {
        store.setError(outcome.result?.error ?? "Failed to complete occurrence");
        return false;
      }
      onMutation?.();
      return true;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const skipOccurrence = useCallback(
    async (input: NewCardOccurrenceAction): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const command: CardOccurrenceActionInput = {
        ...input,
        operationId: crypto.randomUUID(),
      };
      const outcome = await store.runOptimisticMutation<{ success: boolean; error?: string }>({
        kind: "card:occurrence:skip",
        conflictKeys: [conflictKeyForCard(command.cardId)],
        apply: buildCompleteOrSkipOccurrenceTransform(command.cardId),
        runRemote: async () => (await invoke(
          "card:occurrence:skip",
          projectId,
          command,
          sessionId,
        )) as { success: boolean; error?: string },
      });

      if (!outcome.ok) return false;
      if (!outcome.result?.success) {
        store.setError(outcome.result?.error ?? "Failed to skip occurrence");
        return false;
      }
      onMutation?.();
      return true;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const updateOccurrence = useCallback(
    async (input: NewCardOccurrenceUpdate): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const command = {
        ...input,
        operationId: crypto.randomUUID(),
        ...(input.scope === "all" ? {} : { createdCardId: createUuidV7() }),
      } as CardOccurrenceUpdateInput;
      const optimisticPatch = normalizeOccurrenceUpdatesToCardPatch(command);
      const outcome = await store.runOptimisticMutation<{ success: boolean; error?: string }>({
        kind: "card:occurrence:update",
        conflictKeys: conflictKeysForPatch(command.cardId, optimisticPatch),
        apply: buildPatchCardTransform(undefined, command.cardId, optimisticPatch),
        runRemote: async () => (await invoke(
          "card:occurrence:update",
          projectId,
          command,
          sessionId,
        )) as { success: boolean; error?: string },
      });

      if (!outcome.ok) return false;
      if (!outcome.result?.success) {
        store.setError(outcome.result?.error ?? "Failed to update occurrence");
        return false;
      }
      onMutation?.();
      return true;
    },
    [onMutation, projectId, requireWritableSelectedView, sessionId, store],
  );

  const patchCard = useCallback(
    (columnId: string, cardId: string, updates: Partial<CardInput>) => {
      if (!requireWritableSelectedView()) return;
      store.enqueueLocalOverlay({
        kind: "card:patch-local",
        conflictKeys: conflictKeysForPatch(cardId, updates),
        apply: buildPatchCardTransform(columnId, cardId, updates),
      });
    },
    [requireWritableSelectedView, store],
  );

  const clearLastMutationError = useCallback(() => {
    store.clearLastMutationError();
  }, [store]);

  return {
    board: snapshot.board,
    databaseView: snapshot.databaseView,
    cardIndex: snapshot.cardIndex,
    loading: snapshot.loading,
    error: snapshot.error,
    pendingMutationCount: snapshot.pendingMutationCount,
    lastMutationError: snapshot.lastMutationError,
    clearLastMutationError,
    refresh: fetchBoard,
    createCard,
    getCard,
    updateCard,
    deleteCard,
    moveCard,
    moveCards,
    moveCardToProject,
    listCalendarOccurrences,
    completeOccurrence,
    skipOccurrence,
    updateOccurrence,
    patchCard,
  };
}
