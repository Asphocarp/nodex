import type { CodexConversationItem } from "../../../lib/types";
import { extractCommandActions, isExplorationAction } from "../view/shared/tools/command-actions";
import { buildDynamicToolCallGroupKey, resolveDynamicToolLabel } from "../view/shared/tools/dynamic-tool-call-utils";
import { humanizeIdentifier } from "../view/shared/tools/tool-call-utils";
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

function isTranscriptBlock(block: ThreadAgentItemModel): block is ThreadTranscriptBlockModel {
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
    case "fileChange":
    case "mcpToolCall":
    case "webSearch":
    case "automaticApprovalReview":
    case "hook":
      return true;
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

function pluralize(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
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
    exploredFileCount: 0,
    runningExploredFileCount: 0,
    searchCount: 0,
    runningSearchCount: 0,
    listCount: 0,
    runningListCount: 0,
    commandCount: 0,
    runningCommandCount: 0,
    approvedRequestCount: 0,
    deniedRequestCount: 0,
    hookCount: 0,
    runningHookCount: 0,
    mcpToolCallCount: 0,
    runningMcpToolCallCount: 0,
    mcpToolCallSources: [],
    webSearchCount: 0,
    runningWebSearchCount: 0,
  };
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

function collectFileChangeStats(entry: ThreadTranscriptBlockModel, stats: ThreadCollapsedToolActivitySummaryStats): void {
  const changes = entry.entry.fileChange?.changes ?? [];
  if (changes.length === 0) {
    if (entry.status === "inProgress") stats.runningEditedFileCount += 1;
    else stats.editedFileCount += 1;
    return;
  }

  const isRunning = entry.status === "inProgress";
  for (const change of changes) {
    if (change.type === "add") {
      if (isRunning) stats.runningCreatedFileCount += 1;
      else stats.createdFileCount += 1;
      continue;
    }
    if (change.type === "delete") {
      if (isRunning) stats.runningDeletedFileCount += 1;
      else stats.deletedFileCount += 1;
      continue;
    }
    if (isRunning) stats.runningEditedFileCount += 1;
    else stats.editedFileCount += 1;
  }
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

  for (const entry of entries) {
    if (entry.type === "explorationGroup") {
      countUniqueExplorationActions(entry.entries, stats);
      continue;
    }

    if (entry.type === "fileChange") {
      collectFileChangeStats(entry, stats);
      continue;
    }

    if (entry.type === "exec") {
      if (isExplorationCommandBlock(entry)) continue;
      stats.commandCount += 1;
      if (entry.status === "inProgress") stats.runningCommandCount += 1;
      continue;
    }

    if (entry.type === "automaticApprovalReview") {
      const reviewStatus = getAutomaticApprovalReviewStatus(entry.entry) ?? entry.status;
      if (reviewStatus === "approved") stats.approvedRequestCount += 1;
      if (reviewStatus === "denied" || reviewStatus === "aborted" || reviewStatus === "declined" || reviewStatus === "failed") {
        stats.deniedRequestCount += 1;
      }
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

  return stats;
}

function addFileCountPart(parts: string[], count: number, leading: string, trailing: string): void {
  if (count <= 0) return;
  const verb = parts.length === 0 ? leading : trailing;
  parts.push(`${verb} ${pluralize(count, "file", "files")}`);
}

function formatExplorationSummaryPart(stats: ThreadCollapsedToolActivitySummaryStats, isLeading: boolean): string | null {
  const exploredFileCount = stats.exploredFileCount + stats.runningExploredFileCount;
  const searchCount = stats.searchCount + stats.runningSearchCount;
  const listCount = stats.listCount + stats.runningListCount;
  const isRunning = stats.runningExploredFileCount > 0 || stats.runningSearchCount > 0 || stats.runningListCount > 0;

  if (exploredFileCount === 0 && searchCount === 0 && listCount === 0) return null;
  if (exploredFileCount === 0 && searchCount === 0) {
    if (isRunning) return isLeading ? "Listing files" : "listing files";
    return isLeading ? "Listed files" : "listed files";
  }

  const details: string[] = [];
  if (exploredFileCount > 0) details.push(pluralize(exploredFileCount, "file", "files"));
  if (searchCount > 0) details.push(pluralize(searchCount, "search", "searches"));
  if (listCount > 0) details.push(pluralize(listCount, "list", "lists"));

  const verb = isRunning
    ? isLeading ? "Exploring" : "exploring"
    : isLeading ? "Explored" : "explored";
  return `${verb} ${details.join(", ")}`;
}

function addCountPart(parts: string[], completedCount: number, runningCount: number, labels: {
  completedLeading: string;
  completed: string;
  runningLeading: string;
  running: string;
  singular: string;
  plural: string;
}): void {
  if (completedCount > 0) {
    parts.push(`${parts.length === 0 ? labels.completedLeading : labels.completed} ${pluralize(completedCount, labels.singular, labels.plural)}`);
  }
  if (runningCount > 0) {
    parts.push(`${parts.length === 0 ? labels.runningLeading : labels.running} ${pluralize(runningCount, labels.singular, labels.plural)}`);
  }
}

export function buildCollapsedToolActivitySummary(
  stats: ThreadCollapsedToolActivitySummaryStats,
): { summary: string; parts: string[] } | null {
  const parts: string[] = [];
  const completedCreated = stats.createdFileCount - stats.stoppedCreatedFileCount;
  addFileCountPart(parts, Math.max(completedCreated, 0), "Created", "created");
  addFileCountPart(parts, stats.stoppedCreatedFileCount, "Stopped creating", "stopped creating");
  addFileCountPart(parts, stats.runningCreatedFileCount, "Creating", "creating");
  addFileCountPart(parts, stats.editedFileCount, "Edited", "edited");
  addFileCountPart(parts, stats.runningEditedFileCount, "Editing", "editing");
  addFileCountPart(parts, stats.deletedFileCount, "Deleted", "deleted");
  addFileCountPart(parts, stats.runningDeletedFileCount, "Deleting", "deleting");

  const explorationPart = formatExplorationSummaryPart(stats, parts.length === 0);
  if (explorationPart) parts.push(explorationPart);

  addCountPart(parts, stats.approvedRequestCount, 0, {
    completedLeading: "Approved",
    completed: "approved",
    runningLeading: "Approved",
    running: "approved",
    singular: "request",
    plural: "requests",
  });
  addCountPart(parts, stats.deniedRequestCount, 0, {
    completedLeading: "Denied",
    completed: "denied",
    runningLeading: "Denied",
    running: "denied",
    singular: "request",
    plural: "requests",
  });
  addCountPart(parts, stats.hookCount - stats.runningHookCount, stats.runningHookCount, {
    completedLeading: "Ran",
    completed: "ran",
    runningLeading: "Running",
    running: "running",
    singular: "hook",
    plural: "hooks",
  });
  addCountPart(parts, stats.commandCount - stats.runningCommandCount, stats.runningCommandCount, {
    completedLeading: "Ran",
    completed: "ran",
    runningLeading: "Running",
    running: "running",
    singular: "command",
    plural: "commands",
  });

  if (stats.mcpToolCallCount > 0) {
    const namedSourceCallCount = stats.mcpToolCallSources.reduce((sum, source) => sum + source.count, 0);
    const unnamedCount = stats.mcpToolCallCount - namedSourceCallCount;
    if (stats.mcpToolCallSources.length > 0) {
      const sourceNames = stats.mcpToolCallSources.map((source) => (
        source.name === "browser-use" ? "the browser" : source.name
      ));
      const sourceText = sourceNames.length === 1
        ? sourceNames[0]
        : `${sourceNames.slice(0, -1).join(", ")} and ${sourceNames[sourceNames.length - 1]}`;
      parts.push(`${parts.length === 0 ? "Used" : "used"} ${sourceText}`);
    }
    addCountPart(parts, Math.max(unnamedCount, 0), 0, {
      completedLeading: "Called",
      completed: "called",
      runningLeading: "Called",
      running: "called",
      singular: "tool",
      plural: "tools",
    });
  }

  addCountPart(parts, stats.webSearchCount, stats.runningWebSearchCount, {
    completedLeading: "Searched web",
    completed: "searched web",
    runningLeading: "Searching the web",
    running: "searching the web",
    singular: "time",
    plural: "times",
  });

  if (parts.length === 0) return null;
  return { summary: parts.join(", "), parts };
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
  return entry.type === "fileChange" && entry.status === "inProgress";
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

  const collapsed: ThreadAgentEntryModel[] = [];
  let collapsedIndex = 0;
  while (collapsedIndex < grouped.length) {
    const current = grouped[collapsedIndex];
    if (!current) break;
    if (!isCollapsedActivityEntry(current)) {
      collapsed.push(current);
      collapsedIndex += 1;
      continue;
    }

    const entries = [current];
    let cursor = collapsedIndex + 1;
    while (cursor < grouped.length) {
      const candidate = grouped[cursor];
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
