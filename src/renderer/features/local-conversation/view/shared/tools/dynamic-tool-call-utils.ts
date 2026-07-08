import { formatCodexScheduledAutomationRruleSummary } from "../../../../../lib/codex-scheduled-automation-display";
import { formatDynamicToolCallMarkdownFallback } from "../../../../../../shared/codex-dynamic-tool-markdown";
import type {
  CodexConversationItem,
  CodexDynamicToolCallView,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationDeleteResponse,
  CodexScheduledAutomationExecutionEnvironment,
  CodexScheduledAutomationKind,
  CodexScheduledAutomationMutationResponse,
  CodexScheduledAutomationReasoningEffort,
  CodexScheduledAutomationStatus,
  CodexScheduledAutomationUpdateInput,
} from "../../../../../lib/types";
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
  | "automationUpdate"
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

function parseAnyInputTextJson(call: CodexDynamicToolCallView): Record<string, unknown> | null {
  for (const item of call.contentItems ?? []) {
    if (item.type !== "inputText") continue;
    const text = item.text.trim();
    if (!text.startsWith("{")) continue;
    try {
      const parsed = asRecord(JSON.parse(text));
      if (parsed) return parsed;
    } catch {
      // Keep scanning; dynamic tools often include human text before JSON.
    }
  }
  return null;
}

type AutomationUpdateDirectiveMode =
  | "create"
  | "delete"
  | "suggested-create"
  | "suggested-update"
  | "update"
  | "view";

type AutomationUpdateInputMode =
  | "create"
  | "delete"
  | "suggested_create"
  | "suggested_update"
  | "update"
  | "view";

type AutomationUpdateResultMode = "create" | "delete" | "update";

export interface AutomationUpdateToolResult {
  automationId: string;
  deleteStatus: "deleted" | "not_found" | null;
  mode: AutomationUpdateResultMode | null;
  snapshot: {
    kind: CodexScheduledAutomationKind | null;
    name: string | null;
    rrule: string | null;
  } | null;
}

export interface AutomationUpdateRenderState {
  automationId: string | null;
  canAccept: boolean;
  createInput: CodexScheduledAutomationCreateInput | null;
  disabledReason: string | null;
  displayMode: AutomationUpdateDirectiveMode;
  openLabel: string;
  result: AutomationUpdateToolResult | null;
  statusLabel: string;
  subtitle: string | null;
  title: string;
  updateInput: CodexScheduledAutomationUpdateInput | null;
}

function normalizeAutomationUpdateMode(value: unknown): AutomationUpdateDirectiveMode | null {
  switch (value) {
    case "create":
    case "delete":
    case "update":
    case "view":
      return value;
    case "suggested_create":
    case "suggested-create":
      return "suggested-create";
    case "suggested_update":
    case "suggested-update":
      return "suggested-update";
    default:
      return null;
  }
}

function normalizeAutomationUpdateInputMode(value: unknown): AutomationUpdateInputMode | null {
  switch (value) {
    case "create":
    case "delete":
    case "suggested_create":
    case "suggested_update":
    case "update":
    case "view":
      return value;
    case "suggested-create":
      return "suggested_create";
    case "suggested-update":
      return "suggested_update";
    default:
      return null;
  }
}

function normalizeAutomationKind(value: unknown): CodexScheduledAutomationKind | null {
  return value === "cron" || value === "heartbeat" ? value : null;
}

function normalizeAutomationStatus(value: unknown): CodexScheduledAutomationStatus | null {
  return value === "ACTIVE" || value === "PAUSED" ? value : null;
}

function normalizeAutomationExecutionEnvironment(value: unknown): CodexScheduledAutomationExecutionEnvironment | null {
  return value === "local" || value === "worktree" ? value : null;
}

function normalizeAutomationReasoningEffort(value: unknown): CodexScheduledAutomationReasoningEffort | null {
  if (
    value === "none"
    || value === "minimal"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "max"
  ) {
    return value;
  }
  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeOptionalString(value);
}

function normalizeAutomationCwds(value: unknown): string[] | null {
  const normalizeItems = (items: unknown[]): string[] => {
    const seen = new Set<string>();
    return items.flatMap((item) => {
      if (typeof item !== "string") return [];
      const normalized = item.trim();
      if (!normalized || seen.has(normalized)) return [];
      seen.add(normalized);
      return [normalized];
    });
  };

  if (Array.isArray(value)) return normalizeItems(value);
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? normalizeItems(parsed) : null;
    } catch {
      return null;
    }
  }

  return normalizeItems(trimmed.split(","));
}

function parseAutomationUpdateToolResultSnapshot(value: unknown): AutomationUpdateToolResult["snapshot"] {
  const snapshot = asRecord(value);
  if (!snapshot) return null;
  return {
    kind: normalizeAutomationKind(snapshot.kind),
    name: normalizeOptionalString(snapshot.name),
    rrule: normalizeOptionalString(snapshot.rrule),
  };
}

export function parseAutomationUpdateToolResult(call: CodexDynamicToolCallView): AutomationUpdateToolResult | null {
  const parsed = parseAnyInputTextJson(call);
  const automationId = normalizeOptionalString(parsed?.automationId);
  if (!automationId) return null;
  const mode = parsed?.mode === "create" || parsed?.mode === "update" || parsed?.mode === "delete"
    ? parsed.mode
    : null;
  const deleteStatus = parsed?.deleteStatus === "deleted" || parsed?.deleteStatus === "not_found"
    ? parsed.deleteStatus
    : null;
  return {
    automationId,
    mode,
    deleteStatus,
    snapshot: parseAutomationUpdateToolResultSnapshot(parsed?.snapshot),
  };
}

function resolveAutomationUpdateStatusLabel(input: {
  deleteStatus: AutomationUpdateToolResult["deleteStatus"];
  mode: AutomationUpdateDirectiveMode;
}): string {
  switch (input.mode) {
    case "create":
      return "Created";
    case "update":
      return "Updated";
    case "delete":
      return input.deleteStatus === "not_found" ? "Missing" : "Deleted";
    case "suggested-create":
      return "Proposed";
    case "suggested-update":
      return "Proposed update";
    case "view":
      return "Scheduled task";
  }
}

function resolveAutomationUpdateOpenLabel(mode: AutomationUpdateDirectiveMode): string {
  if (mode === "suggested-create") return "Create scheduled task";
  if (mode === "suggested-update") return "Apply changes";
  return "Open";
}

function resolveAutomationUpdateDisplayMode(
  argsMode: AutomationUpdateDirectiveMode,
  result: AutomationUpdateToolResult | null,
): AutomationUpdateDirectiveMode {
  return result?.mode ?? argsMode;
}

function buildAutomationUpdateCreateInput(args: Record<string, unknown>, currentThreadId: string | null): CodexScheduledAutomationCreateInput | null {
  const kind = normalizeAutomationKind(args.kind);
  const name = normalizeOptionalString(args.name);
  const prompt = normalizeOptionalString(args.prompt);
  const rrule = normalizeOptionalString(args.rrule);
  if (!kind || !name || !prompt || !rrule) return null;

  if (kind === "heartbeat") {
    const targetThreadId = normalizeOptionalString(args.targetThreadId)
      ?? (args.destination === "thread" ? currentThreadId : null);
    if (!targetThreadId) return null;
    return {
      kind,
      targetThreadId,
      name,
      prompt,
      rrule,
      model: null,
      reasoningEffort: null,
    };
  }

  const cwds = normalizeAutomationCwds(args.cwds);
  const executionEnvironment = normalizeAutomationExecutionEnvironment(args.executionEnvironment);
  const model = normalizeOptionalString(args.model);
  const reasoningEffort = normalizeAutomationReasoningEffort(args.reasoningEffort);
  const localEnvironmentConfigPath = normalizeNullableString(args.localEnvironmentConfigPath);
  if (cwds === null || !executionEnvironment || !model || !reasoningEffort) return null;
  return {
    kind,
    name,
    prompt,
    rrule,
    cwds,
    executionEnvironment,
    localEnvironmentConfigPath: localEnvironmentConfigPath ?? null,
    model,
    reasoningEffort,
  };
}

function buildAutomationUpdateUpdateInput(args: Record<string, unknown>, currentThreadId: string | null): CodexScheduledAutomationUpdateInput | null {
  const id = normalizeOptionalString(args.id);
  const status = normalizeAutomationStatus(args.status);
  const createInput = buildAutomationUpdateCreateInput(args, currentThreadId);
  if (!id || !status || !createInput) return null;
  const updateInput: CodexScheduledAutomationUpdateInput = {
    ...createInput,
    id,
    status,
  };
  if (!Object.prototype.hasOwnProperty.call(args, "localEnvironmentConfigPath")) {
    delete updateInput.localEnvironmentConfigPath;
  }
  return updateInput;
}

function resolveAutomationUpdateDisabledReason(input: {
  mode: AutomationUpdateDirectiveMode;
  createInput: CodexScheduledAutomationCreateInput | null;
  updateInput: CodexScheduledAutomationUpdateInput | null;
}): string | null {
  if (input.mode === "suggested-create" && !input.createInput) return "This scheduled task proposal is missing required fields.";
  if (input.mode === "suggested-update" && !input.updateInput) return "This scheduled task update is missing required fields.";
  return null;
}

export function resolveAutomationUpdateRenderState(
  call: CodexDynamicToolCallView,
  currentThreadId: string | null = null,
): AutomationUpdateRenderState | null {
  if (call.namespace !== CODEX_APP_NAMESPACE || call.tool !== "automation_update") return null;
  const args = asRecord(call.arguments);
  if (!args) return null;
  const argsMode = normalizeAutomationUpdateMode(args.mode);
  const inputMode = normalizeAutomationUpdateInputMode(args.mode);
  if (!argsMode || !inputMode) return null;

  const result = call.success === true ? parseAutomationUpdateToolResult(call) : null;
  const displayMode = resolveAutomationUpdateDisplayMode(argsMode, result);
  const createInput = inputMode === "suggested_create" || inputMode === "create"
    ? buildAutomationUpdateCreateInput(args, currentThreadId)
    : null;
  const updateInput = inputMode === "suggested_update" || inputMode === "update"
    ? buildAutomationUpdateUpdateInput(args, currentThreadId)
    : null;
  const snapshot = result?.snapshot ?? null;
  const title = normalizeOptionalString(args.name)
    ?? snapshot?.name
    ?? normalizeOptionalString(args.id)
    ?? "Untitled scheduled task";
  const rrule = normalizeOptionalString(args.rrule) ?? snapshot?.rrule ?? null;
  const schedule = formatCodexScheduledAutomationRruleSummary(rrule) ?? "Custom schedule";
  const statusLabel = resolveAutomationUpdateStatusLabel({
    deleteStatus: result?.deleteStatus ?? null,
    mode: displayMode,
  });
  const automationId = result?.automationId
    ?? normalizeOptionalString(args.id)
    ?? null;
  const disabledReason = resolveAutomationUpdateDisabledReason({
    mode: displayMode,
    createInput,
    updateInput,
  });

  return {
    automationId,
    canAccept: disabledReason === null && (displayMode === "suggested-create" || displayMode === "suggested-update"),
    createInput,
    disabledReason,
    displayMode,
    openLabel: resolveAutomationUpdateOpenLabel(displayMode),
    result,
    statusLabel,
    subtitle: displayMode === "delete" ? null : schedule,
    title,
    updateInput,
  };
}

export function applyAutomationUpdateMutationResult(
  state: AutomationUpdateRenderState,
  response: CodexScheduledAutomationMutationResponse | CodexScheduledAutomationDeleteResponse,
): AutomationUpdateRenderState {
  if ("item" in response && response.item) {
    const resultMode: AutomationUpdateResultMode = state.displayMode === "suggested-update" ? "update" : "create";
    return {
      ...state,
      automationId: response.item.id,
      canAccept: false,
      disabledReason: null,
      displayMode: resultMode,
      openLabel: "Open",
      result: {
        automationId: response.item.id,
        deleteStatus: null,
        mode: resultMode,
        snapshot: null,
      },
      statusLabel: resolveAutomationUpdateStatusLabel({
        deleteStatus: null,
        mode: resultMode,
      }),
      subtitle: formatCodexScheduledAutomationRruleSummary(response.item.rrule) ?? state.subtitle,
      title: response.item.name,
    };
  }
  return state;
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

function resolveAutomationUpdateLabel(call: CodexDynamicToolCallView): string | null {
  if (!call.completed) return "Updating scheduled task";
  if (call.success === false) return "Failed to update scheduled task";
  const state = resolveAutomationUpdateRenderState(call);
  if (!state) return null;
  return state.statusLabel === "Scheduled task"
    ? state.title
    : `${state.statusLabel}: ${state.title}`;
}

function resolveAutomationUpdateSummaryKey(call: CodexDynamicToolCallView): string | null {
  const state = resolveAutomationUpdateRenderState(call);
  return state?.automationId ?? call.callId;
}

const DYNAMIC_TOOL_REGISTRY: DynamicToolRegistryEntry[] = [
  {
    namespace: CODEX_APP_NAMESPACE,
    tool: "automation_update",
    rendererKind: "automationUpdate",
    standaloneInConversation: true,
    resolveLabel: resolveAutomationUpdateLabel,
    getCompletedSummaryPartKey: resolveAutomationUpdateSummaryKey,
  },
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
  const markdownFallback = formatDynamicToolCallMarkdownFallback(call);
  if (markdownFallback) return [markdownFallback];

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
