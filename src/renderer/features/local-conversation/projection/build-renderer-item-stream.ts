import type { CodexConversationItem } from "../../../lib/types";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import type {
  ThreadPendingTurnRequestModel,
  ThreadRendererItemModel,
  ThreadTranscriptBlockModel,
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
    entry.toolCall?.toolName ?? "",
    entry.toolCall?.server ?? "",
    stringifyValue(entry.toolCall?.args),
    stringifyValue(entry.toolCall?.result),
    stringifyValue(entry.rawItem),
  ]
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.join("\n").trim();
}

function resolveRendererType(entry: CodexConversationItem): ThreadTranscriptBlockModel["type"] | null {
  if (entry.kind === "userInputRequest" && entry.semanticKind !== "answeredUserInput") {
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
    case "patch":
      return "patch";
    case "diff":
      return "diff";
    case "toolCall":
      return "toolCall";
    case "mcpToolCall":
      return "mcpToolCall";
    case "webSearch":
      return "webSearch";
    case "workedFor":
      return "workedFor";
    case "mcpServerElicitation":
      return "mcpServerElicitation";
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
    case "answeredUserInput":
      return "answeredUserInput";
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
      case "patch":
      case "mcpToolCall":
      case "automaticApprovalReview":
      case "streamError":
      case "systemError":
      case "contextCompaction":
      case "answeredUserInput":
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

function injectWorkedForBlock(
  items: ThreadTranscriptBlockModel[],
  turnStatus?: BuildRendererItemStreamInput["turnStatus"],
  isLatestTurn?: boolean,
): ThreadTranscriptBlockModel[] {
  if (!isLatestTurn) return items;
  const anchorIndex = resolveWorkedForAnchorIndex(items, turnStatus);
  if (anchorIndex < 0) return items;
  if (!hasAboveAssistantWork(items, anchorIndex)) return items;

  const assistantAnchor = items[anchorIndex];
  if (!assistantAnchor) return items;

  const turnStartedAtMs = items.reduce<number | null>((earliest, item) => {
    if (!Number.isFinite(item.createdAt)) return earliest;
    if (earliest === null) return item.createdAt;
    return Math.min(earliest, item.createdAt);
  }, null);
  if (turnStartedAtMs === null) return items;

  const timeLabel = formatWorkedForTimeLabel(assistantAnchor.createdAt - turnStartedAtMs);
  if (!timeLabel) return items;

  const workedForId = `${assistantAnchor.id}:worked-for`;
  const workedForBlock: ThreadTranscriptBlockModel = {
    id: workedForId,
    turnId: assistantAnchor.turnId,
    createdAt: assistantAnchor.createdAt,
    updatedAt: assistantAnchor.updatedAt,
    searchableText: `Worked for ${timeLabel}`,
    type: "workedFor",
    entry: {
      ...assistantAnchor.entry,
      entryId: workedForId,
      itemId: workedForId,
      type: "worked_for",
      kind: "systemEvent",
      semanticKind: "workedFor",
      timeLabel,
      markdownText: undefined,
      toolCall: undefined,
      userInputQuestions: undefined,
      userInputAnswers: undefined,
      rawItem: { timeLabel },
    },
    status: "completed",
  };

  return [
    ...items.slice(0, anchorIndex),
    workedForBlock,
    ...items.slice(anchorIndex),
  ];
}

export function buildRendererItemStream(
  input: BuildRendererItemStreamInput,
): ThreadRendererItemModel[] {
  const transcriptBlocks = input.entries
    .map((entry) => buildTranscriptBlock(entry))
    .filter((item): item is ThreadTranscriptBlockModel => item !== null);
  const transcriptBlocksWithWorkedFor = injectWorkedForBlock(
    transcriptBlocks,
    input.turnStatus,
    input.isLatestTurn,
  );

  const requestBlocks = input.requests.map((request) => buildPendingRequestBlock(request));

  return [...transcriptBlocksWithWorkedFor, ...requestBlocks];
}
