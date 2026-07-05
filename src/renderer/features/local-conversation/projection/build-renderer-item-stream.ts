import type { ThreadItem } from "@nodex/codex-app-server-protocol/v2";
import type { CodexConversationItem } from "../../../lib/types";
import { hasCodexFileChangeEntries } from "../../../../shared/codex-file-change";
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

type ProtocolThreadItemType = ThreadItem["type"];
type RendererTranscriptType = ThreadTranscriptBlockModel["type"];

const SEMANTIC_FALLBACK = "semanticFallback";

const PROTOCOL_THREAD_ITEM_RENDERER_TYPES = {
  userMessage: "userMessage",
  hookPrompt: null,
  agentMessage: "assistantMessage",
  plan: SEMANTIC_FALLBACK,
  reasoning: "reasoning",
  commandExecution: "exec",
  fileChange: "fileChange",
  mcpToolCall: "mcpToolCall",
  dynamicToolCall: "dynamicToolCall",
  collabAgentToolCall: SEMANTIC_FALLBACK,
  subAgentActivity: null,
  webSearch: "webSearch",
  imageView: "assistantMessage",
  sleep: null,
  imageGeneration: null,
  enteredReviewMode: null,
  exitedReviewMode: null,
  contextCompaction: "contextCompaction",
} satisfies Record<ProtocolThreadItemType, RendererTranscriptType | typeof SEMANTIC_FALLBACK | null>;

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

function hasRenderableFileChangeEntry(entry: CodexConversationItem): boolean {
  if (hasCodexFileChangeEntries(entry.fileChange?.changes)) return true;
  return Boolean(entry.toolCall?.error);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getStringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function getWebSearchVisibleQuery(entry: CodexConversationItem): string {
  const toolArgsQuery = getStringField(getRecord(entry.toolCall?.args), "query")?.trim();
  if (toolArgsQuery) return toolArgsQuery;

  const rawItemQuery = getStringField(getRecord(entry.rawItem), "query")?.trim();
  if (rawItemQuery) return rawItemQuery;

  return "";
}

function hasRenderableWebSearchEntry(entry: CodexConversationItem): boolean {
  return getWebSearchVisibleQuery(entry).length > 0;
}

function isProtocolThreadItemType(type: string): type is ProtocolThreadItemType {
  return Object.prototype.hasOwnProperty.call(PROTOCOL_THREAD_ITEM_RENDERER_TYPES, type);
}

function getProtocolThreadItemType(entry: CodexConversationItem): ProtocolThreadItemType | null {
  if (typeof entry.rawItem !== "object" || entry.rawItem === null) return null;
  const rawType = (entry.rawItem as { type?: unknown }).type;
  if (typeof rawType !== "string") return null;
  return isProtocolThreadItemType(rawType) ? rawType : null;
}

function resolveProtocolRendererType(
  protocolType: ProtocolThreadItemType | null,
): RendererTranscriptType | typeof SEMANTIC_FALLBACK | null {
  if (!protocolType) return SEMANTIC_FALLBACK;
  return PROTOCOL_THREAD_ITEM_RENDERER_TYPES[protocolType];
}

function resolveSemanticRendererType(entry: CodexConversationItem): RendererTranscriptType | null {
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
    case "autoReviewInterruptionWarning":
      return "autoReviewInterruptionWarning";
    case "multiAgentAction":
      return "multiAgentAction";
    case "steered":
      return "steered";
    case "userInputResponse":
      return "userInputResponse";
    case "systemEvent":
      return "systemEvent";
    default:
      return null;
  }
}

function resolveRendererType(entry: CodexConversationItem): ThreadTranscriptBlockModel["type"] | null {
  const protocolType = getProtocolThreadItemType(entry);

  if (entry.kind === "fileChange" || protocolType === "fileChange") {
    return hasRenderableFileChangeEntry(entry) ? "fileChange" : null;
  }

  if (entry.semanticKind === "webSearch" || protocolType === "webSearch") {
    return hasRenderableWebSearchEntry(entry) ? "webSearch" : null;
  }

  if (entry.kind === "userInputRequest") {
    return null;
  }

  if (entry.kind === "userInputResponse" && entry.semanticKind !== "userInputResponse") {
    return null;
  }

  if (
    (entry.semanticKind === "reasoning" || protocolType === "reasoning")
    && (entry.markdownText?.trim().length ?? 0) === 0
  ) {
    return null;
  }

  const semanticType = resolveSemanticRendererType(entry);
  if (semanticType && entry.semanticKind !== "systemEvent") return semanticType;

  const protocolTypeResolution = resolveProtocolRendererType(protocolType);
  if (protocolTypeResolution !== SEMANTIC_FALLBACK) return protocolTypeResolution;

  return semanticType;
}

function buildTranscriptBlock(
  entry: CodexConversationItem,
  turnStatus: BuildRendererItemStreamInput["turnStatus"],
): ThreadTranscriptBlockModel | null {
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
    isTurnCancelled: turnStatus === "interrupted",
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

  if (request.type === "permissionRequest") {
    return [
      request.reason ?? "",
      request.cwd,
      JSON.stringify(request.permissions),
    ].join("\n").trim();
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

export function buildRendererItemStream(
  input: BuildRendererItemStreamInput,
): ThreadRendererItemModel[] {
  const transcriptBlocks = input.entries
    .map((entry) => buildTranscriptBlock(entry, input.turnStatus))
    .filter((item): item is ThreadTranscriptBlockModel => item !== null);
  const requestBlocks = input.requests.map((request) => buildPendingRequestBlock(request));
  return [...transcriptBlocks, ...requestBlocks];
}
