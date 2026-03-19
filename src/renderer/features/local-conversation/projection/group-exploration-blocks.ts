import type { CodexConversationItem } from "../../../lib/types";
import { extractCommandActions, isExplorationAction } from "../view/shared/tools/command-actions";
import type {
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

  return grouped;
}
