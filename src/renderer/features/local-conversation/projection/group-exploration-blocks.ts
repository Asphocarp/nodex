import type { CodexConversationItem } from "../../../lib/types";
import {
  buildCodexFileChangeUnifiedDiff,
  getCodexFileChangeEntries,
  hasCodexFileChangeEntries,
} from "../../../../shared/codex-file-change";
import { extractCommandActions, isExplorationAction } from "../view/shared/tools/command-actions";
import { summarizeDiff } from "../view/shared/tools/diff-file-shared";
import { buildDynamicToolCallGroupKey, resolveDynamicToolLabel } from "../view/shared/tools/dynamic-tool-call-utils";
import { humanizeIdentifier } from "../view/shared/tools/tool-call-utils";
import { buildCollapsedToolActivitySummary } from "./collapsed-tool-activity-summary";
import type {
  ThreadCollapsedToolActivityBlockModel,
  ThreadCollapsedToolActivityEntryModel,
  ThreadCollapsedToolActivitySummaryStats,
  ThreadAgentEntryModel,
  ThreadAgentItemModel,
  ThreadDynamicToolCallGroupBlockModel,
  ThreadMultiAgentGroupBlockModel,
  ThreadPendingMcpToolCallsBlockModel,
  ThreadTranscriptBlockModel,
  ThreadExplorationGroupBlockModel,
} from "../thread-stage-types";

type CommandExecutionBlock = ThreadTranscriptBlockModel & { type: "exec" };
type MultiAgentBlock = ThreadTranscriptBlockModel & { type: "multiAgentAction" };
type McpToolCallBlock = ThreadTranscriptBlockModel & { type: "mcpToolCall" };
type DynamicToolCallBlock = ThreadTranscriptBlockModel & { type: "dynamicToolCall" };

export { buildCollapsedToolActivitySummary } from "./collapsed-tool-activity-summary";

function isTranscriptBlock(block: ThreadAgentItemModel | ThreadAgentEntryModel): block is ThreadTranscriptBlockModel {
  return "entry" in block;
}

function isExplorationCommandBlock(block: ThreadTranscriptBlockModel): block is CommandExecutionBlock {
  if (block.type !== "exec") return false;
  const commandActions = extractCommandActions(block.entry);
  return commandActions.length > 0 && commandActions.every(isExplorationAction);
}

function isSettledMultiAgentBlock(block: ThreadTranscriptBlockModel): block is MultiAgentBlock {
  if (block.type !== "multiAgentAction") return false;
  return block.status !== "inProgress";
}

function isRenderableFileChangeBlock(block: ThreadAgentEntryModel): boolean {
  if (!isTranscriptBlock(block)) return false;
  if (block.type !== "fileChange") return false;
  return hasCodexFileChangeEntries(block.entry.fileChange?.changes);
}

function mergeStatus(entries: CodexConversationItem[]): CodexConversationItem["status"] {
  const statuses = entries
    .map((entry) => entry.status)
    .filter((status): status is NonNullable<CodexConversationItem["status"]> => status !== undefined);

  if (statuses.length === 0) return undefined;
  if (statuses.includes("inProgress")) return "inProgress";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("interrupted")) return "interrupted";
  if (statuses.includes("declined")) return "declined";
  return statuses[statuses.length - 1];
}

function buildSearchableText(entries: CodexConversationItem[]): string {
  return entries
    .map((entry) => entry.markdownText ?? entry.toolCall?.toolName ?? "")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("\n");
}

function buildSearchableTextFromActivityEntries(entries: ThreadCollapsedToolActivityEntryModel[]): string {
  return entries
    .flatMap((entry) => {
      if (entry.type === "explorationGroup") {
        return [entry.summary, ...entry.entries.map((item) => item.markdownText ?? item.toolCall?.toolName ?? "")];
      }
      return [entry.searchableText];
    })
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("\n");
}

function resolveExplorationSummary(entries: CodexConversationItem[]): string {
  const commandCount = entries.filter((entry) => entry.kind === "commandExecution").length;
  if (commandCount <= 1) return "Exploration";
  return `Exploration (${commandCount} commands)`;
}

function resolveMultiAgentSummary(entries: CodexConversationItem[]): string {
  if (entries.length <= 1) return "Multi-agent action";
  return `Multi-agent actions (${entries.length})`;
}

function resolveMcpSourceDisplayName(entry: CodexConversationItem): string | null {
  const sourceName = getMcpSourceName(entry);
  if (!sourceName) return null;
  if (sourceName === "browser-use") return "the browser";
  if (sourceName === "computer-use") return "Computer";
  return humanizeIdentifier(sourceName) || sourceName;
}

function resolvePendingMcpSummary(entries: McpToolCallBlock[]): string {
  const sources = entries
    .map((entry) => resolveMcpSourceDisplayName(entry.entry))
    .filter((source): source is string => Boolean(source));
  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.length === 1) return `Using ${uniqueSources[0]}`;
  if (uniqueSources.length > 1) return `Using ${uniqueSources.slice(0, -1).join(", ")} and ${uniqueSources[uniqueSources.length - 1]}`;
  return entries.length === 1 ? "Using tool" : `Using ${entries.length} tools`;
}

function buildPendingMcpToolCallsGroup(
  entries: McpToolCallBlock[],
  seed: McpToolCallBlock,
): ThreadPendingMcpToolCallsBlockModel {
  return {
    id: `${seed.id}::pending-mcp-tool-calls`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: entries.map((entry) => entry.searchableText).join("\n"),
    type: "pendingMcpToolCalls",
    entries,
    summary: resolvePendingMcpSummary(entries),
    status: mergeActivityStatus(entries),
  };
}

function buildDynamicToolCallGroup(
  entries: DynamicToolCallBlock[],
  seed: DynamicToolCallBlock,
): ThreadDynamicToolCallGroupBlockModel {
  const summary = resolveDynamicToolLabel(seed.entry);
  return {
    id: `${seed.id}::dynamic-tool-call-group`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: [summary, ...entries.map((entry) => entry.searchableText)].join("\n"),
    type: "dynamicToolCallGroup",
    entries,
    summary,
    repeatCount: entries.length,
    status: mergeActivityStatus(entries),
  };
}

function buildExplorationGroup(entries: CodexConversationItem[], seed: ThreadTranscriptBlockModel): ThreadExplorationGroupBlockModel {
  return {
    id: `${seed.id}::exploration`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: buildSearchableText(entries),
    type: "explorationGroup",
    entries,
    summary: resolveExplorationSummary(entries),
    status: mergeStatus(entries),
  };
}

function buildMultiAgentGroup(entries: CodexConversationItem[], seed: ThreadTranscriptBlockModel): ThreadMultiAgentGroupBlockModel {
  return {
    id: `${seed.id}::multi-agent`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: buildSearchableText(entries),
    type: "multiAgentGroup",
    entries,
    summary: resolveMultiAgentSummary(entries),
    status: mergeStatus(entries),
  };
}

function isCollapsedActivityEntry(block: ThreadAgentEntryModel): block is ThreadCollapsedToolActivityEntryModel {
  if (block.type === "explorationGroup") return true;

  switch (block.type) {
    case "exec":
    case "mcpToolCall":
    case "webSearch":
    case "automaticApprovalReview":
    case "hook":
      return true;
    case "fileChange":
      return isRenderableFileChangeBlock(block);
    default:
      return false;
  }
}

function mergeActivityStatus(entries: ThreadCollapsedToolActivityEntryModel[]): CodexConversationItem["status"] {
  const statuses = entries
    .map((entry) => entry.status)
    .filter((status): status is NonNullable<CodexConversationItem["status"]> => status !== undefined);
  if (statuses.length === 0) return undefined;
  if (statuses.includes("inProgress")) return "inProgress";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("interrupted")) return "interrupted";
  if (statuses.includes("declined")) return "declined";
  return "completed";
}

function emptyCollapsedToolActivitySummaryStats(): ThreadCollapsedToolActivitySummaryStats {
  return {
    createdFileCount: 0,
    runningCreatedFileCount: 0,
    stoppedCreatedFileCount: 0,
    editedFileCount: 0,
    runningEditedFileCount: 0,
    deletedFileCount: 0,
    runningDeletedFileCount: 0,
    changedLineCount: 0,
    runningCreatedLineCount: 0,
    exploredFileCount: 0,
    runningExploredFileCount: 0,
    searchCount: 0,
    runningSearchCount: 0,
    listCount: 0,
    runningListCount: 0,
    commandCount: 0,
    runningCommandCount: 0,
    deniedRequestCount: 0,
    timedOutRequestCount: 0,
    hookCount: 0,
    runningHookCount: 0,
    mcpToolCallCount: 0,
    runningMcpToolCallCount: 0,
    mcpToolCallSources: [],
    webSearchCount: 0,
    runningWebSearchCount: 0,
  };
}

interface FileChangePathSummarySets {
  createdPaths: Set<string>;
  runningCreatedPaths: Set<string>;
  stoppedCreatedPaths: Set<string>;
  editedPaths: Set<string>;
  runningEditedPaths: Set<string>;
  deletedPaths: Set<string>;
  runningDeletedPaths: Set<string>;
}

function emptyFileChangePathSummarySets(): FileChangePathSummarySets {
  return {
    createdPaths: new Set(),
    runningCreatedPaths: new Set(),
    stoppedCreatedPaths: new Set(),
    editedPaths: new Set(),
    runningEditedPaths: new Set(),
    deletedPaths: new Set(),
    runningDeletedPaths: new Set(),
  };
}

function applyFileChangePathSummarySets(
  stats: ThreadCollapsedToolActivitySummaryStats,
  sets: FileChangePathSummarySets,
): void {
  stats.createdFileCount = sets.createdPaths.size;
  stats.runningCreatedFileCount = sets.runningCreatedPaths.size;
  stats.stoppedCreatedFileCount = sets.stoppedCreatedPaths.size;
  stats.editedFileCount = sets.editedPaths.size;
  stats.runningEditedFileCount = sets.runningEditedPaths.size;
  stats.deletedFileCount = sets.deletedPaths.size;
  stats.runningDeletedFileCount = sets.runningDeletedPaths.size;
}

function countUniqueExplorationActions(entries: CodexConversationItem[], stats: ThreadCollapsedToolActivitySummaryStats): void {
  const readPaths = new Set<string>();
  for (const entry of entries) {
    const isRunning = entry.status === "inProgress";
    for (const action of extractCommandActions(entry)) {
      if (action.type === "read") {
        const path = action.path || action.name;
        if (path) readPaths.add(path);
        continue;
      }
      if (action.type === "search") {
        if (isRunning) stats.runningSearchCount += 1;
        else stats.searchCount += 1;
        continue;
      }
      if (action.type === "listFiles") {
        if (isRunning) stats.runningListCount += 1;
        else stats.listCount += 1;
      }
    }
  }

  const hasRunningEntry = entries.some((entry) => entry.status === "inProgress");
  if (hasRunningEntry) stats.runningExploredFileCount += readPaths.size;
  else stats.exploredFileCount += readPaths.size;
}

function countContentLines(content: string): number {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.length === 0) return 0;
  const lines = normalized.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

function collectAutomaticApprovalReviewStats(
  reviews: readonly CodexConversationItem[],
  stats: ThreadCollapsedToolActivitySummaryStats,
): void {
  for (const review of reviews) {
    const reviewStatus = getAutomaticApprovalReviewStatus(review) ?? review.status;
    if (reviewStatus === "denied") stats.deniedRequestCount += 1;
    if (reviewStatus === "timedOut") stats.timedOutRequestCount += 1;
  }
}

function collectFileChangeStats(
  entry: ThreadTranscriptBlockModel,
  stats: ThreadCollapsedToolActivitySummaryStats,
  pathSets: FileChangePathSummarySets,
): void {
  const changes = getCodexFileChangeEntries(entry.entry.fileChange?.changes);
  if (changes.length === 0) {
    collectAutomaticApprovalReviewStats(entry.automaticApprovalReviews ?? [], stats);
    return;
  }

  const isRunning = entry.status === "inProgress";
  const isStopped = isRunning && entry.isTurnCancelled === true;
  for (const [path, change] of changes) {
    const diffStats = summarizeDiff(buildCodexFileChangeUnifiedDiff(path, change) ?? undefined);
    stats.changedLineCount += diffStats.additions + diffStats.deletions;

    if (change.type === "add") {
      pathSets.createdPaths.add(path);
      if (isStopped) {
        pathSets.stoppedCreatedPaths.add(path);
        continue;
      }
      if (isRunning) {
        pathSets.runningCreatedPaths.add(path);
        stats.runningCreatedLineCount += countContentLines(change.content);
      }
      continue;
    }
    if (change.type === "delete") {
      pathSets.deletedPaths.add(path);
      if (isRunning) pathSets.runningDeletedPaths.add(path);
      continue;
    }
    pathSets.editedPaths.add(path);
    if (isRunning) pathSets.runningEditedPaths.add(path);
  }
  collectAutomaticApprovalReviewStats(entry.automaticApprovalReviews ?? [], stats);
}

function getAutomaticApprovalReviewStatus(entry: CodexConversationItem): string | null {
  const raw = typeof entry.rawItem === "object" && entry.rawItem !== null
    ? entry.rawItem as { review?: { status?: unknown } }
    : null;
  const status = raw?.review?.status;
  return typeof status === "string" ? status : null;
}

function getMcpSourceName(entry: CodexConversationItem): string | null {
  const invocationServer = entry.mcpToolCall?.invocation.server;
  const serverName = invocationServer ?? entry.toolCall?.server ?? null;
  if (!serverName) return null;
  const trimmed = serverName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function incrementMcpSource(stats: ThreadCollapsedToolActivitySummaryStats, sourceName: string): void {
  const existing = stats.mcpToolCallSources.find((source) => source.name === sourceName);
  if (existing) {
    existing.count += 1;
    return;
  }
  stats.mcpToolCallSources.push({ name: sourceName, count: 1 });
}

export function collectCollapsedToolActivitySummaryStats(
  entries: ThreadCollapsedToolActivityEntryModel[],
): ThreadCollapsedToolActivitySummaryStats {
  const stats = emptyCollapsedToolActivitySummaryStats();
  const fileChangePathSets = emptyFileChangePathSummarySets();

  for (const entry of entries) {
    if (entry.type === "explorationGroup") {
      countUniqueExplorationActions(entry.entries, stats);
      continue;
    }

    if (entry.type === "fileChange") {
      collectFileChangeStats(entry, stats, fileChangePathSets);
      continue;
    }

    if (entry.type === "exec") {
      if (isExplorationCommandBlock(entry)) continue;
      stats.commandCount += 1;
      if (entry.status === "inProgress") stats.runningCommandCount += 1;
      continue;
    }

    if (entry.type === "automaticApprovalReview") {
      collectAutomaticApprovalReviewStats([entry.entry], stats);
      continue;
    }

    if (entry.type === "hook") {
      stats.hookCount += 1;
      if (entry.status === "inProgress") stats.runningHookCount += 1;
      continue;
    }

    if (entry.type === "mcpToolCall") {
      stats.mcpToolCallCount += 1;
      if (entry.status === "inProgress") stats.runningMcpToolCallCount += 1;
      const sourceName = getMcpSourceName(entry.entry);
      if (sourceName) incrementMcpSource(stats, sourceName);
      continue;
    }

    if (entry.type === "webSearch") {
      if (entry.status === "inProgress") stats.runningWebSearchCount += 1;
      else stats.webSearchCount += 1;
    }
  }

  applyFileChangePathSummarySets(stats, fileChangePathSets);
  return stats;
}

function buildCollapsedActivityGroup(
  entries: ThreadCollapsedToolActivityEntryModel[],
  seed: ThreadCollapsedToolActivityEntryModel,
): ThreadCollapsedToolActivityBlockModel | null {
  const summaryStats = collectCollapsedToolActivitySummaryStats(entries);
  const summaryResult = buildCollapsedToolActivitySummary(summaryStats);
  if (!summaryResult) return null;

  return {
    id: `${seed.id}::collapsed-tool-activity`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: buildSearchableTextFromActivityEntries(entries),
    type: "collapsedToolActivity",
    entries,
    summary: summaryResult.summary,
    summaryStats,
    summaryParts: summaryResult.parts,
    status: mergeActivityStatus(entries),
  };
}

function shouldCollapseSingleActivityEntry(entry: ThreadCollapsedToolActivityEntryModel): boolean {
  return entry.type === "fileChange";
}

function getAutomaticApprovalReviewTargetItemId(entry: CodexConversationItem): string | null {
  const raw = typeof entry.rawItem === "object" && entry.rawItem !== null
    ? entry.rawItem as { targetItemId?: unknown }
    : null;
  return typeof raw?.targetItemId === "string" && raw.targetItemId.length > 0 ? raw.targetItemId : null;
}

function attachAutomaticApprovalReviewsToFileChanges(
  entries: ThreadAgentEntryModel[],
): ThreadAgentEntryModel[] {
  const fileChangeIds = new Set(
    entries
      .filter((entry): entry is ThreadTranscriptBlockModel => isTranscriptBlock(entry) && entry.type === "fileChange")
      .map((entry) => entry.entry.itemId),
  );
  if (fileChangeIds.size === 0) return entries;

  const reviewsByTarget = new Map<string, CodexConversationItem[]>();
  const consumedReviewIds = new Set<string>();
  for (const entry of entries) {
    if (!isTranscriptBlock(entry) || entry.type !== "automaticApprovalReview") continue;
    const targetItemId = getAutomaticApprovalReviewTargetItemId(entry.entry);
    if (!targetItemId || !fileChangeIds.has(targetItemId)) continue;
    const reviews = reviewsByTarget.get(targetItemId) ?? [];
    reviews.push(entry.entry);
    reviewsByTarget.set(targetItemId, reviews);
    consumedReviewIds.add(entry.id);
  }

  if (consumedReviewIds.size === 0) return entries;

  return entries.flatMap((entry) => {
    if (consumedReviewIds.has(entry.id)) return [];
    if (!isTranscriptBlock(entry) || entry.type !== "fileChange") return [entry];
    const reviews = reviewsByTarget.get(entry.entry.itemId);
    if (!reviews || reviews.length === 0) return [entry];
    return [{
      ...entry,
      automaticApprovalReviews: [
        ...(entry.automaticApprovalReviews ?? []),
        ...reviews,
      ],
    }];
  });
}

export function groupAgentEntries(agentBlocks: ThreadAgentItemModel[]): ThreadAgentEntryModel[] {
  if (agentBlocks.length === 0) return agentBlocks;

  const grouped: ThreadAgentEntryModel[] = [];
  let index = 0;

  while (index < agentBlocks.length) {
    const current = agentBlocks[index];
    if (!current) break;

    if (current.type === "workedFor") {
      grouped.push(current);
      index += 1;
      continue;
    }

    if (current.type === "mcpToolCall" && current.status === "inProgress") {
      const entries: McpToolCallBlock[] = [current as McpToolCallBlock];
      let cursor = index + 1;
      while (cursor < agentBlocks.length) {
        const candidate = agentBlocks[cursor];
        if (!candidate || candidate.type !== "mcpToolCall" || candidate.status !== "inProgress") break;
        entries.push(candidate as McpToolCallBlock);
        cursor += 1;
      }
      grouped.push(buildPendingMcpToolCallsGroup(entries, current as McpToolCallBlock));
      index = cursor;
      continue;
    }

    if (current.type === "dynamicToolCall") {
      const currentKey = buildDynamicToolCallGroupKey(current.entry.dynamicToolCall);
      const entries: DynamicToolCallBlock[] = [current as DynamicToolCallBlock];
      let cursor = index + 1;
      while (cursor < agentBlocks.length) {
        const candidate = agentBlocks[cursor];
        if (!candidate || candidate.type !== "dynamicToolCall") break;
        if (buildDynamicToolCallGroupKey(candidate.entry.dynamicToolCall) !== currentKey) break;
        entries.push(candidate as DynamicToolCallBlock);
        cursor += 1;
      }
      if (entries.length === 1) {
        grouped.push(current);
      } else {
        grouped.push(buildDynamicToolCallGroup(entries, current as DynamicToolCallBlock));
      }
      index = cursor;
      continue;
    }

    if (isSettledMultiAgentBlock(current)) {
      const entries = [current.entry];
      let cursor = index + 1;
      while (cursor < agentBlocks.length) {
        const candidate = agentBlocks[cursor];
        if (!candidate || !isTranscriptBlock(candidate) || !isSettledMultiAgentBlock(candidate)) break;
        entries.push(candidate.entry);
        cursor += 1;
      }
      grouped.push(buildMultiAgentGroup(entries, current));
      index = cursor;
      continue;
    }

    if (!isExplorationCommandBlock(current)) {
      grouped.push(current);
      index += 1;
      continue;
    }

    const entries = [current.entry];
    let cursor = index + 1;
    while (cursor < agentBlocks.length) {
      const candidate = agentBlocks[cursor];
      if (!candidate) break;
      if (isTranscriptBlock(candidate) && (isExplorationCommandBlock(candidate) || candidate.type === "reasoning")) {
        entries.push(candidate.entry);
        cursor += 1;
        continue;
      }
      break;
    }

    grouped.push(buildExplorationGroup(entries, current));
    index = cursor;
  }

  const groupedWithReviewAttachments = attachAutomaticApprovalReviewsToFileChanges(grouped);
  const collapsed: ThreadAgentEntryModel[] = [];
  let collapsedIndex = 0;
  while (collapsedIndex < groupedWithReviewAttachments.length) {
    const current = groupedWithReviewAttachments[collapsedIndex];
    if (!current) break;
    if (!isCollapsedActivityEntry(current)) {
      collapsed.push(current);
      collapsedIndex += 1;
      continue;
    }

    const entries = [current];
    let cursor = collapsedIndex + 1;
    while (cursor < groupedWithReviewAttachments.length) {
      const candidate = groupedWithReviewAttachments[cursor];
      if (!candidate || !isCollapsedActivityEntry(candidate)) break;
      entries.push(candidate);
      cursor += 1;
    }

    if (entries.length === 1 && !shouldCollapseSingleActivityEntry(current)) {
      collapsed.push(current);
    } else {
      const collapsedGroup = buildCollapsedActivityGroup(entries, current);
      if (collapsedGroup) {
        collapsed.push(collapsedGroup);
      } else {
        collapsed.push(...entries);
      }
    }
    collapsedIndex = cursor;
  }

  return collapsed;
}
