import type { ThreadItem } from "@nodex/codex-app-server-protocol/v2";
import type { CodexConversationItem } from "../../../lib/types";
import { hasCodexFileChangeEntries } from "../../../../shared/codex-file-change";
import { stripCodexRemarkDirectiveLines } from "../../../../shared/codex-remark-directives";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import type {
  ThreadOpenSubagentStatus,
  ThreadPendingTurnRequestModel,
  ThreadRendererItemModel,
  ThreadSubagentActivityInlineRowModel,
  ThreadSubagentActivityStatus,
  ThreadTranscriptBlockModel,
} from "../thread-stage-types";

interface BuildRendererItemStreamInput {
  entries: CodexConversationItem[];
  requests: CodexTurnScopedConversationRequest[];
  turnStatus?: "inProgress" | "completed" | "interrupted" | "failed";
  isLatestTurn?: boolean;
}

type ProtocolThreadItemType = ThreadItem["type"];
type ProtocolSubAgentActivityItem = Extract<ThreadItem, { type: "subAgentActivity" }>;
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
  subAgentActivity: "subagentActivityInlineGroup",
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
    resolveVisibleMarkdownText(entry) ?? "",
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
  return stripCodexRemarkDirectiveLines(segments.join("\n"));
}

function resolveVisibleMarkdownText(entry: CodexConversationItem): string | undefined {
  if (entry.kind !== "assistantMessage" && entry.semanticKind !== "assistantMessage") {
    return entry.markdownText;
  }

  return stripCodexRemarkDirectiveLines(entry.markdownText);
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

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripLeadingAt(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function resolveSubagentActivityDisplayName(rawItem: ProtocolSubAgentActivityItem & Record<string, unknown>): string {
  const directDisplayName = normalizeOptionalText(rawItem.displayName);
  if (directDisplayName) return stripLeadingAt(directDisplayName);

  return "Agent";
}

function getSubagentActivityItem(rawItem: unknown): (ProtocolSubAgentActivityItem & Record<string, unknown>) | null {
  const record = getRecord(rawItem);
  if (!record || record.type !== "subAgentActivity") return null;
  if (typeof record.id !== "string") return null;
  if (typeof record.agentThreadId !== "string" || record.agentThreadId.trim().length === 0) return null;
  if (typeof record.agentPath !== "string") return null;
  if (record.kind !== "started" && record.kind !== "interacted" && record.kind !== "interrupted") return null;
  return record as ProtocolSubAgentActivityItem & Record<string, unknown>;
}

function normalizeSubagentActivityKind(rawItem: ProtocolSubAgentActivityItem & Record<string, unknown>): ThreadSubagentActivityStatus {
  const displayStatus = normalizeOptionalText(rawItem.displayStatus);
  if (displayStatus === "updated") return "updated";
  if (displayStatus === "interrupted") return "interrupted";
  if (displayStatus === "done") return "done";

  if (rawItem.kind === "interacted") return "updated";
  if (rawItem.kind === "interrupted") return "interrupted";
  return "started";
}

function resolveSubagentActivityOpenStatus(activityStatus: ThreadSubagentActivityStatus): ThreadOpenSubagentStatus {
  if (activityStatus === "interrupted" || activityStatus === "done") return "done";
  return "active";
}

function formatSubagentActivityStatusSummary(
  displayName: string,
  activityStatus: ThreadSubagentActivityStatus,
): string {
  if (activityStatus === "updated") return `${displayName} updated`;
  if (activityStatus === "interrupted") return `${displayName} interrupted`;
  if (activityStatus === "done") return `${displayName} finished`;
  return `${displayName} started working`;
}

function resolveSubagentActivityStatusLabel(rows: readonly ThreadSubagentActivityInlineRowModel[]): string {
  if (rows.some((row) => row.activityStatus === "interrupted")) return "interrupted";
  if (rows.some((row) => row.activityStatus === "updated")) return "updated";
  if (rows.length > 0 && rows.every((row) => row.activityStatus === "done" || row.status === "done")) return "finished";
  return "started working";
}

function buildSubagentActivityRow(
  rawItem: ProtocolSubAgentActivityItem & Record<string, unknown>,
): ThreadSubagentActivityInlineRowModel {
  const activityStatus = normalizeSubagentActivityKind(rawItem);
  const displayName = resolveSubagentActivityDisplayName(rawItem);
  return {
    conversationId: rawItem.agentThreadId.trim(),
    displayName,
    agentRole: null,
    spawnModel: null,
    status: resolveSubagentActivityOpenStatus(activityStatus),
    activityStatus,
    statusSummary: formatSubagentActivityStatusSummary(displayName, activityStatus),
    diffStats: null,
  };
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

  if (type === "subagentActivityInlineGroup") {
    const rawItem = getSubagentActivityItem(entry.rawItem);
    if (!rawItem) return null;
    const row = buildSubagentActivityRow(rawItem);
    return {
      id: entryId,
      turnId: entry.turnId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      searchableText: [
        row.displayName,
        row.statusSummary ?? "",
        resolveSubagentActivityStatusLabel([row]),
      ].filter((segment) => segment.trim().length > 0).join("\n"),
      type,
      entry,
      status: entry.status,
      isTurnCancelled: turnStatus === "interrupted",
      subagentActivityRows: [row],
      subagentActivityStatusLabel: resolveSubagentActivityStatusLabel([row]),
    };
  }

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
