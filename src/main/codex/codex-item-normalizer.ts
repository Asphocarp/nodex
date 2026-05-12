import type {
  CodexCommandAction,
  CodexFileChange,
  CodexFileChangeKind,
  CodexFileChangeView,
  CodexItemStatus,
  CodexMcpToolCallContentBlock,
  CodexMcpToolCallView,
  CodexItemView,
  CodexUserAttachment,
  ProtocolMcpToolCallError,
  ProtocolMcpToolCallItem,
  ProtocolMcpToolCallResult,
  CodexToolCallSubtype,
  CodexToolCallView,
  CodexUserInputQuestion,
} from "../../shared/types";
import { buildCodexFileChangeFromProtocol, buildCodexFileChangeUnifiedDiff } from "../../shared/codex-file-change";
import {
  buildAutomaticApprovalReviewSummary,
  normalizeAutomaticApprovalReviewPayload,
  normalizeMultiAgentActionPayload,
} from "../../shared/codex-transcript-special-items";
import { projectCodexReasoningSummary } from "./codex-reasoning-projection";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function normalizeTypeName(type: string): string {
  return type.replace(/[_\-\s]/g, "").toLowerCase();
}

function isType(type: string, accepted: string[]): boolean {
  const normalized = normalizeTypeName(type);
  return accepted.some((candidate) => normalizeTypeName(candidate) === normalized);
}

function getString(candidate: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function getNumber(candidate: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function getUnknown(candidate: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) {
      return candidate[key];
    }
  }
  return undefined;
}

function getProcessId(candidate: Record<string, unknown>): string | null {
  const direct = candidate.processId;
  if (typeof direct === "string" && direct.trim().length > 0) return direct;
  if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);

  const snake = candidate.process_id;
  if (typeof snake === "string" && snake.trim().length > 0) return snake;
  if (typeof snake === "number" && Number.isFinite(snake)) return String(snake);

  return null;
}

function normalizeItemStatus(value: unknown): CodexItemStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeTypeName(value);
  if (normalized === "inprogress") return "inProgress";
  if (normalized === "completed") return "completed";
  if (normalized === "failed") return "failed";
  if (normalized === "declined") return "declined";
  if (normalized === "interrupted") return "interrupted";
  return undefined;
}

export function resolveContextCompactionMarkdown(status: CodexItemStatus | undefined): string {
  return status === "inProgress"
    ? "Automatically compacting context"
    : "Context automatically compacted";
}

function resolveTurnErrorMarkdown(message: string | null | undefined, willRetry: boolean): string {
  const trimmed = message?.trim();
  if (trimmed) return trimmed;
  return willRetry ? "Reconnecting..." : "Thread hit an error";
}

function humanizeType(type: string): string {
  const spaced = type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .trim();
  if (!spaced) return "Thread item";
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function shouldRenderTypeFallback(result: CodexItemView): boolean {
  return !(
    result.normalizedKind === "userMessage" ||
    result.normalizedKind === "assistantMessage" ||
    result.normalizedKind === "plan" ||
    result.normalizedKind === "reasoning"
  );
}

function parseUserMessageText(candidate: Record<string, unknown>): string {
  const content = Array.isArray(candidate.content) ? candidate.content : [];
  const textParts = content
    .map((entry) => {
      const input = asRecord(entry);
      if (!input || !isType(getString(input, ["type"]) ?? "", ["text"])) return "";
      return getString(input, ["text"]) ?? "";
    })
    .filter((value) => value.length > 0);
  return textParts.join("\n");
}

function buildUserAttachmentId(itemId: string, kind: string, index: number): string {
  return `${itemId}:attachment:${kind}:${index}`;
}

function normalizeRemotePointerId(value: string): string {
  return value
    .replace(/^file-service:\/\//, "")
    .replace(/^sediment:\/\//, "");
}

export function buildCodexUserAttachmentsFromContent(
  content: unknown[],
  itemId: string,
): CodexUserAttachment[] {
  const fileAttachments: CodexUserAttachment[] = [];
  const imageAttachments: CodexUserAttachment[] = [];

  content.forEach((entry, index) => {
    const input = asRecord(entry);
    if (!input) return;

    const type = getString(input, ["type"]) ?? "";
    if (isType(type, ["image"])) {
      const source = getString(input, ["url", "source"]);
      if (!source) return;
      imageAttachments.push({
        type: "image",
        id: buildUserAttachmentId(itemId, "image", index),
        source,
        sourceKind: "local",
        caption: getString(input, ["caption", "name"]),
      });
      return;
    }

    if (isType(type, ["localImage"])) {
      const source = getString(input, ["path", "source"]);
      if (!source) return;
      imageAttachments.push({
        type: "image",
        id: buildUserAttachmentId(itemId, "local-image", index),
        source,
        sourceKind: "local",
        caption: getString(input, ["caption", "name"]),
      });
      return;
    }

    if (isType(type, ["image_asset_pointer", "imageAssetPointer", "assetPointer"])) {
      const pointer = getString(input, ["asset_pointer", "assetPointer", "pointer", "file_id", "fileId"]);
      if (!pointer) return;
      imageAttachments.push({
        type: "image",
        id: buildUserAttachmentId(itemId, "remote-image", index),
        source: normalizeRemotePointerId(pointer),
        sourceKind: "remote",
        caption: getString(input, ["caption", "name"]),
      });
      return;
    }

    if (isType(type, ["mention", "skill"])) {
      const name = getString(input, ["name"])?.trim();
      const attachmentPath = getString(input, ["path"])?.trim();
      if (!name || !attachmentPath) return;
      fileAttachments.push({
        type: "file",
        id: buildUserAttachmentId(itemId, normalizeTypeName(type), index),
        label: name,
        path: attachmentPath,
        sourceKind: isType(type, ["skill"]) ? "skill" : "mention",
      });
    }
  });

  return [...fileAttachments, ...imageAttachments];
}

function parseUserInputQuestions(value: unknown): CodexUserInputQuestion[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<CodexUserInputQuestion[]>((acc, question) => {
    const candidate = asRecord(question);
    if (!candidate) return acc;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.header !== "string" ||
      typeof candidate.question !== "string"
    ) {
      return acc;
    }

    const options = Array.isArray(candidate.options)
      ? candidate.options.reduce<NonNullable<CodexUserInputQuestion["options"]>>((optionAcc, option) => {
        const parsed = asRecord(option);
        if (!parsed) return optionAcc;
        if (typeof parsed.label !== "string" || typeof parsed.description !== "string") {
          return optionAcc;
        }
        optionAcc.push({
          label: parsed.label,
          description: parsed.description,
        });
        return optionAcc;
      }, [])
      : undefined;

    acc.push({
      id: candidate.id,
      header: candidate.header,
      question: candidate.question,
      isOther: Boolean(candidate.isOther),
      isSecret: Boolean(candidate.isSecret),
      options,
    });
    return acc;
  }, []);
}

function parseUserInputAnswers(value: unknown): Record<string, string[]> | undefined {
  const candidate = asRecord(value);
  if (!candidate) return undefined;

  const answers = Object.entries(candidate).reduce<Record<string, string[]>>((acc, [questionId, rawValue]) => {
    if (Array.isArray(rawValue)) {
      acc[questionId] = rawValue.filter((entry): entry is string => typeof entry === "string");
      return acc;
    }

    const nested = asRecord(rawValue);
    if (!nested || !Array.isArray(nested.answers)) return acc;
    acc[questionId] = nested.answers.filter((entry): entry is string => typeof entry === "string");
    return acc;
  }, {});

  return Object.keys(answers).length > 0 ? answers : undefined;
}

function formatAskedQuestionLabel(count: number): string {
  if (count <= 0) return "Asked for input";
  return count === 1 ? "Asked 1 question" : `Asked ${count} questions`;
}

function buildMarkdownImage(path: string | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed) return undefined;
  return `![Image](${trimmed})`;
}

function isTodoListMarkdown(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) return false;
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;
  return lines.every((line) => /^(- \[[ xX]\]|\d+\.)/.test(line.trim()));
}

function resolveToolCallError(candidate: Record<string, unknown>): string | undefined {
  const errorRecord = asRecord(candidate.error);
  return (
    getString(candidate, ["errorMessage", "error_message"]) ??
    (errorRecord ? getString(errorRecord, ["message"]) : undefined)
  );
}

function buildToolCall(
  subtype: CodexToolCallSubtype,
  toolName: string,
  extras?: Partial<CodexToolCallView>,
): CodexToolCallView {
  return {
    subtype,
    toolName,
    server: extras?.server,
    args: extras?.args,
    result: extras?.result,
    error: extras?.error,
  };
}

function resolveMcpToolCallError(candidate: Record<string, unknown>): ProtocolMcpToolCallError | null {
  const errorRecord = asRecord(candidate.error);
  if (!errorRecord) return null;

  const message = getString(errorRecord, ["message"]);
  if (!message) return null;

  return { message };
}

function normalizeMcpToolCallContentBlock(
  value: ProtocolMcpToolCallResult["content"][number],
): CodexMcpToolCallContentBlock {
  const candidate = asRecord(value);
  if (!candidate) {
    return {
      type: "unknown",
      raw: value,
    };
  }

  const type = getString(candidate, ["type"]);
  if (type === "text") {
    const text = getString(candidate, ["text"]);
    if (text === undefined) {
      return {
        type: "unknown",
        raw: value,
      };
    }

    return {
      type: "text",
      text,
      annotations: candidate.annotations as ProtocolMcpToolCallItem["arguments"] | undefined,
    };
  }

  if (type === "image") {
    const data = getString(candidate, ["data"]);
    if (!data) {
      return {
        type: "unknown",
        raw: value,
      };
    }

    return {
      type: "image",
      data,
      mimeType: getString(candidate, ["mimeType"]) ?? "image/png",
      annotations: candidate.annotations as ProtocolMcpToolCallItem["arguments"] | undefined,
    };
  }

  if (type === "audio") {
    const data = getString(candidate, ["data"]);
    if (!data) {
      return {
        type: "unknown",
        raw: value,
      };
    }

    return {
      type: "audio",
      data,
      mimeType: getString(candidate, ["mimeType"]) ?? "audio/wav",
      annotations: candidate.annotations as ProtocolMcpToolCallItem["arguments"] | undefined,
    };
  }

  if (type === "resource_link") {
    const uri = getString(candidate, ["uri"]);
    if (!uri) {
      return {
        type: "unknown",
        raw: value,
      };
    }

    return {
      type: "resource_link",
      uri,
      name: getString(candidate, ["name"]),
      title: getString(candidate, ["title"]),
      description: getString(candidate, ["description"]),
      mimeType: getString(candidate, ["mimeType"]),
      annotations: candidate.annotations as ProtocolMcpToolCallItem["arguments"] | undefined,
    };
  }

  if (type === "embedded_resource" || type === "resource") {
    const resource = type === "embedded_resource"
      ? asRecord(candidate.resource)
      : candidate;
    const uri = resource ? getString(resource, ["uri"]) : undefined;
    if (!resource || !uri) {
      return {
        type: "unknown",
        raw: value,
      };
    }

    return {
      type: "embedded_resource",
      resource: {
        uri,
        name: getString(resource, ["name"]),
        title: getString(resource, ["title"]),
        description: getString(resource, ["description"]),
        mimeType: getString(resource, ["mimeType"]),
        text: getString(resource, ["text"]),
        blob: getString(resource, ["blob"]),
        annotations: resource.annotations as ProtocolMcpToolCallItem["arguments"] | undefined,
      },
    };
  }

  return {
    type: "unknown",
    raw: value,
  };
}

function normalizeMcpToolCallResult(
  result: ProtocolMcpToolCallItem["result"],
  error: ProtocolMcpToolCallError | null,
): CodexMcpToolCallView["result"] {
  if (!result && !error) return null;

  if (error) {
    return {
      type: "error",
      kind: "protocol",
      error: error.message,
      rawError: error,
    };
  }

  const content = Array.isArray(result?.content) ? result.content : [];

  return {
    type: "success",
    content: content.map(normalizeMcpToolCallContentBlock),
    structuredContent: result?.structuredContent ?? null,
    raw: {
      content,
      structuredContent: result?.structuredContent ?? null,
    },
  };
}

function buildMcpToolCallView(
  candidate: Record<string, unknown>,
  status: CodexItemStatus | undefined,
  itemId: string,
): CodexMcpToolCallView {
  const server = getString(candidate, ["server"]) ?? "";
  const tool = getString(candidate, ["tool"]) ?? "mcp_tool";
  const error = resolveMcpToolCallError(candidate);
  const result = candidate.result as ProtocolMcpToolCallItem["result"];

  return {
    callId: getString(candidate, ["id"]) ?? itemId,
    functionName: `${server}__${tool}`,
    invocation: {
      server,
      tool,
      arguments: (candidate.arguments ?? null) as ProtocolMcpToolCallItem["arguments"],
    },
    result: normalizeMcpToolCallResult(result, error),
    durationMs: getNumber(candidate, ["durationMs", "duration_ms"]) ?? null,
    completed: status === "completed" || status === "failed",
  };
}

function extractFileChanges(candidate: Record<string, unknown>): {
  label?: string;
  paths: string[];
  parsedChanges: CodexFileChange[];
  diffs: string[];
} {
  const changes = Array.isArray(candidate.changes) ? candidate.changes : [];
  if (changes.length === 0) return { paths: [], parsedChanges: [], diffs: [] };

  const paths: string[] = [];
  const parsedChanges: CodexFileChange[] = [];

  for (const change of changes) {
    const parsed = asRecord(change);
    if (!parsed) continue;
    const path = getString(parsed, ["path"]);
    const diff = getString(parsed, ["diff"]);
    const kind = parseFileChangeKind(parsed.kind);
    const movePath = kind === "update"
      ? getString(asRecord(parsed.kind) ?? {}, ["move_path", "movePath"]) ?? null
      : undefined;
    if (!path || typeof diff !== "string" || !kind) continue;

    const materializedChange = buildCodexFileChangeFromProtocol({
      path,
      kind,
      diff,
      movePath,
    });
    if (!materializedChange) continue;

    parsedChanges.push(materializedChange);
    paths.push(path);
  }

  const uniquePaths = Array.from(new Set(paths));
  const diffs = parsedChanges
    .map((change) => buildCodexFileChangeUnifiedDiff(change))
    .filter((diff): diff is string => typeof diff === "string" && diff.trim().length > 0);
  const firstKind = parsedChanges[0]?.type;
  const actionLabel = firstKind === "add"
    ? "Created"
    : firstKind === "delete"
      ? "Deleted"
      : "Edited";
  const label =
    uniquePaths.length === 0
      ? undefined
      : uniquePaths.length === 1
        ? `${actionLabel} ${uniquePaths[0]}`
        : `${actionLabel} ${uniquePaths[0]} and ${uniquePaths.length - 1} more file(s)`;

  return {
    label,
    paths: uniquePaths,
    parsedChanges,
    diffs,
  };
}

function buildFileChangeView(data: {
  label?: string;
  paths: string[];
  parsedChanges: CodexFileChange[];
  diffs: string[];
}): CodexFileChangeView | undefined {
  if (data.parsedChanges.length === 0) return undefined;
  return {
    label: data.label,
    paths: data.paths,
    changes: data.parsedChanges,
    diffs: data.diffs,
  };
}

function parseFileChangeKind(value: unknown): CodexFileChangeKind | undefined {
  const candidate = asRecord(value);
  const type = candidate ? getString(candidate, ["type"]) : undefined;
  if (type === "add" || type === "delete" || type === "update") {
    return type;
  }
  return undefined;
}

function parseCommandActions(value: unknown): CodexCommandAction[] {
  if (!Array.isArray(value)) return [];

  const actions: CodexCommandAction[] = [];
  for (const rawAction of value) {
    const candidate = asRecord(rawAction);
    if (!candidate) continue;

    const actionType = getString(candidate, ["type"]);
    if (!actionType) continue;

    if (isType(actionType, ["read"])) {
      const command = getString(candidate, ["command", "cmd"]) ?? "";
      const name = getString(candidate, ["name"]) ?? getString(candidate, ["path"]) ?? command;
      const path = getString(candidate, ["path"]) ?? name;
      if (!name || !path) continue;
      actions.push({ type: "read", command, name, path });
      continue;
    }

    if (isType(actionType, ["listFiles", "list_files"])) {
      const command = getString(candidate, ["command", "cmd"]) ?? "";
      const path = typeof candidate.path === "string" ? candidate.path : null;
      actions.push({ type: "listFiles", command, path });
      continue;
    }

    if (isType(actionType, ["search"])) {
      const command = getString(candidate, ["command", "cmd"]) ?? "";
      const query = typeof candidate.query === "string" ? candidate.query : null;
      const path = typeof candidate.path === "string" ? candidate.path : null;
      actions.push({ type: "search", command, query, path });
      continue;
    }

    if (isType(actionType, ["unknown"])) {
      const command = getString(candidate, ["command", "cmd"]) ?? "";
      actions.push({ type: "unknown", command });
    }
  }

  return actions;
}

function applyFallbackContent(result: CodexItemView, type: string): CodexItemView {
  const hasVisibleContent = Boolean(result.markdownText || result.toolCall);

  if (hasVisibleContent) return result;
  if (!shouldRenderTypeFallback(result)) return result;

  return {
    ...result,
    markdownText: humanizeType(type),
  };
}

export function buildTurnErrorItemView(input: {
  threadId: string;
  turnId: string;
  message: string | null | undefined;
  additionalDetails?: string | null;
  willRetry: boolean;
  createdAt?: number;
  updatedAt?: number;
}): CodexItemView {
  const now = input.updatedAt ?? Date.now();
  const createdAt = input.createdAt ?? now;
  const itemId = `error:${input.turnId}`;
  const markdownText = resolveTurnErrorMarkdown(input.message, input.willRetry);

  return {
    threadId: input.threadId,
    turnId: input.turnId,
    itemId,
    type: "error",
    normalizedKind: "systemEvent",
    semanticKind: input.willRetry ? "streamError" : "systemError",
    status: input.willRetry ? "inProgress" : "failed",
    markdownText,
    additionalDetails: input.additionalDetails ?? null,
    willRetry: input.willRetry,
    rawItem: {
      id: itemId,
      type: "error",
      error: {
        message: markdownText,
        additionalDetails: input.additionalDetails ?? null,
      },
      willRetry: input.willRetry,
    },
    createdAt,
    updatedAt: now,
  };
}

export function normalizeThreadItem(item: unknown, threadId: string, turnId: string): CodexItemView | null {
  const candidate = asRecord(item);
  if (!candidate) return null;

  const itemId = getString(candidate, ["id"]);
  const itemType = getString(candidate, ["type"]);
  if (!itemId || !itemType) return null;

  const now = Date.now();
  const result: CodexItemView = {
    threadId,
    turnId,
    itemId,
    type: itemType,
    normalizedKind: "systemEvent",
    semanticKind: "systemEvent",
    rawItem: candidate,
    createdAt: now,
    updatedAt: now,
  };

  if (isType(itemType, ["userMessage"])) {
    const content = Array.isArray(candidate.content) ? candidate.content : [];
    const text = parseUserMessageText(candidate);
    const userAttachments = buildCodexUserAttachmentsFromContent(content, itemId);
    result.normalizedKind = "userMessage";
    result.semanticKind = "userMessage";
    result.role = "user";
    result.markdownText = text;
    if (userAttachments.length > 0) {
      result.userAttachments = userAttachments;
    }
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["agentMessage"])) {
    const text = getString(candidate, ["text"]) ?? "";
    result.normalizedKind = "assistantMessage";
    result.semanticKind = "assistantMessage";
    result.assistantPhase = getString(candidate, ["phase"]) ?? undefined;
    result.role = "assistant";
    result.markdownText = text;
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["plan"])) {
    const text = getString(candidate, ["text"]) ?? "";
    result.normalizedKind = "plan";
    result.semanticKind = isTodoListMarkdown(text) ? "todoList" : "proposedPlan";
    result.role = "assistant";
    result.markdownText = text;
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["requestUserInput", "request_user_input"])) {
    const questions = parseUserInputQuestions(candidate.questions);
    const answers = parseUserInputAnswers(candidate.answers);
    result.normalizedKind = answers ? "userInputResponse" : "userInputRequest";
    result.semanticKind = answers ? "userInputResponse" : "systemEvent";
    result.status = normalizeItemStatus(getUnknown(candidate, ["status"]));
    result.markdownText = formatAskedQuestionLabel(questions.length);
    result.userInputQuestions = questions;
    result.userInputAnswers = answers;
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["reasoning"])) {
    result.normalizedKind = "reasoning";
    result.semanticKind = "reasoning";
    result.status = normalizeItemStatus(getUnknown(candidate, ["status"]));
    result.markdownText = projectCodexReasoningSummary(candidate.summary);
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["commandExecution", "command_execution"])) {
    const command = getString(candidate, ["command"]) ?? "";
    const cwd = getString(candidate, ["cwd"]) ?? null;
    const output = getString(candidate, ["aggregatedOutput", "aggregated_output"]) ?? null;
    const processId = getProcessId(candidate);
    const commandActions = parseCommandActions(candidate.commandActions ?? candidate.command_actions);
    const exitCode = getNumber(candidate, ["exitCode", "exit_code"]) ?? null;
    const durationMs = getNumber(candidate, ["durationMs", "duration_ms"]) ?? null;

    result.normalizedKind = "commandExecution";
    result.semanticKind = "exec";
    result.status = normalizeItemStatus(getUnknown(candidate, ["status"]));
    result.command = command;
    result.cwd = cwd;
    result.processId = processId;
    result.commandActions = commandActions;
    result.aggregatedOutput = output;
    result.exitCode = exitCode;
    result.durationMs = durationMs;
    result.toolCall = buildToolCall("command", "bash", {
      args: {
        command,
        cwd: cwd ?? undefined,
        commandActions: commandActions.length > 0 ? commandActions : undefined,
      },
      result: output ?? undefined,
      error: resolveToolCallError(candidate),
    });
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["fileChange", "file_change"])) {
    const { label, paths, parsedChanges, diffs } = extractFileChanges(candidate);
    result.normalizedKind = "fileChange";
    result.semanticKind = "patch";
    result.status = normalizeItemStatus(getUnknown(candidate, ["status"]));
    result.fileChange = buildFileChangeView({ label, paths, parsedChanges, diffs });
    result.toolCall = buildToolCall("fileChange", "file_change", {
      args: {
        label,
      },
      result: {
        paths,
        diffs,
      },
      error: resolveToolCallError(candidate),
    });
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["mcpToolCall", "mcp_tool_call"])) {
    const server = getString(candidate, ["server"]);
    const tool = getString(candidate, ["tool"]) ?? "mcp_tool";
    const error = resolveToolCallError(candidate);
    const status = normalizeItemStatus(getUnknown(candidate, ["status"]));

    result.normalizedKind = "toolCall";
    result.semanticKind = "mcpToolCall";
    result.status = status;
    result.toolCall = buildToolCall("mcp", tool, {
      server,
      args: candidate.arguments,
      result: candidate.result,
      error,
    });
    result.mcpToolCall = buildMcpToolCallView(candidate, status, result.itemId);
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["automaticApprovalReview", "automatic_approval_review", "automatic-approval-review", "guardianApprovalReview"])) {
    const review = normalizeAutomaticApprovalReviewPayload(candidate);
    if (!review) return applyFallbackContent(result, itemType);

    result.normalizedKind = "systemEvent";
    result.semanticKind = "automaticApprovalReview";
    result.status = review.status === "inProgress" ? "inProgress" : "completed";
    result.markdownText = buildAutomaticApprovalReviewSummary(review);
    result.rawItem = {
      ...candidate,
      targetItemId: review.targetItemId,
      review: {
        status: review.status,
        riskScore: review.riskScore,
        riskLevel: review.riskLevel,
        rationale: review.rationale,
      },
      action: review.action,
    };
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["collabAgentToolCall", "collab_agent_tool_call"])) {
    const action = normalizeMultiAgentActionPayload(candidate);
    const tool = action?.action ?? getString(candidate, ["tool"]) ?? "collab_tool";
    const sender = action?.senderThreadId ?? getString(candidate, ["senderThreadId", "sender_thread_id"]);
    const receiverIds = action?.receiverThreadIds ?? [];

    result.normalizedKind = "toolCall";
    result.semanticKind = action?.action === "wait" ? "toolCall" : "multiAgentAction";
    result.status = action?.status ?? normalizeItemStatus(getUnknown(candidate, ["status"]));
    result.toolCall = buildToolCall("generic", tool, {
      args: {
        sender,
        receivers: receiverIds,
        receiverThreads: action?.receiverThreads ?? [],
        agentsStates: action?.agentsStates ?? {},
        prompt: action?.prompt ?? getString(candidate, ["prompt"]),
        model: action?.model ?? null,
        reasoningEffort: action?.reasoningEffort ?? null,
      },
      result: candidate.result,
      error: resolveToolCallError(candidate),
    });
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["webSearch", "web_search"])) {
    const query = getString(candidate, ["query"]);
    result.normalizedKind = "toolCall";
    result.semanticKind = "webSearch";
    result.toolCall = buildToolCall("webSearch", "web_search", {
      args: {
        query,
      },
      result: candidate.action ?? candidate.result,
      error: resolveToolCallError(candidate),
    });
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["imageView", "image_view"])) {
    const path = getString(candidate, ["path"]);
    result.normalizedKind = "assistantMessage";
    result.semanticKind = "assistantMessage";
    result.role = "assistant";
    result.status = "completed";
    result.markdownText = buildMarkdownImage(path) ?? "";
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["enteredReviewMode", "entered_review_mode"])) {
    return null;
  }

  if (isType(itemType, ["exitedReviewMode", "exited_review_mode"])) {
    return null;
  }

  if (isType(itemType, ["contextCompaction", "context_compaction"])) {
    const status = normalizeItemStatus(getUnknown(candidate, ["status"]));
    result.normalizedKind = "systemEvent";
    result.semanticKind = "contextCompaction";
    result.status = status;
    result.markdownText = resolveContextCompactionMarkdown(status);
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["mcpServerElicitation", "mcp_server_elicitation"])) {
    result.normalizedKind = "systemEvent";
    result.semanticKind = "mcpServerElicitation";
    result.status = Boolean(candidate.completed) ? "completed" : "inProgress";
    result.markdownText = getString(candidate, ["message"]) ?? "MCP elicitation";
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["hook"])) {
    result.normalizedKind = "hook";
    result.semanticKind = "hook";
    result.status = normalizeItemStatus(getUnknown(candidate, ["status"]));
    result.markdownText = getString(candidate, ["statusMessage", "status_message"]) ?? "Hook";
    return applyFallbackContent(result, itemType);
  }

  if (isType(itemType, ["planImplementation", "plan_implementation"])) {
    result.normalizedKind = "planImplementation";
    result.semanticKind = "planImplementation";
    result.status = Boolean(candidate.isCompleted) ? "completed" : "inProgress";
    result.markdownText = getString(candidate, ["planContent", "plan_content"]) ?? "";
    return applyFallbackContent(result, itemType);
  }

  return applyFallbackContent(
    result,
    itemType,
  );
}
