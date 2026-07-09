import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import { hasUnifiedDiffChanges } from "../../../lib/unified-diff-summary";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import type { VisibleConversationTurnEntry } from "../selectors";
import { bucketizeTurnItems } from "./bucketize-turn-items";
import {
  buildRendererItemStream,
  buildRendererItemStreamProjection,
} from "./build-renderer-item-stream";
import { collectTurnEndResourcePaths } from "./thread-summary-panel-output-model";
import { buildTurnViewModel } from "./build-turn-view-model";
import type {
  ThreadRendererItemModel,
  ThreadComposerShellBackgroundAgentRowModel,
  ThreadTranscriptBlockModel,
  ThreadTurnModel,
  ThreadWorkedForBlockModel,
} from "../thread-stage-types";

export interface BuildTurnRenderModelInput {
  turn: CodexConversationTurn;
  requests: CodexTurnScopedConversationRequest[];
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  canEditTurnUserPrefix?: boolean;
  canForkTurn?: boolean;
  backgroundAgents?: readonly ThreadComposerShellBackgroundAgentRowModel[];
  turnKey?: string;
}

export type TurnRenderSurface = "main" | "preview";

export interface SelectTurnRenderModelInput {
  entry: VisibleConversationTurnEntry;
  surface?: TurnRenderSurface;
  canEditTurnUserPrefix?: boolean;
  canForkTurn?: boolean;
  backgroundAgents?: readonly ThreadComposerShellBackgroundAgentRowModel[];
}

type TurnRenderModelBuilder = (input: BuildTurnRenderModelInput) => ThreadTurnModel;
type TurnRenderModelSelector = (input: SelectTurnRenderModelInput) => ThreadTurnModel;

function hasIncompleteElicitation(
  items: ReturnType<typeof buildRendererItemStream>,
): boolean {
  return items.some(
    (item) => item.type === "mcpServerElicitation" && item.status !== "completed",
  );
}

function isTranscriptTurnDiffItem(entry: CodexConversationItem): boolean {
  if (entry.semanticKind === "diff") return true;
  if (entry.type === "turn_diff" || entry.type === "turn-diff") return true;
  if (entry.rawItem && typeof entry.rawItem === "object") {
    return (entry.rawItem as { type?: unknown }).type === "turn-diff";
  }
  return false;
}

function hasTranscriptTurnDiffChanges(entry: CodexConversationItem): boolean {
  if (!isTranscriptTurnDiffItem(entry)) return false;
  if (typeof entry.rawItem !== "object" || entry.rawItem === null) return false;
  const unifiedDiff = (entry.rawItem as { unifiedDiff?: unknown }).unifiedDiff;
  return typeof unifiedDiff === "string" && hasUnifiedDiffChanges(unifiedDiff);
}

function buildDerivedTurnDiffEntry(
  turn: CodexConversationTurn,
  entries: readonly CodexConversationItem[],
): CodexConversationItem | null {
  const unifiedDiff = turn.diff?.trim();
  if (!unifiedDiff) return null;
  if (!hasUnifiedDiffChanges(unifiedDiff)) return null;
  if (entries.some(hasTranscriptTurnDiffChanges)) return null;

  const timestamp = turn.completedAt ?? turn.startedAt ?? turn.turnStartedAtMs ?? Date.now();
  const itemId = `turn-diff:${turn.turnId}`;
  return {
    threadId: turn.threadId,
    turnId: turn.turnId,
    itemId,
    entryId: itemId,
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: turn.status,
    rawItem: {
      type: "turn-diff",
      unifiedDiff: turn.diff,
      patchBatches: [],
      showRevertButton: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function appendDerivedTurnDiffEntry(turn: CodexConversationTurn): CodexConversationItem[] {
  const renderableEntries = turn.items.filter((entry) => (
    !isTranscriptTurnDiffItem(entry) || hasTranscriptTurnDiffChanges(entry)
  ));
  const derived = buildDerivedTurnDiffEntry(turn, renderableEntries);
  if (!derived) return renderableEntries;
  return [...renderableEntries, derived];
}

function resolveFiniteTimestamp(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTranscriptItem(item: ThreadRendererItemModel): item is ThreadTranscriptBlockModel {
  return "entry" in item;
}

function isUserItem(item: ThreadRendererItemModel): boolean {
  return item.type === "userMessage";
}

function findFirstNonUserIndex(items: ThreadRendererItemModel[]): number {
  return items.findIndex((item) => !isUserItem(item));
}

function findFirstFinalAnswerAssistantIndex(items: ThreadRendererItemModel[]): number {
  return items.findIndex((item) =>
    isTranscriptItem(item)
    && item.type === "assistantMessage"
    && item.entry.assistantPhase === "final_answer"
  );
}

function findLastAssistantIndex(items: ThreadRendererItemModel[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === "assistantMessage") return index;
  }
  return -1;
}

function hasNonUserItemBefore(items: ThreadRendererItemModel[], boundaryIndex: number): boolean {
  return items.slice(0, Math.max(boundaryIndex, 0)).some((item) => !isUserItem(item));
}

function hasRenderableFinalAssistantContent(item: ThreadRendererItemModel | undefined): boolean {
  if (!item || !isTranscriptItem(item) || item.type !== "assistantMessage") return false;
  if (item.entry.assistantPhase !== "final_answer") return false;
  if ((item.entry.markdownText?.trim().length ?? 0) > 0) return true;
  return item.status === "completed";
}

function resolveWorkedForBoundaryIndex(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
): number {
  if (turn.status === "interrupted") return -1;
  if (turn.status === "inProgress") {
    const finalAnswerIndex = findFirstFinalAnswerAssistantIndex(items);
    return finalAnswerIndex >= 0 ? finalAnswerIndex : items.length;
  }
  return findLastAssistantIndex(items);
}

function resolveWorkedForCompletedAtMs(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
  boundaryIndex: number,
): number | null {
  const finalAssistantStartedAtMs = resolveFiniteTimestamp(turn.finalAssistantStartedAtMs);
  if (finalAssistantStartedAtMs === null) return null;

  return hasRenderableFinalAssistantContent(items[boundaryIndex])
    ? finalAssistantStartedAtMs
    : null;
}

function buildWorkedForItem(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
  turnKey: string,
): ThreadWorkedForBlockModel | null {
  const startedAtMs = resolveFiniteTimestamp(turn.firstTurnWorkItemStartedAtMs);
  if (startedAtMs === null) return null;

  const boundaryIndex = resolveWorkedForBoundaryIndex(turn, items);
  if (boundaryIndex < 0) return null;
  if (!hasNonUserItemBefore(items, boundaryIndex)) return null;

  const completedAtMs = resolveWorkedForCompletedAtMs(turn, items, boundaryIndex);
  if (turn.status !== "inProgress" && completedAtMs === null) return null;

  return {
    id: `${turnKey}:worked-for`,
    turnId: turn.turnId,
    createdAt: startedAtMs,
    updatedAt: completedAtMs ?? startedAtMs,
    searchableText: "",
    type: "workedFor",
    status: completedAtMs === null ? "working" : "worked",
    startedAtMs,
    completedAtMs,
  };
}

function insertWorkedForItem(
  turn: CodexConversationTurn,
  items: ThreadRendererItemModel[],
  workedForItem: ThreadWorkedForBlockModel | null,
): ThreadRendererItemModel[] {
  if (!workedForItem) return items;

  const boundaryIndex = turn.status === "inProgress"
    ? findFirstNonUserIndex(items)
    : resolveWorkedForBoundaryIndex(turn, items);
  if (boundaryIndex < 0) return items;

  return [
    ...items.slice(0, boundaryIndex),
    workedForItem,
    ...items.slice(boundaryIndex),
  ];
}

export function buildTurnRenderModel(
  input: BuildTurnRenderModelInput,
): ThreadTurnModel {
  const turnKey = input.turnKey ?? input.turn.turnId;
  if (turnKey === null) {
    throw new Error("A nullable local turn requires its occurrence key");
  }
  const entries = appendDerivedTurnDiffEntry(input.turn);
  const rendererProjection = buildRendererItemStreamProjection({
    entries,
    requests: input.requests,
    turnStatus: input.turn.status,
    isLatestTurn: input.isLatestTurn,
    backgroundAgents: input.backgroundAgents,
    turnKey,
  });
  const baseItems = rendererProjection.items;
  const workedForItem = buildWorkedForItem(input.turn, baseItems, turnKey);
  const workedForTiming = workedForItem
    ? {
        status: workedForItem.status,
        startedAtMs: workedForItem.startedAtMs,
        completedAtMs: workedForItem.completedAtMs,
      }
    : null;
  const items = insertWorkedForItem(input.turn, baseItems, workedForItem);
  const buckets = bucketizeTurnItems({
    items,
    turnStatus: input.turn.status,
  });
  const isBlocked =
    buckets.approvalItem !== null
    || buckets.userInputItem !== null
    || buckets.interactiveRequestItem !== null
    || buckets.permissionRequestItems.length > 0
    || hasIncompleteElicitation(items);

  return buildTurnViewModel({
    turnId: input.turn.turnId,
    turnKey,
    turn: input.turn,
    buckets,
    workedForItem,
    workedForTiming,
    workedDurationMs: resolveFiniteTimestamp(input.turn.durationMs),
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked,
    subagentActivityState: rendererProjection.subagentActivityState,
    canEditTurnUserPrefix: input.turn.turnId !== null && input.canEditTurnUserPrefix,
    canForkTurn: input.turn.turnId !== null && input.canForkTurn,
    endResourcePaths: collectTurnEndResourcePaths(input.turn),
  });
}

export function createTurnRenderModelSelector(
  build: TurnRenderModelBuilder = buildTurnRenderModel,
): TurnRenderModelSelector {
  const modelsByEntry = new WeakMap<VisibleConversationTurnEntry, Map<string, ThreadTurnModel>>();

  return (input) => {
    const surface = input.surface ?? "main";
    const canEditTurnUserPrefix = input.canEditTurnUserPrefix === true;
    const canForkTurn = input.canForkTurn === true;
    const cacheKey = JSON.stringify([
      surface,
      canEditTurnUserPrefix,
      canForkTurn,
      input.entry.turnKey,
      (input.backgroundAgents ?? []).map((row) => [
        row.conversationId,
        row.parentTurnKey,
        row.displayName,
        row.status,
        row.statusSummary,
        row.showInlineActivity,
      ]),
    ]);
    const cachedModels = modelsByEntry.get(input.entry);
    const cached = cachedModels?.get(cacheKey);
    if (cached) return cached;

    const model = build({
      turn: input.entry.turn,
      requests: input.entry.requests,
      isLatestTurn: input.entry.isMostRecentTurn,
      isStreamingTurn: input.entry.turn.status === "inProgress",
      canEditTurnUserPrefix,
      canForkTurn,
      backgroundAgents: input.backgroundAgents,
      turnKey: input.entry.turnKey,
    });
    const nextModels = cachedModels ?? new Map<string, ThreadTurnModel>();
    nextModels.set(cacheKey, model);
    if (!cachedModels) {
      modelsByEntry.set(input.entry, nextModels);
    }
    return model;
  };
}

export const selectTurnRenderModel = createTurnRenderModelSelector();
