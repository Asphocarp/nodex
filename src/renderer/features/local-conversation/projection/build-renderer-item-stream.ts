import type { CodexConversationItem } from "../../../lib/types";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import type {
  ThreadPendingTurnRequestModel,
  ThreadRendererItemModel,
  ThreadTranscriptBlockModel,
  ThreadWorkedForAdornmentModel,
} from "../thread-stage-types";

interface BuildRendererItemStreamInput {
  entries: CodexConversationItem[];
  requests: CodexTurnScopedConversationRequest[];
  turnStatus?: "inProgress" | "completed" | "interrupted" | "failed";
  isLatestTurn?: boolean;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => stringifyValue(entry)).filter(Boolean).join(" ");
  if (typeof value === "object" && value !== null) {
    return Object.values(value).map((entry) => stringifyValue(entry)).filter(Boolean).join(" ");
  }
  return "";
}

function resolveSearchableText(entry: CodexConversationItem): string {
  const segments = [
    entry.markdownText ?? "",
    entry.additionalDetails ?? "",
    entry.toolCall?.toolName ?? "",
    entry.toolCall?.server ?? "",
    entry.dynamicToolCall?.namespace ?? "",
    entry.dynamicToolCall?.tool ?? "",
    stringifyValue(entry.dynamicToolCall?.arguments),
    stringifyValue(entry.dynamicToolCall?.contentItems),
    entry.mcpToolCall?.pluginId ?? "",
    entry.mcpToolCall?.mcpAppResourceUri ?? "",
    stringifyValue(entry.fileChange),
    stringifyValue(entry.toolCall?.args),
    stringifyValue(entry.toolCall?.result),
    stringifyValue(entry.rawItem),
  ]
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.join("\n").trim();
}

function resolveRendererType(entry: CodexConversationItem): ThreadTranscriptBlockModel["type"] | null {
  if (entry.kind === "fileChange") return "fileChange";

  if (entry.kind === "userInputRequest") {
    return null;
  }

  if (entry.kind === "userInputResponse" && entry.semanticKind !== "userInputResponse") {
    return null;
  }

  if (entry.semanticKind === "reasoning" && (entry.markdownText?.trim().length ?? 0) === 0) {
    return null;
  }

  switch (entry.semanticKind) {
    case "userMessage":
      return "userMessage";
    case "assistantMessage":
      return "assistantMessage";
    case "reasoning":
      return "reasoning";
    case "todoList":
      return "todoList";
    case "proposedPlan":
      return "proposedPlan";
    case "exec":
      return "exec";
    case "diff":
      return "turnDiff";
    case "mcpToolCall":
      return "mcpToolCall";
    case "dynamicToolCall":
      return "dynamicToolCall";
    case "webSearch":
      return "webSearch";
    case "mcpServerElicitation":
      return "mcpServerElicitation";
    case "hook":
      return "hook";
    case "planImplementation":
      return "planImplementation";
    case "streamError":
      return "streamError";
    case "systemError":
      return "systemError";
    case "remoteTaskCreated":
      return "remoteTaskCreated";
    case "personalityChanged":
      return "personalityChanged";
    case "forkedFromConversation":
      return "forkedFromConversation";
    case "modelChanged":
      return "modelChanged";
    case "modelRerouted":
      return "modelRerouted";
    case "contextCompaction":
      return "contextCompaction";
    case "automaticApprovalReview":
      return "automaticApprovalReview";
    case "multiAgentAction":
      return "multiAgentAction";
    case "steered":
      return "steered";
    case "workedFor":
      return "workedFor";
    case "userInputResponse":
      return "userInputResponse";
    case "systemEvent":
      return "systemEvent";
    default:
      return null;
  }
}

function buildTranscriptBlock(entry: CodexConversationItem): ThreadTranscriptBlockModel | null {
  const type = resolveRendererType(entry);
  if (!type) return null;
  const entryId = entry.entryId ?? entry.itemId;

  return {
    id: entryId,
    turnId: entry.turnId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    searchableText: resolveSearchableText(entry),
    type,
    entry,
    status: entry.status,
  };
}

function buildWorkedForEntry(
  assistantAnchor: ThreadTranscriptBlockModel,
  timeLabel: string,
): CodexConversationItem {
  return {
    threadId: assistantAnchor.entry.threadId,
    turnId: assistantAnchor.turnId,
    itemId: `${assistantAnchor.entry.itemId}:worked_for`,
    entryId: `${assistantAnchor.id}:worked_for`,
    type: "worked_for",
    kind: "systemEvent",
    semanticKind: "workedFor",
    timeLabel,
    createdAt: assistantAnchor.createdAt,
    updatedAt: assistantAnchor.updatedAt,
    rawItem: {
      type: "worked_for",
      timeLabel,
    },
  };
}

function resolveRequestSearchableText(request: CodexTurnScopedConversationRequest): string {
  if (request.type === "approval") {
    return [request.reason ?? "", request.command ?? "", request.cwd ?? ""]
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join("\n");
  }

  if (request.type === "userInput") {
    return request.questions.map((question) => question.question).join("\n").trim();
  }

  return request.planContent.trim();
}

function buildPendingRequestBlock(request: CodexTurnScopedConversationRequest): ThreadPendingTurnRequestModel {
  return {
    id: request.requestId,
    turnId: request.turnId,
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    searchableText: resolveRequestSearchableText(request),
    type: request.type,
    request,
  };
}

function resolveWorkedForAnchorIndex(
  items: ThreadTranscriptBlockModel[],
  turnStatus?: BuildRendererItemStreamInput["turnStatus"],
): number {
  if (turnStatus !== "completed") {
    return items.findIndex((item) =>
      item.type === "assistantMessage"
      && item.entry.assistantPhase === "final_answer");
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === "assistantMessage") return index;
  }

  return -1;
}

function hasAboveAssistantWork(items: ThreadTranscriptBlockModel[], anchorIndex: number): boolean {
  for (let index = 0; index < anchorIndex; index += 1) {
    const item = items[index];
    if (!item) continue;

    switch (item.type) {
      case "assistantMessage":
      case "modelChanged":
      case "modelRerouted":
      case "exec":
      case "fileChange":
      case "mcpToolCall":
      case "dynamicToolCall":
      case "automaticApprovalReview":
      case "hook":
      case "streamError":
      case "systemError":
      case "contextCompaction":
      case "userInputResponse":
      case "mcpServerElicitation":
        return true;
      case "webSearch":
        if (item.entry.toolCall?.args && stringifyValue(item.entry.toolCall.args).trim().length > 0) {
          return true;
        }
        break;
      default:
        break;
    }
  }

  return false;
}

function formatWorkedForTimeLabel(durationMs: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

export function resolveWorkedForAdornment(
  items: ThreadTranscriptBlockModel[],
  turnStatus?: BuildRendererItemStreamInput["turnStatus"],
  isLatestTurn?: boolean,
): ThreadWorkedForAdornmentModel | null {
  if (!isLatestTurn) return null;
  const workedForIndex = items.findLastIndex((item) => item.type === "workedFor");
  if (workedForIndex < 0) return null;

  const workedForItem = items[workedForIndex];
  if (!workedForItem) return null;

  const assistantAnchor = items
    .slice(0, workedForIndex)
    .findLast((item) => item.type === "assistantMessage");
  if (!assistantAnchor) return null;

  const timeLabel = workedForItem.entry.timeLabel?.trim() ?? "";
  if (!timeLabel) return null;

  return {
    id: `${assistantAnchor.id}:worked-for`,
    turnId: assistantAnchor.turnId,
    anchorBlockId: assistantAnchor.id,
    timeLabel,
    createdAt: assistantAnchor.createdAt,
    updatedAt: assistantAnchor.updatedAt,
  };
}

export function buildRendererItemStream(
  input: BuildRendererItemStreamInput,
): ThreadRendererItemModel[] {
  const transcriptBlocks = input.entries
    .map((entry) => buildTranscriptBlock(entry))
    .filter((item): item is ThreadTranscriptBlockModel => item !== null);
  const hasWorkedForBlock = transcriptBlocks.some((item) => item.type === "workedFor");
  const syntheticWorkedForBlock =
    !hasWorkedForBlock && input.isLatestTurn
      ? (() => {
          const anchorIndex = resolveWorkedForAnchorIndex(transcriptBlocks, input.turnStatus);
          if (anchorIndex < 0) return null;
          if (!hasAboveAssistantWork(transcriptBlocks, anchorIndex)) return null;

          const assistantAnchor = transcriptBlocks[anchorIndex];
          if (!assistantAnchor) return null;

          const turnStartedAtMs = transcriptBlocks.reduce<number | null>((earliest, item) => {
            if (!Number.isFinite(item.createdAt)) return earliest;
            if (earliest === null) return item.createdAt;
            return Math.min(earliest, item.createdAt);
          }, null);
          if (turnStartedAtMs === null) return null;

          const timeLabel = formatWorkedForTimeLabel(assistantAnchor.createdAt - turnStartedAtMs);
          if (!timeLabel) return null;

          return buildTranscriptBlock(buildWorkedForEntry(assistantAnchor, timeLabel));
        })()
      : null;
  const requestBlocks = input.requests.map((request) => buildPendingRequestBlock(request));
  const itemsWithWorkedFor =
    syntheticWorkedForBlock === null
      ? transcriptBlocks
      : [
          ...transcriptBlocks.slice(0, resolveWorkedForAnchorIndex(transcriptBlocks, input.turnStatus) + 1),
          syntheticWorkedForBlock,
          ...transcriptBlocks.slice(resolveWorkedForAnchorIndex(transcriptBlocks, input.turnStatus) + 1),
        ];

  return [...itemsWithWorkedFor, ...requestBlocks];
}
