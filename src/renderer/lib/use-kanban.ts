import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  buildCompleteOrSkipOccurrenceTransform,
  buildPatchPageTransform,
  conflictKeyForCard,
  conflictKeysForPatch,
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
  PageUpdateField,
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
  isPageMetadataPatch,
} from "./page-detail-metadata-runtime";
import { pageInputToSummaryPatch } from "../../shared/page-summary";
import { planFractionalRank } from "../../shared/block-records";
import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";

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

const hasOwn = (value: object, key: PropertyKey): boolean => Object.hasOwn(value, key);

const serializeRecordProperty = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeRecordProperty);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, serializeRecordProperty(entry)]),
  );
};

const pageMetadataToRecordProperties = (
  current: Readonly<Record<string, unknown>>,
  updates: Partial<PageInput>,
): Readonly<Record<string, unknown>> => {
  const next: Record<string, unknown> = { ...current };
  const fields = [
    "status",
    "priority",
    "estimate",
    "tags",
    "dueDate",
    "scheduledStart",
    "scheduledEnd",
    "isAllDay",
    "recurrence",
    "reminders",
    "scheduleTimezone",
    "assignee",
    "runInTarget",
    "runInLocalPath",
    "runInBaseBranch",
    "runInWorktreePath",
    "runInEnvironmentPath",
  ] as const;
  for (const field of fields) {
    if (!hasOwn(updates, field)) continue;
    const value = updates[field];
    if (value === undefined || (value === null && field !== "isAllDay")) {
      delete next[field];
      continue;
    }
    next[field] = serializeRecordProperty(value);
  }
  return next;
};

const pageCreateToRecordProperties = (
  input: PageCreateInput,
  status: string,
): Readonly<Record<string, unknown>> => ({
  ...pageMetadataToRecordProperties({}, { ...input, status: status as PageInput["status"] }),
  title: input.title,
  richTitle: plainTextToPortableRichText(input.title),
  description: input.description ?? "",
  createdAt: new Date().toISOString(),
});

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

  const refreshAtLeast = useCallback(async (minimumCommitSeq: number) => {
    await store.refreshBoardAtLeast(minimumCommitSeq);
  }, [store]);

  const promoteBlockToPage = useCallback(
    async (input: {
      blockId: string;
      groupKey: string;
      beforePageId?: string;
    }): Promise<boolean> => {
      try {
        await store.promoteBlockToPage({
          ...input,
          actorId: `renderer:${projectId}`,
          sessionId: sessionId ?? "renderer",
        });
        onMutation?.();
        return true;
      } catch (error) {
        store.setError(toErrorMessage(error));
        return false;
      }
    },
    [onMutation, projectId, sessionId, store],
  );

  const promoteBlocksToPage = useCallback(
    async (input: {
      blockIds: readonly string[];
      groupKey: string;
      beforePageId?: string;
    }): Promise<boolean> => {
      try {
        await store.promoteBlocksToPage({
          ...input,
          actorId: `renderer:${projectId}`,
          sessionId: sessionId ?? "renderer",
        });
        onMutation?.();
        return true;
      } catch (error) {
        store.setError(toErrorMessage(error));
        return false;
      }
    },
    [onMutation, projectId, sessionId, store],
  );

  const loadMore = useCallback(async () => {
    await store.loadMore();
  }, [store]);

  const loadMoreGroup = useCallback(async (scopeKey: string) => {
    await store.loadMoreGroup(scopeKey);
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
      try {
        await store.createBlockRecordPage({
          blockId: createInput.id!,
          properties: pageCreateToRecordProperties(createInput, columnId),
          materializedJson: plainTextToPortableRichText(createInput.title),
          groupKey: columnId,
          placement,
          actorId: `renderer:${projectId}`,
          sessionId: sessionId ?? "renderer",
        });
      } catch (error) {
        store.setError(toErrorMessage(error));
        return null;
      }
      const summary = store.getSnapshot().pageIndex.get(createInput.id!);
      if (!summary) {
        store.setError("Created Page did not enter the canonical Board window");
        return null;
      }
      const result: DatabasePage = {
        ...summary,
        description: createInput.description ?? "",
        ...(createInput.recurrence !== undefined ? { recurrence: createInput.recurrence ?? undefined } : {}),
        ...(createInput.reminders !== undefined ? { reminders: createInput.reminders } : {}),
        ...(createInput.scheduleTimezone !== undefined ? { scheduleTimezone: createInput.scheduleTimezone ?? undefined } : {}),
        ...(createInput.runInTarget !== undefined ? { runInTarget: createInput.runInTarget } : {}),
        ...(createInput.runInLocalPath !== undefined ? { runInLocalPath: createInput.runInLocalPath ?? undefined } : {}),
        ...(createInput.runInBaseBranch !== undefined ? { runInBaseBranch: createInput.runInBaseBranch ?? undefined } : {}),
        ...(createInput.runInWorktreePath !== undefined ? { runInWorktreePath: createInput.runInWorktreePath ?? undefined } : {}),
        ...(createInput.runInEnvironmentPath !== undefined ? { runInEnvironmentPath: createInput.runInEnvironmentPath ?? undefined } : {}),
      };
      setDatabaseRowDetail(projectId, result);
      onMutation?.();
      return result;
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
      const currentSummary = store.getSnapshot().pageIndex.get(pageId);
      const window = store.getBlockRecordWindow();
      const record = window?.records.find((candidate) => candidate.id === pageId);
      if (!currentSummary || !record) {
        return { status: "not_found" };
      }
      const properties = pageMetadataToRecordProperties(record.properties, updates);
      const nextStatus = Object.prototype.hasOwnProperty.call(updates, "status")
        ? updates.status ?? currentSummary.status
        : undefined;
      try {
        await store.updateBlockRecord({
          blockId: pageId,
          properties,
          ...(nextStatus !== undefined
            ? {
              view: {
                groupKey: nextStatus,
                rankKey: window?.viewPositions.find((position) => (
                  position.viewId === window.viewId && position.blockId === pageId
                ))?.rankKey ?? "80000000000000000000000000000000",
              },
            }
            : {}),
          actorId: `renderer:${projectId}`,
          sessionId: sessionId ?? "renderer",
        });
      } catch (error) {
        return {
          status: "error",
          error: toErrorMessage(error),
        };
      }
      const nextSummary = store.getSnapshot().pageIndex.get(pageId);
      if (!nextSummary) return { status: "not_found" };
      const changedFields = Object.keys(updates) as PageUpdateField[];
      const summary = {
        ...nextSummary,
        ...pageInputToSummaryPatch(updates),
        revision: store.getSnapshot().pageIndex.get(pageId)?.revision ?? record.revision + 1,
      };
      const committedDetail = buildCommittedPageDetailFromUpdate(
        getDatabaseRowDetail(projectId, pageId),
        {
          status: "updated",
          projectId,
          pageId,
          revision: summary.revision,
          summary,
          changedFields,
          didMutate: true,
        },
      );
      if (committedDetail) {
        setDatabaseRowDetail(projectId, committedDetail, { acceptEqualRevision: true });
      }
      onMutation?.();
      return {
        status: "updated",
        projectId,
        pageId,
        revision: summary.revision,
        summary,
        changedFields,
        didMutate: true,
      };
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
    async (columnId: string | undefined, pageId: string): Promise<boolean> => {
      if (!requireWritableSelectedView()) return false;
      try {
        await store.archiveBlockRecord({
          blockId: pageId,
          actorId: `renderer:${projectId}`,
          sessionId: sessionId ?? "renderer",
        });
      } catch (error) {
        store.setError(toErrorMessage(error));
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
      const window = store.getBlockRecordWindow();
      const record = window?.records.find((candidate) => candidate.id === input.pageId);
      const currentPosition = window?.viewPositions.find((position) => (
        position.viewId === window.viewId && position.blockId === input.pageId
      ));
      if (!window || !record || !currentPosition || !window.viewId) {
        store.setError("The BlockRecord Board window is not loaded");
        return false;
      }
      const targetItems = window.viewPositions
        .filter((position) => (
          position.viewId === window.viewId
          && position.groupKey === input.toStatus
          && position.blockId !== input.pageId
        ))
        .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
        .map((position) => ({ id: position.blockId, rankKey: position.rankKey }));
      const beforePageId = input.newOrder === undefined
        ? undefined
        : targetItems[Math.max(0, Math.min(input.newOrder, targetItems.length))]?.id;
      const rankPlan = planFractionalRank(targetItems, input.pageId, beforePageId);
      try {
        await store.updateBlockRecord({
          blockId: input.pageId,
          properties: pageMetadataToRecordProperties(
            record.properties,
            {
              status: input.toStatus,
              ...(input.fieldPatch ?? {}),
            },
          ),
          view: {
            groupKey: input.toStatus,
            rankKey: rankPlan.rankKey,
          },
          actorId: `renderer:${projectId}`,
          sessionId: sessionId ?? "renderer",
        });
      } catch (error) {
        store.setError(toErrorMessage(error));
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
      const window = store.getBlockRecordWindow();
      if (!window?.viewId) {
        store.setError("The BlockRecord Board window is not loaded");
        return false;
      }
      const uniquePageIds = [...new Set(input.pageIds)];
      if (uniquePageIds.length === 0) return false;
      const moving = new Set(uniquePageIds);
      const targetItems = window.viewPositions
        .filter((position) => (
          position.viewId === window.viewId
          && position.groupKey === input.toStatus
          && !moving.has(position.blockId)
        ))
        .sort((left, right) => left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId))
        .map((position) => ({ id: position.blockId, rankKey: position.rankKey }));
      const insertionIndex = input.newOrder === undefined
        ? targetItems.length
        : Math.max(0, Math.min(input.newOrder, targetItems.length));
      const entries: {
        blockId: string;
        properties: Readonly<Record<string, unknown>>;
        view: { groupKey: string; rankKey: string };
      }[] = [];
      const viewRebalances = new Map<string, {
        blockId: string;
        groupKey: string;
        rankKey: string;
      }>();
      for (const [offset, pageId] of uniquePageIds.entries()) {
        const record = window.records.find((candidate) => candidate.id === pageId);
        if (!record) {
          store.setError(`BlockRecord ${pageId} is not available`);
          return false;
        }
        const beforePageId = targetItems[insertionIndex + offset]?.id;
        const rankPlan = planFractionalRank(targetItems, pageId, beforePageId);
        for (const [rebalanceId, rankKey] of rankPlan.rebalancedRankKeys) {
          const movingEntry = entries.find((entry) => entry.blockId === rebalanceId);
          if (movingEntry) {
            movingEntry.view.rankKey = rankKey;
            continue;
          }
          if (!moving.has(rebalanceId)) {
            viewRebalances.set(rebalanceId, {
              blockId: rebalanceId,
              groupKey: input.toStatus,
              rankKey,
            });
          }
          const item = targetItems.find((candidate) => candidate.id === rebalanceId);
          if (item) item.rankKey = rankKey;
        }
        targetItems.splice(insertionIndex + offset, 0, {
          id: pageId,
          rankKey: rankPlan.rankKey,
        });
        entries.push({
          blockId: pageId,
          properties: pageMetadataToRecordProperties(record.properties, {
            status: input.toStatus,
            ...(input.fieldPatch ?? {}),
          }),
          view: { groupKey: input.toStatus, rankKey: rankPlan.rankKey },
        });
      }
      try {
        await store.updateBlockRecords({
          entries,
          viewRebalances: [...viewRebalances.values()],
          actorId: `renderer:${projectId}`,
          sessionId: sessionId ?? "renderer",
        });
      } catch (error) {
        store.setError(toErrorMessage(error));
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
    groupPagination: snapshot.groupPagination,
    totalRows: snapshot.totalRows,
    clearLastMutationError,
    refresh: fetchBoard,
    refreshAtLeast,
    promoteBlockToPage,
    promoteBlocksToPage,
    loadMore,
    loadMoreGroup,
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
