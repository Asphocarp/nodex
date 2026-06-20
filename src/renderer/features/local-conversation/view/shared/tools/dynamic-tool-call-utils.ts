import type { CodexConversationItem, CodexDynamicToolCallView } from "../../../../../lib/types";
import { humanizeIdentifier } from "./tool-call-utils";

const CODEX_APP_NAMESPACE = "codex_app";

const CODEX_APP_META_THREAD_TOOL_NAMES = new Set([
  "fork_thread",
  "create_thread",
  "list_threads",
  "read_thread",
  "send_message_to_thread",
  "set_thread_pinned",
  "set_thread_archived",
  "set_thread_title",
  "handoff_thread",
  "get_handoff_status",
]);

const CODEX_APP_CONTINUING_LIVE_ACTIVITY_TOOLS = new Set([
  "list_threads",
  "read_thread",
]);

export function stringifyDynamicToolValue(value: unknown, spacing = 2): string {
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue) => (typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue),
      spacing,
    ) ?? "null";
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

export function isCodexAppMetaThreadTool(call: CodexDynamicToolCallView | undefined): boolean {
  return call?.namespace === CODEX_APP_NAMESPACE && CODEX_APP_META_THREAD_TOOL_NAMES.has(call.tool);
}

export function continuesCodexAppLiveActivityBetweenCalls(call: CodexDynamicToolCallView | undefined): boolean {
  return call?.namespace === CODEX_APP_NAMESPACE && CODEX_APP_CONTINUING_LIVE_ACTIVITY_TOOLS.has(call.tool);
}

export function buildCodexAppLiveActivityGroupKey(call: CodexDynamicToolCallView | undefined): string | null {
  if (!call || !continuesCodexAppLiveActivityBetweenCalls(call)) return null;
  return [call.namespace ?? "", call.tool].join("\u001f");
}

export function isCodexAppCreateOrForkWorktree(call: CodexDynamicToolCallView): boolean {
  const args = asRecord(call.arguments);
  if (!args) return false;
  if (call.tool === "fork_thread") {
    return asRecord(args.environment)?.type === "worktree";
  }
  if (call.tool === "create_thread") {
    const target = asRecord(args.target);
    return target?.type === "project" && asRecord(target.environment)?.type === "worktree";
  }
  return false;
}

export function resolveCodexAppMetaThreadToolLabel(call: CodexDynamicToolCallView): string | null {
  const completed = call.completed;
  switch (call.tool) {
    case "fork_thread":
      return isCodexAppCreateOrForkWorktree(call)
        ? completed ? "Created worktree fork" : "Creating worktree fork"
        : completed ? "Forked thread" : "Forking thread";
    case "create_thread":
      return isCodexAppCreateOrForkWorktree(call)
        ? completed ? "Created worktree chat" : "Creating worktree chat"
        : completed ? "Created chat" : "Creating chat";
    case "list_threads":
      return completed ? "Listed threads" : "Listing threads";
    case "read_thread":
      return completed ? "Read thread" : "Reading thread";
    case "send_message_to_thread":
      return completed ? "Sent message to thread" : "Sending message to thread";
    case "set_thread_pinned":
      return completed ? "Updated thread pin" : "Updating thread pin";
    case "set_thread_archived":
      return completed ? "Updated thread archive" : "Updating thread archive";
    case "set_thread_title":
      return completed ? "Renamed thread" : "Renaming thread";
    case "handoff_thread":
      return completed ? "Handed off thread" : "Handing off thread";
    case "get_handoff_status":
      return completed ? "Checked handoff status" : "Checking handoff status";
    default:
      return null;
  }
}

export type CodexAppCreateThreadResult =
  | { threadId: string; pendingWorktreeId?: never }
  | { pendingWorktreeId: string; threadId?: never };

export function parseCodexAppCreateThreadResult(call: CodexDynamicToolCallView): CodexAppCreateThreadResult | null {
  const inputText = (call.contentItems ?? []).find((item) => item.type === "inputText")?.text;
  if (!inputText) return null;
  try {
    const parsed = JSON.parse(inputText);
    const result = asRecord(parsed);
    if (typeof result?.threadId === "string" && result.threadId.trim()) {
      return { threadId: result.threadId.trim() };
    }
    if (typeof result?.pendingWorktreeId === "string" && result.pendingWorktreeId.trim()) {
      return { pendingWorktreeId: result.pendingWorktreeId.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveDynamicToolLabelFromName(toolName: string): string {
  if (toolName === "automation_update") return "Updated automation";
  if (toolName === "load_workspace_dependencies") return "Loaded workspace dependencies";
  if (toolName === "read_thread_terminal") return "Read terminal";
  if (toolName === "read_thread") return "Read thread";
  if (toolName === "create_thread") return "Created chat";
  if (toolName === "fork_thread") return "Forked thread";
  if (toolName === "list_threads") return "Listed threads";
  if (toolName === "send_message_to_thread") return "Sent message to thread";
  if (toolName === "set_thread_pinned") return "Updated thread pin";
  if (toolName === "set_thread_archived") return "Updated thread archive";
  if (toolName === "set_thread_title") return "Renamed thread";
  if (toolName === "get_handoff_status") return "Checked handoff status";
  if (toolName === "handoff_thread") return "Handed off thread";
  return humanizeIdentifier(toolName) || "Dynamic tool call";
}

export function resolveDynamicToolLeadingLabelFromName(toolName: string, completed: boolean): string {
  if (toolName === "automation_update") return completed ? "Updated" : "Updating";
  if (toolName === "load_workspace_dependencies") return completed ? "Loaded" : "Loading";
  if (toolName === "read_thread_terminal") return completed ? "Read" : "Reading";
  if (toolName === "read_thread") return completed ? "Read" : "Reading";
  if (toolName === "create_thread") return completed ? "Created" : "Creating";
  if (toolName === "fork_thread") return completed ? "Forked" : "Forking";
  if (toolName === "list_threads") return completed ? "Listed" : "Listing";
  if (toolName === "send_message_to_thread") return completed ? "Sent" : "Sending";
  if (toolName === "set_thread_pinned") return completed ? "Updated" : "Updating";
  if (toolName === "set_thread_archived") return completed ? "Updated" : "Updating";
  if (toolName === "set_thread_title") return completed ? "Updated" : "Updating";
  return completed ? "Called" : "Calling";
}

export function resolveDynamicToolLabel(entry: CodexConversationItem): string {
  if (entry.dynamicToolCall && isCodexAppMetaThreadTool(entry.dynamicToolCall)) {
    return resolveCodexAppMetaThreadToolLabel(entry.dynamicToolCall) ?? "Dynamic tool call";
  }
  const toolName = entry.dynamicToolCall?.tool ?? entry.toolCall?.toolName ?? "dynamic_tool";
  return resolveDynamicToolLabelFromName(toolName);
}

export function buildDynamicToolCallGroupKey(call: CodexDynamicToolCallView | undefined): string {
  if (!call) return "";
  const liveActivityKey = buildCodexAppLiveActivityGroupKey(call);
  if (liveActivityKey) return liveActivityKey;
  return [
    call.namespace ?? "",
    call.tool,
    stringifyDynamicToolValue(call.arguments, 0),
    stringifyDynamicToolValue(call.contentItems, 0),
    call.success === null ? "null" : String(call.success),
  ].join("\u001f");
}

export function extractDynamicToolTextContent(call: CodexDynamicToolCallView): string[] {
  return (call.contentItems ?? []).flatMap((item) => {
    if (item.type !== "inputText") return [];
    const text = item.text.trim();
    return text ? [text] : [];
  });
}

export function isLikelyJsonText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
