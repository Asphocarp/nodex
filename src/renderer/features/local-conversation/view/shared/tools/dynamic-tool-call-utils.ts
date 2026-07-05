import type { CodexConversationItem, CodexDynamicToolCallView } from "../../../../../lib/types";
import { humanizeIdentifier } from "./tool-call-utils";

const CODEX_APP_NAMESPACE = "codex_app";
const CHROME_EXTENSION_NAMESPACE = "chrome_extension";

const DYNAMIC_TOOL_COMPLETED_FALLBACK_LABELS: Record<string, string> = {
  automation_update: "Scheduled task updated",
  load_workspace_dependencies: "Loaded workspace dependencies",
  pia_slackbot_dm: "Pia Slackbot DM",
  read_thread_terminal: "Read thread terminal",
};

const DYNAMIC_TOOL_ACTIVE_FALLBACK_LABELS: Record<string, string> = {
  automation_update: "Updating scheduled task",
  load_workspace_dependencies: "Loading workspace dependencies",
  pia_slackbot_dm: "Pia Slackbot DM",
  read_thread_terminal: "Reading thread terminal",
};

export type DynamicToolRendererKind =
  | "chromeTabContext"
  | "codexAppThread"
  | "settings";

export type DynamicToolRegistryEntry = {
  namespace: string | null;
  tool: string;
  rendererKind: DynamicToolRendererKind;
  continuesLiveActivityBetweenCalls?: boolean;
  standaloneInConversation?: boolean;
  summaryOnlyInConversationGroup?: boolean;
  resolveLabel: (call: CodexDynamicToolCallView) => string | null;
  getCompletedSummaryPartKey?: (call: CodexDynamicToolCallView) => string | null;
};

const CODEX_APP_THREAD_LABELS = {
  threadsForkActive: "Forking thread",
  threadsForkCompleted: "Forked thread",
  threadsForkInWorktreeActive: "Creating worktree fork",
  threadsForkInWorktreeCompleted: "Created worktree fork",
  threadsCreateActive: "Creating chat",
  threadsCreateCompleted: "Created chat",
  threadsCreateInWorktreeActive: "Creating worktree chat",
  threadsCreateInWorktreeCompleted: "Created worktree chat",
  threadsListActive: "Listing threads",
  threadsListCompleted: "Listed threads",
  threadsReadActive: "Reading thread",
  threadsReadCompleted: "Read thread",
  threadsHandoffStatusActive: "Checking handoff status",
  threadsHandoffStatusCompleted: "Checked handoff status",
  threadsSendMessageActive: "Sending message to thread",
  threadsSendMessageCompleted: "Sent message to thread",
  threadsSetArchivedActive: "Updating thread archive",
  threadsSetArchivedCompleted: "Updated thread archive",
  threadsSetPinnedActive: "Updating thread pin",
  threadsSetPinnedCompleted: "Updated thread pin",
  threadsSetTitleActive: "Renaming thread",
  threadsSetTitleCompleted: "Renamed thread",
} as const satisfies Record<string, string>;

type CodexAppThreadLabelKey = keyof typeof CODEX_APP_THREAD_LABELS;

export type CodexAppHandoffStatus = "queued" | "running" | "success" | "warning" | "error";

export interface CodexAppHandoffStep {
  id: string;
  label: string;
  message: string | null;
  status: CodexAppHandoffStatus;
}

export interface CodexAppHandoffResult {
  destinationHostDisplayName: string | null;
  message: string | null;
  operationId: string;
  status: CodexAppHandoffStatus;
  steps: CodexAppHandoffStep[];
  threadTitle: string | null;
}

export interface CodexAppHandoffRenderState {
  activityStatus: "completed" | "failed" | "running";
  active: boolean;
  label: string;
  result: CodexAppHandoffResult | null;
}

function isKnownHandoffStatus(value: unknown): value is CodexAppHandoffStatus {
  return value === "queued"
    || value === "running"
    || value === "success"
    || value === "warning"
    || value === "error";
}

function resolveSettingsToolLabel(call: CodexDynamicToolCallView): string | null {
  if (call.tool === "read_settings") return call.completed ? "Read settings" : "Reading settings";
  if (call.tool === "write_settings") return call.completed ? "Updated settings" : "Updating settings";
  return null;
}

function resolveChromeTabContextLabel(call: CodexDynamicToolCallView): string | null {
  if (parseChromeTabContextTabId(call) === null) return null;
  return call.completed ? "Read tab" : "Reading tab";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getRequiredString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseInputTextJson(call: CodexDynamicToolCallView): Record<string, unknown> | null {
  const inputText = (call.contentItems ?? []).find((item) => item.type === "inputText")?.text;
  if (!inputText) return null;
  try {
    return asRecord(JSON.parse(inputText));
  } catch {
    return null;
  }
}

function parseCodexAppHandoffArguments(call: CodexDynamicToolCallView): { destinationHostId: string | null; threadId: string } | null {
  const args = asRecord(call.arguments);
  const threadId = getRequiredString(args ?? {}, "threadId");
  if (!threadId) return null;
  return {
    destinationHostId: getRequiredString(args ?? {}, "destinationHostId"),
    threadId,
  };
}

function parseCodexAppHandoffSteps(value: unknown): CodexAppHandoffStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CodexAppHandoffStep[] => {
    const record = asRecord(item);
    if (!record) return [];
    const id = getRequiredString(record, "id");
    const status = record.status;
    if (!id || !isKnownHandoffStatus(status)) return [];
    const label = getRequiredString(record, "label") ?? id;
    const message = getRequiredString(record, "message");
    return [{
      id,
      label,
      message,
      status,
    }];
  });
}

export function parseCodexAppHandoffResult(call: CodexDynamicToolCallView): CodexAppHandoffResult | null {
  const parsed = parseInputTextJson(call);
  if (!parsed) return null;
  const destinationHostDisplayName = getRequiredString(parsed, "destinationHostDisplayName");
  const operationId = getRequiredString(parsed, "operationId");
  const threadTitle = getRequiredString(parsed, "threadTitle");
  const status = parsed.status;
  if (!operationId || !isKnownHandoffStatus(status)) return null;
  return {
    destinationHostDisplayName,
    message: getRequiredString(parsed, "message"),
    operationId,
    status,
    steps: parseCodexAppHandoffSteps(parsed.steps),
    threadTitle,
  };
}

function isTerminalHandoffStatus(status: CodexAppHandoffStatus): boolean {
  return status === "success" || status === "warning" || status === "error";
}

export function resolveCodexAppHandoffRenderState(call: CodexDynamicToolCallView): CodexAppHandoffRenderState {
  const result = call.success === true ? parseCodexAppHandoffResult(call) : null;
  const completed = result ? isTerminalHandoffStatus(result.status) : call.completed;
  const success = result
    ? result.status === "error" ? false : result.status === "success" || result.status === "warning"
    : call.success;

  const activityStatus = !completed
    ? "running"
    : success === false ? "failed" : "completed";

  if (!result) {
    return {
      activityStatus,
      active: !completed,
      label: !completed
        ? "Handing off thread"
        : success === false ? "Failed to hand off thread" : "Handed off thread",
      result,
    };
  }

  if (!result.threadTitle || !result.destinationHostDisplayName) {
    return {
      activityStatus,
      active: !completed,
      label: !completed
        ? "Handing off thread"
        : success === false ? "Failed to hand off thread" : "Handed off thread",
      result,
    };
  }

  const label = !completed
    ? `Handing off ${result.threadTitle} to ${result.destinationHostDisplayName}`
    : success === false
      ? `Failed to hand off ${result.threadTitle} to ${result.destinationHostDisplayName}`
      : `Handed off ${result.threadTitle} to ${result.destinationHostDisplayName}`;
  return {
    activityStatus,
    active: !completed,
    label,
    result,
  };
}

function resolveCodexAppHandoffLabel(call: CodexDynamicToolCallView): string | null {
  if (!parseCodexAppHandoffArguments(call)) return null;
  return resolveCodexAppHandoffRenderState(call).label;
}

function resolveCodexAppThreadLabelKey(call: CodexDynamicToolCallView): CodexAppThreadLabelKey | null {
  switch (call.tool) {
    case "fork_thread": {
      const args = asRecord(call.arguments);
      if (!args) return null;
      const isWorktree = asRecord(args?.environment)?.type === "worktree";
      if (isWorktree) return call.completed ? "threadsForkInWorktreeCompleted" : "threadsForkInWorktreeActive";
      return call.completed ? "threadsForkCompleted" : "threadsForkActive";
    }
    case "create_thread": {
      const args = asRecord(call.arguments);
      const target = asRecord(args?.target);
      if (!target || typeof target.type !== "string") return null;
      return isCodexAppCreateOrForkWorktree(call)
        ? call.completed ? "threadsCreateInWorktreeCompleted" : "threadsCreateInWorktreeActive"
        : call.completed ? "threadsCreateCompleted" : "threadsCreateActive";
    }
    case "list_threads":
      return call.completed ? "threadsListCompleted" : "threadsListActive";
    case "read_thread":
      return call.completed ? "threadsReadCompleted" : "threadsReadActive";
    case "send_message_to_thread":
      return call.completed ? "threadsSendMessageCompleted" : "threadsSendMessageActive";
    case "set_thread_pinned":
      return call.completed ? "threadsSetPinnedCompleted" : "threadsSetPinnedActive";
    case "set_thread_archived":
      return call.completed ? "threadsSetArchivedCompleted" : "threadsSetArchivedActive";
    case "set_thread_title":
      return call.completed ? "threadsSetTitleCompleted" : "threadsSetTitleActive";
    case "get_handoff_status":
      return getRequiredString(asRecord(call.arguments) ?? {}, "operationId")
        ? call.completed ? "threadsHandoffStatusCompleted" : "threadsHandoffStatusActive"
        : null;
    default:
      return null;
  }
}

function resolveCodexAppThreadToolLabel(call: CodexDynamicToolCallView): string | null {
  if (call.tool === "handoff_thread") return resolveCodexAppHandoffLabel(call);
  const key = resolveCodexAppThreadLabelKey(call);
  return key ? CODEX_APP_THREAD_LABELS[key] : null;
}

function resolveCodexAppThreadSummaryKey(call: CodexDynamicToolCallView): string | null {
  if (call.tool === "handoff_thread") {
    const args = parseCodexAppHandoffArguments(call);
    return args ? JSON.stringify([args.threadId, args.destinationHostId]) : null;
  }
  if (call.tool === "get_handoff_status") {
    return getRequiredString(asRecord(call.arguments) ?? {}, "operationId");
  }
  return resolveCodexAppThreadLabelKey(call);
}

const DYNAMIC_TOOL_REGISTRY: DynamicToolRegistryEntry[] = [
  {
    namespace: CHROME_EXTENSION_NAMESPACE,
    tool: "get_tab_context",
    rendererKind: "chromeTabContext",
    resolveLabel: resolveChromeTabContextLabel,
    getCompletedSummaryPartKey: (call) => {
      return parseChromeTabContextTabId(call) === null ? null : call.callId;
    },
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "fork_thread",
    rendererKind: "codexAppThread",
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "create_thread",
    rendererKind: "codexAppThread",
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "handoff_thread",
    rendererKind: "codexAppThread",
    standaloneInConversation: true,
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "get_handoff_status",
    rendererKind: "codexAppThread",
    summaryOnlyInConversationGroup: true,
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "list_threads",
    rendererKind: "codexAppThread",
    continuesLiveActivityBetweenCalls: true,
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "read_thread",
    rendererKind: "codexAppThread",
    continuesLiveActivityBetweenCalls: true,
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "send_message_to_thread",
    rendererKind: "codexAppThread",
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "set_thread_pinned",
    rendererKind: "codexAppThread",
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "set_thread_archived",
    rendererKind: "codexAppThread",
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "set_thread_title",
    rendererKind: "codexAppThread",
    resolveLabel: resolveCodexAppThreadToolLabel,
    getCompletedSummaryPartKey: resolveCodexAppThreadSummaryKey,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "read_settings",
    rendererKind: "settings",
    resolveLabel: resolveSettingsToolLabel,
  },
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "write_settings",
    rendererKind: "settings",
    resolveLabel: resolveSettingsToolLabel,
  },
];

export function parseChromeTabContextTabId(call: CodexDynamicToolCallView): number | null {
  const args = asRecord(call.arguments);
  const tabId = args?.tabId;
  return typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

export function getDynamicToolRegistryEntry(
  call: CodexDynamicToolCallView | undefined,
): DynamicToolRegistryEntry | null {
  if (!call) return null;
  return DYNAMIC_TOOL_REGISTRY.find((entry) =>
    entry.namespace === call.namespace && entry.tool === call.tool
  ) ?? null;
}

export function isCodexAppMetaThreadTool(call: CodexDynamicToolCallView | undefined): boolean {
  return getDynamicToolRegistryEntry(call)?.rendererKind === "codexAppThread";
}

export function continuesCodexAppLiveActivityBetweenCalls(call: CodexDynamicToolCallView | undefined): boolean {
  return getDynamicToolRegistryEntry(call)?.continuesLiveActivityBetweenCalls === true;
}

export function isDynamicToolStandaloneInConversation(call: CodexDynamicToolCallView | undefined): boolean {
  return getDynamicToolRegistryEntry(call)?.standaloneInConversation === true;
}

export function isDynamicToolSummaryOnlyInConversationGroup(call: CodexDynamicToolCallView | undefined): boolean {
  return getDynamicToolRegistryEntry(call)?.summaryOnlyInConversationGroup === true;
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
  const entry = getDynamicToolRegistryEntry(call);
  return entry?.rendererKind === "codexAppThread" ? entry.resolveLabel(call) : null;
}

export function resolveDynamicToolRegistryLabel(call: CodexDynamicToolCallView): string | null {
  return getDynamicToolRegistryEntry(call)?.resolveLabel(call) ?? null;
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
  const specialLabel = DYNAMIC_TOOL_COMPLETED_FALLBACK_LABELS[toolName];
  if (specialLabel) return specialLabel;
  return humanizeIdentifier(toolName) || "Dynamic tool call";
}

export function resolveDynamicToolFallbackLabel(call: CodexDynamicToolCallView): string {
  const fallbackLabels = call.completed
    ? DYNAMIC_TOOL_COMPLETED_FALLBACK_LABELS
    : DYNAMIC_TOOL_ACTIVE_FALLBACK_LABELS;
  const specialLabel = fallbackLabels[call.tool];
  if (specialLabel) return specialLabel;
  return humanizeIdentifier(call.tool) || "Dynamic tool call";
}

export function resolveDynamicToolLabel(entry: CodexConversationItem): string {
  if (entry.dynamicToolCall) {
    const registryEntry = getDynamicToolRegistryEntry(entry.dynamicToolCall);
    const registryLabel = registryEntry?.resolveLabel(entry.dynamicToolCall);
    if (registryLabel) return registryLabel;
  }
  const toolName = entry.dynamicToolCall?.tool ?? entry.toolCall?.toolName ?? "dynamic_tool";
  return resolveDynamicToolLabelFromName(toolName);
}

export function buildDynamicToolCallSummaryPartKey(call: CodexDynamicToolCallView | undefined): string {
  if (!call) return "";
  const summaryKey = getDynamicToolRegistryEntry(call)?.getCompletedSummaryPartKey?.(call) ?? "";
  return [call.namespace ?? "", call.tool, summaryKey].join("\u001f");
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
