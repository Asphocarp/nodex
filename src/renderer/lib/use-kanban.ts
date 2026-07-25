import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  buildCompleteOrSkipOccurrenceTransform,
  buildCreateCardTransform,
  buildDeletePageTransform,
  buildMovePageTransform,
  buildMovePagesTransform,
  buildPatchPageTransform,
  conflictKeyForCard,
  conflictKeysForCreate,
  conflictKeysForDelete,
  conflictKeysForMove,
  conflictKeysForMoveMany,
  conflictKeysForPatch,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import { createUuidV7 } from "../../shared/uuid-v7";
import { isWorkflowStatus } from "../../shared/workflow-status";
import {
  PAGE_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
  findPageDocumentPatchFields,
} from "../../shared/page-content-authority";
import type {
  PageOccurrence,
  DatabasePage,
  PageCreateInput,
  PageCreatePlacement,
  PageInput,
  PageUpdateMutationResult,
  PageUpdateResult,
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
  MovePageInput,
  MovePagesInput,
} from "./types";
import {
  invoke,
} from "./api";
import { getKanbanProjectStore } from "./kanban-store";
import { getDatabaseRowDetail, setDatabaseRowDetail } from "./database-row-detail-store";
import {
  commitDatabasePageDrag,
  commitDatabasePagesDrag,
  databaseViewRenderModelToDragSnapshot,
} from "./database-page-drag-runtime";
import { commitPageLifecycleIntent } from "./page-lifecycle-runtime";
import {
  isPageMetadataPatch,
} from "./page-detail-metadata-runtime";
import { commitPageMetadataPatchForBoard } from "./page-metadata-board-runtime";

interface UseKanbanOptions {
  projectId: string;
  databaseViewId?: string;
  sessionId?: string;
  onMutation?: () => void;
  enabled?: boolean;
}

const MAX_CALENDAR_OCCURRENCES = 1_000;

type NewPageOccurrenceAction = Omit<
  PageOccurrenceActionInput,
  "operationId"
>;
type NewPageOccurrenceComplete = Omit<
  PageOccurrenceCompleteInput,
  "operationId" | "createdPageId"
>;
type NewPageOccurrenceUpdate = Omit<
  PageOccurrenceUpdateInput,
  "operationId" | "createdPageId"
>;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unknown error";
}

function ensureCreateInputId(input: PageCreateInput): PageCreateInput {
  if (input.id && input.id.trim().length > 0) return input;
  return {
    ...input,
    id: createUuidV7(),
  };
}

function normalizeOccurrenceUpdatesToPagePatch(
  input: PageOccurrenceUpdateInput,
): Partial<PageInput> {
  const patch: Partial<PageInput> = {};
  if (Object.prototype.hasOwnProperty.call(input.updates, "scheduledStart")) patch.scheduledStart = input.updates.scheduledStart;
  if (Object.prototype.hasOwnProperty.call(input.updates, "scheduledEnd")) patch.scheduledEnd = input.updates.scheduledEnd;
  if (Object.prototype.hasOwnProperty.call(input.updates, "isAllDay")) patch.isAllDay = input.updates.isAllDay;
  if (Object.prototype.hasOwnProperty.call(input.updates, "recurrence")) patch.recurrence = input.updates.recurrence;
  if (Object.prototype.hasOwnProperty.call(input.updates, "reminders")) patch.reminders = input.updates.reminders;
  if (Object.prototype.hasOwnProperty.call(input.updates, "scheduleTimezone")) patch.scheduleTimezone = input.updates.scheduleTimezone;
  return patch;
}

function buildCommittedPageDetailFromUpdate(
  existing: DatabasePage | null,
  result: Extract<PageUpdateResult, { status: "updated" }>,
): DatabasePage | null {
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

  const loadMore = useCallback(async () => {
    await store.loadMore();
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

  const createPage = useCallback(
    async (
      columnId: string,
      input: PageCreateInput,
      placement: PageCreatePlacement = "bottom",
    ): Promise<DatabasePage | null> => {
      if (!requireWritableSelectedView()) return null;
      if (!isWorkflowStatus(columnId)) {
        throw new Error("Page creation requires a canonical Page status");
      }
      const createInput = ensureCreateInputId(input);
      const optimisticCard = createOptimisticCard(createInput);
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<DatabasePage>({
        kind: "page:create",
        conflictKeys: conflictKeysForCreate(columnId, optimisticCard.id),
        apply: buildCreateCardTransform(columnId, optimisticCard, placement),
        runRemote: async () => {
          const committed = await commitPageLifecycleIntent({
            kind: "create",
            projectId,
            operationId,
            clientSessionId: sessionId,
            pageId: optimisticCard.id,
            status: columnId,
            input: createInput,
            placement,
          });
          if (!committed.boardProjection) {
            throw new Error("Created Page is missing from canonical authority");
          }
          return committed.boardProjection;
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

  const updatePage = useCallback(
    async (
      columnId: string,
      pageId: string,
      updates: Partial<PageInput>,
    ): Promise<PageUpdateMutationResult> => {
      if (!requireWritableSelectedView()) {
        return { status: "error", error: "The selected Database View is read-only" };
      }
      const documentFields = findPageDocumentPatchFields(updates);
      if (documentFields.length > 0) {
        return {
          status: "error",
          error: PAGE_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
        };
      }
      if (!isPageMetadataPatch(updates)) {
        return { status: "error", error: "No mutable Page metadata was specified" };
      }
      const conflictKeys = conflictKeysForPatch(pageId, updates);
      const metadataMutationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<PageUpdateResult>({
        kind: "block:properties",
        conflictKeys,
        apply: buildPatchPageTransform(columnId, pageId, updates, { bumpRevision: true }),
        runRemote: async () => await commitPageMetadataPatchForBoard({
          projectId,
          pageId: pageId,
          operationId: metadataMutationId,
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
        const committedDetail = buildCommittedPageDetailFromUpdate(
          getDatabaseRowDetail(projectId, pageId),
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
        setDatabaseRowDetail(projectId, result.page);
        store.applyRemoteCard(result.page);
        store.resolveConflict(conflictKeys);
        await store.refreshBoard();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("nodex:card-update-conflict", {
            detail: {
              projectId,
              pageId,
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

  const getPage = useCallback(
    async (pageId: string, columnId?: string): Promise<DatabasePage | null> => {
      try {
        const card = (await invoke("database-row:get", projectId, pageId, columnId)) as DatabasePage | null;
        if (card) setDatabaseRowDetail(projectId, card);
        return card;
      } catch (err) {
        store.setError(toErrorMessage(err));
        return null;
      }
    },
    [projectId, store],
  );

  const deletePage = useCallback(
    async (columnId: string, pageId: string): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<boolean>({
        kind: "page:delete",
        conflictKeys: conflictKeysForDelete(pageId),
        apply: buildDeletePageTransform(columnId, pageId),
        runRemote: async () => {
          const committed = await commitPageLifecycleIntent({
            kind: "delete",
            projectId,
            operationId,
            clientSessionId: sessionId,
            pageId: pageId,
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

  const movePage = useCallback(
    async (input: MovePageInput): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const databaseView = store.getSnapshot().databaseView;
      if (!databaseView) {
        store.setError("The Database View is not loaded");
        return false;
      }
      const dragSnapshot = databaseViewRenderModelToDragSnapshot(databaseView);
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<boolean>({
        kind: "database:position",
        conflictKeys: conflictKeysForMove(input),
        apply: buildMovePageTransform(input),
        runRemote: async () => await commitDatabasePageDrag({
          projectId,
          clientSessionId: sessionId,
          operationId,
          move: input,
          snapshot: dragSnapshot,
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

  const movePages = useCallback(
    async (input: MovePagesInput): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const databaseView = store.getSnapshot().databaseView;
      if (!databaseView) {
        store.setError("The Database View is not loaded");
        return false;
      }
      const dragSnapshot = databaseViewRenderModelToDragSnapshot(databaseView);
      const operationId = crypto.randomUUID();
      const outcome = await store.runOptimisticMutation<boolean>({
        kind: "database:position-many",
        conflictKeys: conflictKeysForMoveMany(input),
        apply: buildMovePagesTransform(input),
        runRemote: async () => await commitDatabasePagesDrag({
          projectId,
          clientSessionId: sessionId,
          operationId,
          move: input,
          snapshot: dragSnapshot,
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

  const listPageOccurrences = useCallback(
    async (
      windowStart: Date,
      windowEnd: Date,
      searchQuery?: string,
    ): Promise<PageOccurrence[]> => {
      try {
        const occurrences: PageOccurrence[] = [];
        let after: string | null = null;
        do {
          const result = (await invoke(
            "calendar:occurrences",
            projectId,
            windowStart,
            windowEnd,
            searchQuery,
            after,
          )) as {
            occurrences: PageOccurrence[];
            nextCursor: string | null;
          };
          occurrences.push(...result.occurrences);
          if (result.nextCursor === after && after !== null) {
            throw new Error("Calendar occurrence continuation did not advance");
          }
          after = occurrences.length < MAX_CALENDAR_OCCURRENCES
            ? result.nextCursor ?? null
            : null;
          if (
            occurrences.length >= MAX_CALENDAR_OCCURRENCES
            && result.nextCursor
          ) {
            store.setError(
              `Calendar is limited to ${MAX_CALENDAR_OCCURRENCES.toLocaleString()} occurrences; narrow the date range or search.`,
            );
          }
        } while (after !== null);
        return occurrences
          .slice(0, MAX_CALENDAR_OCCURRENCES)
          .map((occurrence) => ({
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
    async (input: NewPageOccurrenceComplete): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const command: PageOccurrenceCompleteInput = {
        ...input,
        operationId: crypto.randomUUID(),
        createdPageId: createUuidV7(),
      };
      const outcome = await store.runOptimisticMutation<{ success: boolean; error?: string }>({
        kind: "page:occurrence:complete",
        conflictKeys: [conflictKeyForCard(command.pageId)],
        apply: buildCompleteOrSkipOccurrenceTransform(command.pageId),
        runRemote: async () => (await invoke(
          "page:occurrence:complete",
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
    async (input: NewPageOccurrenceAction): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const command: PageOccurrenceActionInput = {
        ...input,
        operationId: crypto.randomUUID(),
      };
      const outcome = await store.runOptimisticMutation<{ success: boolean; error?: string }>({
        kind: "page:occurrence:skip",
        conflictKeys: [conflictKeyForCard(command.pageId)],
        apply: buildCompleteOrSkipOccurrenceTransform(command.pageId),
        runRemote: async () => (await invoke(
          "page:occurrence:skip",
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
    async (input: NewPageOccurrenceUpdate): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      const command = {
        ...input,
        operationId: crypto.randomUUID(),
        ...(input.scope === "all" ? {} : { createdPageId: createUuidV7() }),
      } as PageOccurrenceUpdateInput;
      const optimisticPatch = normalizeOccurrenceUpdatesToPagePatch(command);
      const outcome = await store.runOptimisticMutation<{ success: boolean; error?: string }>({
        kind: "page:occurrence:update",
        conflictKeys: conflictKeysForPatch(command.pageId, optimisticPatch),
        apply: buildPatchPageTransform(undefined, command.pageId, optimisticPatch),
        runRemote: async () => (await invoke(
          "page:occurrence:update",
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

  const patchPage = useCallback(
    (columnId: string, pageId: string, updates: Partial<PageInput>) => {
      if (!requireWritableSelectedView()) return;
      store.enqueueLocalOverlay({
        kind: "page:patch-local",
        conflictKeys: conflictKeysForPatch(pageId, updates),
        apply: buildPatchPageTransform(columnId, pageId, updates),
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
    pageIndex: snapshot.pageIndex,
    loading: snapshot.loading,
    loadingMore: snapshot.loadingMore,
    hasMore: snapshot.hasMore,
    error: snapshot.error,
    pendingMutationCount: snapshot.pendingMutationCount,
    lastMutationError: snapshot.lastMutationError,
    clearLastMutationError,
    refresh: fetchBoard,
    loadMore,
    createPage,
    getPage,
    updatePage,
    deletePage,
    movePage,
    movePages,
    listPageOccurrences,
    completeOccurrence,
    skipOccurrence,
    updateOccurrence,
    patchPage,
  };
}
