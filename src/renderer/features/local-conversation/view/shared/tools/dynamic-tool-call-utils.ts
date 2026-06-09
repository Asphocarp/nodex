import type { CodexConversationItem, CodexDynamicToolCallView } from "../../../../../lib/types";
import { humanizeIdentifier } from "./tool-call-utils";

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

export function resolveDynamicToolLabelFromName(toolName: string): string {
  if (toolName === "automation_update") return "Updated automation";
  if (toolName === "load_workspace_dependencies") return "Loaded workspace dependencies";
  if (toolName === "read_thread_terminal") return "Read thread terminal";
  if (toolName === "read_thread") return "Read thread";
  if (toolName === "create_thread") return "Created thread";
  if (toolName === "fork_thread") return "Forked thread";
  if (toolName === "list_threads") return "Listed threads";
  if (toolName === "send_message_to_thread") return "Sent message to thread";
  if (toolName === "set_thread_pinned") return "Updated thread pin";
  if (toolName === "set_thread_archived") return "Updated thread archive";
  if (toolName === "set_thread_title") return "Updated thread title";
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
  const toolName = entry.dynamicToolCall?.tool ?? entry.toolCall?.toolName ?? "dynamic_tool";
  return resolveDynamicToolLabelFromName(toolName);
}

export function buildDynamicToolCallGroupKey(call: CodexDynamicToolCallView | undefined): string {
  if (!call) return "";
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
