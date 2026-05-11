import type { CodexConversationItem } from "../../../lib/types";
import { extractCommandActions, isExplorationAction } from "../view/shared/tools/command-actions";
import type {
  ThreadCollapsedToolActivityBlockModel,
  ThreadCollapsedToolActivityEntryModel,
  ThreadAgentEntryModel,
  ThreadMultiAgentGroupBlockModel,
  ThreadTranscriptBlockModel,
  ThreadExplorationGroupBlockModel,
} from "../thread-stage-types";

type CommandExecutionBlock = ThreadTranscriptBlockModel & { type: "exec" };
type MultiAgentBlock = ThreadTranscriptBlockModel & { type: "multiAgentAction" };

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
      if (entry.type === "explorationGroup" || entry.type === "multiAgentGroup") {
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
  if (block.type === "explorationGroup" || block.type === "multiAgentGroup") {
    return block.status !== "inProgress";
  }

  if (block.status === "inProgress") return false;

  switch (block.type) {
    case "exec":
    case "fileChange":
    case "mcpToolCall":
    case "webSearch":
    case "automaticApprovalReview":
    case "multiAgentAction":
    case "userInputResponse":
    case "mcpServerElicitation":
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
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("interrupted")) return "interrupted";
  if (statuses.includes("declined")) return "declined";
  return "completed";
}

function resolveCollapsedActivitySummary(entries: ThreadCollapsedToolActivityEntryModel[]): string {
  const fileCount = entries.filter((entry) => entry.type === "fileChange").length;
  const commandCount = entries.filter((entry) => entry.type === "exec" || entry.type === "explorationGroup").length;
  const mcpCount = entries.filter((entry) => entry.type === "mcpToolCall").length;

  if (fileCount > 0 && entries.length === fileCount) {
    return fileCount === 1 ? "Edited 1 file" : `Edited ${fileCount} files`;
  }
  if (commandCount > 0 && mcpCount === 0 && fileCount === 0) {
    return commandCount === 1 ? "Ran 1 command" : `Ran ${commandCount} commands`;
  }
  if (mcpCount > 0 && entries.length === mcpCount) {
    return mcpCount === 1 ? "Called 1 tool" : `Called ${mcpCount} tools`;
  }
  return entries.length === 1 ? "Completed 1 action" : `Completed ${entries.length} actions`;
}

function buildCollapsedActivityGroup(
  entries: ThreadCollapsedToolActivityEntryModel[],
  seed: ThreadCollapsedToolActivityEntryModel,
): ThreadCollapsedToolActivityBlockModel {
  return {
    id: `${seed.id}::collapsed-tool-activity`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: buildSearchableTextFromActivityEntries(entries),
    type: "collapsedToolActivity",
    entries,
    summary: resolveCollapsedActivitySummary(entries),
    status: mergeActivityStatus(entries),
  };
}

export function groupAgentEntries(agentBlocks: ThreadTranscriptBlockModel[]): ThreadAgentEntryModel[] {
  if (agentBlocks.length === 0) return agentBlocks;

  const grouped: ThreadAgentEntryModel[] = [];
  let index = 0;

  while (index < agentBlocks.length) {
    const current = agentBlocks[index];
    if (!current) break;

    if (isSettledMultiAgentBlock(current)) {
      const entries = [current.entry];
      let cursor = index + 1;
      while (cursor < agentBlocks.length) {
        const candidate = agentBlocks[cursor];
        if (!candidate || !isSettledMultiAgentBlock(candidate)) break;
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
      if (isExplorationCommandBlock(candidate) || candidate.type === "reasoning") {
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

    if (entries.length === 1) {
      collapsed.push(current);
    } else {
      collapsed.push(buildCollapsedActivityGroup(entries, current));
    }
    collapsedIndex = cursor;
  }

  return collapsed;
}
