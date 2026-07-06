import type { CodexCommandAction, CodexConversationItem, CodexThreadDetailLevel } from "../../../lib/types";
import {
  buildCodexFileChangeUnifiedDiff,
  getCodexFileChangeEntries,
  hasCodexFileChangeEntries,
  resolveCodexPatchSuccess,
  summarizeCodexUnifiedDiff,
} from "../../../../shared/codex-file-change";
import {
  normalizeMultiAgentActionPayload,
  type CodexMultiAgentActionName,
} from "../../../../shared/codex-transcript-special-items";
import {
  extractCommandActions,
  isExplorationAction,
  normalizeExplorationPath,
  resolveExplorationPath,
  resolveExplorationSkillPathInfo,
} from "../view/shared/tools/command-actions";
import {
  buildDynamicToolCallSummaryPartKey,
  continuesCodexAppLiveActivityBetweenCalls,
  isDynamicToolStandaloneInConversation,
  isDynamicToolSummaryOnlyInConversationGroup,
  resolveDynamicToolLabel,
} from "../view/shared/tools/dynamic-tool-call-utils";
import { humanizeIdentifier } from "../view/shared/tools/tool-call-utils";
import { describeWebSearchAction } from "../web-search-display";
import { buildCollapsedToolActivitySummary } from "./collapsed-tool-activity-summary";
import type {
  ThreadCollapsedToolActivityBlockModel,
  ThreadCollapsedToolActivityActiveSummary,
  ThreadCollapsedToolActivityEntryModel,
  ThreadCollapsedToolActivityMcpSourceStats,
  ThreadCollapsedToolActivitySummaryCues,
  ThreadCollapsedToolActivitySummaryStats,
  ThreadAgentEntryModel,
  ThreadAgentItemModel,
  ThreadAgentRenderUnit,
  ThreadDynamicToolCallGroupBlockModel,
  ThreadMultiAgentGroupBlockModel,
  ThreadPendingMcpToolCallsBlockModel,
  ThreadSubagentActivityInlineRowModel,
  ThreadTranscriptBlockModel,
  ThreadExplorationGroupBlockModel,
  ThreadWebSearchGroupBlockModel,
} from "../thread-stage-types";

type CommandExecutionBlock = ThreadTranscriptBlockModel & { type: "exec" };
type MultiAgentBlock = ThreadTranscriptBlockModel & { type: "multiAgentAction" };
type McpToolCallBlock = ThreadTranscriptBlockModel & { type: "mcpToolCall" };
type DynamicToolCallBlock = ThreadTranscriptBlockModel & { type: "dynamicToolCall" };
type WebSearchBlock = ThreadTranscriptBlockModel & { type: "webSearch" };
type SubagentActivityBlock = ThreadTranscriptBlockModel & { type: "subagentActivityInlineGroup" };

export { buildCollapsedToolActivitySummary } from "./collapsed-tool-activity-summary";

export interface BuildAgentRenderUnitsOptions {
  keepLatestLiveActivityInGroup?: boolean;
}

type AutomaticApprovalReviewFailure = {
  id: string;
  status: "denied" | "timedOut";
};

interface SummaryFactWithApprovalFailures {
  automaticApprovalReviewFailures?: AutomaticApprovalReviewFailure[];
}

type McpToolCallSummarySource = Omit<ThreadCollapsedToolActivityMcpSourceStats, "count" | "runningCount">;

interface PatchPathSummaryFactSets {
  createdPaths: ReadonlySet<string>;
  runningCreatedPaths: ReadonlySet<string>;
  stoppedCreatedPaths: ReadonlySet<string>;
  editedPaths: ReadonlySet<string>;
  runningEditedPaths: ReadonlySet<string>;
  deletedPaths: ReadonlySet<string>;
  runningDeletedPaths: ReadonlySet<string>;
}

export type CollapsedToolActivitySummaryFact =
  | ({ type: "exploration"; readPaths: ReadonlySet<string>; runningReadPaths: ReadonlySet<string>; loadedToolPaths: ReadonlySet<string>; runningLoadedToolPaths: ReadonlySet<string>; searchCount: number; runningSearchCount: number; listCount: number; runningListCount: number } & SummaryFactWithApprovalFailures)
  | ({ type: "patch"; runningCreatedLineCount: number; changedLineCount: number } & PatchPathSummaryFactSets & SummaryFactWithApprovalFailures)
  | ({ type: "exec"; isInProgress: boolean; createsFolder?: true; searchesWeb?: true } & SummaryFactWithApprovalFailures)
  | ({ type: "mcpToolCall"; isInProgress: boolean; source: McpToolCallSummarySource | null } & SummaryFactWithApprovalFailures)
  | { type: "automaticApprovalReview"; id: string; status: "denied" | "timedOut" }
  | { type: "webSearch"; count: number; runningCount: number }
  | { type: "other" };

const MUTATING_CURL_METHOD_PATTERN = /(?:^|\s)(?:-X\s*|--request(?:=|\s+))(?:POST|PUT|PATCH|DELETE)\b/i;
const CURL_DATA_OPTION_PATTERN = /(?:^|\s)(?:--data(?:-[^\s=]+)?|--json|--form|--upload-file)(?:=|\s|$)/;
const CURL_SHORT_DATA_OPTION_PATTERN = /(?:^|\s)-(?:d|F|T)(?:=|\s|$)/;
const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s'"<>]+/gi;
const BROWSER_USE_SOURCE_KEY = "browser-use";
const BROWSER_USE_CHROME_SOURCE_KEY = "browser-use:chrome";
const COMPUTER_USE_SOURCE_KEY = "computer-use";
const NATIVE_APP_CHROME_SOURCE_KEY = "native-app:chrome";
const CHROME_BUNDLE_ID = "com.google.Chrome";
const CHROME_DISPLAY_NAME = "Google Chrome";
const CHROME_SOURCE_NAME = "Chrome";
const MACOS_NATIVE_APP_IDENTIFIER_PATTERN = /^[a-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const WINDOWS_NATIVE_APP_IDENTIFIER_PATTERN = /^(?:process:.*[\\/]?[^\\/]*\.exe|.*[\\/][^\\/]+\.exe|[^\\/]+\.exe)$/i;
const WINDOWS_CHROME_PROCESS_PATTERN = /^process:(?:.*[\\/])?chrome\.exe$/i;

function isTranscriptBlock(block: ThreadAgentItemModel | ThreadAgentEntryModel): block is ThreadTranscriptBlockModel {
  return "entry" in block;
}

function isMcpToolCallBlock(block: ThreadAgentItemModel | ThreadAgentEntryModel): block is McpToolCallBlock {
  return isTranscriptBlock(block) && block.type === "mcpToolCall";
}

function isExplorationCommandBlock(block: ThreadTranscriptBlockModel): block is CommandExecutionBlock {
  if (block.type !== "exec") return false;
  const commandActions = extractCommandActions(block.entry);
  return commandActions.length > 0 && commandActions.every(isExplorationAction);
}

function isRemoteHttpUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname !== "localhost" && !hostname.startsWith("127.");
  } catch {
    return false;
  }
}

function isCurlWebSearchCommand(command: string): boolean {
  if (!/^\s*curl(?:\s|$)/.test(command)) return false;
  if (MUTATING_CURL_METHOD_PATTERN.test(command)) return false;
  if (CURL_DATA_OPTION_PATTERN.test(command)) return false;
  if (CURL_SHORT_DATA_OPTION_PATTERN.test(command)) return false;

  const urls = command.match(HTTP_URL_PATTERN);
  if (!urls) return false;
  return urls.some(isRemoteHttpUrl);
}

function resolveCommandText(entry: CodexConversationItem): string | null {
  const directCommand = entry.command?.trim();
  if (directCommand) return directCommand;

  for (const action of extractCommandActions(entry)) {
    const actionCommand = action.command?.trim();
    if (actionCommand) return actionCommand;
  }

  return null;
}

function resolveMultiAgentBlockAction(
  block: ThreadAgentItemModel | ThreadAgentEntryModel | undefined,
): { block: MultiAgentBlock; action: CodexMultiAgentActionName } | null {
  if (!block || !isTranscriptBlock(block)) return null;
  if (block.type !== "multiAgentAction") return null;

  const payload = normalizeMultiAgentActionPayload(block.entry.rawItem);
  if (!payload || payload.action === "wait") return null;

  const multiAgentBlock = block as MultiAgentBlock;
  return { block: multiAgentBlock, action: payload.action };
}

function isRenderableFileChangeBlock(block: ThreadAgentEntryModel): boolean {
  if (!isTranscriptBlock(block)) return false;
  if (block.type !== "fileChange") return false;
  return hasCodexFileChangeEntries(block.entry.fileChange?.changes);
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

function buildSearchableTextFromActivityEntries(entries: ThreadCollapsedToolActivityEntryModel[]): string {
  return entries
    .flatMap((entry) => {
      if (entry.type === "explorationGroup") {
        return [entry.summary, ...entry.entries.map((item) => item.markdownText ?? item.toolCall?.toolName ?? "")];
      }
      return [entry.searchableText];
    })
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

function resolveSubagentActivityStatusLabel(rows: readonly ThreadSubagentActivityInlineRowModel[]): string {
  if (rows.some((row) => row.activityStatus === "interrupted")) return "interrupted";
  if (rows.some((row) => row.activityStatus === "updated")) return "updated";
  if (rows.length > 0 && rows.every((row) => row.activityStatus === "done" || row.status === "done")) return "finished";
  return "started working";
}

function resolveMultiAgentGroupStatus(entries: CodexConversationItem[]): CodexConversationItem["status"] {
  if (entries.some((entry) => entry.status === "inProgress")) return "inProgress";
  if (entries.some((entry) => entry.status === "failed")) return "failed";
  return "completed";
}

function resolveMcpSourceDisplayName(entry: CodexConversationItem): string | null {
  const source = resolveMcpToolCallSummarySource(entry);
  if (!source) return null;
  if (source.key === BROWSER_USE_SOURCE_KEY) return "the browser";
  return source.name;
}

function resolvePendingMcpSummary(entries: McpToolCallBlock[]): string {
  const sources = entries
    .map((entry) => resolveMcpSourceDisplayName(entry.entry))
    .filter((source): source is string => Boolean(source));
  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.length === 1) return `Using ${uniqueSources[0]}`;
  if (uniqueSources.length > 1) return `Using ${uniqueSources.slice(0, -1).join(", ")} and ${uniqueSources[uniqueSources.length - 1]}`;
  return entries.length === 1 ? "Using tool" : `Using ${entries.length} tools`;
}

function buildPendingMcpToolCallsGroup(
  entries: McpToolCallBlock[],
  seed: McpToolCallBlock,
): ThreadPendingMcpToolCallsBlockModel {
  return {
    id: `${seed.id}::pending-mcp-tool-calls`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: entries.map((entry) => entry.searchableText).join("\n"),
    type: "pendingMcpToolCalls",
    entries,
    summary: resolvePendingMcpSummary(entries),
    status: mergeActivityStatus(entries),
  };
}

function buildDynamicToolCallGroup(
  entries: DynamicToolCallBlock[],
  seed: DynamicToolCallBlock,
): ThreadDynamicToolCallGroupBlockModel {
  const summaryParts = buildDynamicToolCallGroupSummaryParts(entries);
  const summary = summaryParts.length > 0
    ? summaryParts.map((part) => formatDynamicToolCallSummaryPart(part.label, part.count)).join(" · ")
    : resolveDynamicToolLabel(seed.entry);
  return {
    id: `${seed.id}::dynamic-tool-call-group`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: [summary, ...entries.map((entry) => entry.searchableText)].join("\n"),
    type: "dynamicToolCallGroup",
    entries,
    summary,
    summaryParts,
    canExpand: !entries.every((entry) => isDynamicToolSummaryOnlyInConversationGroup(entry.entry.dynamicToolCall)),
    repeatCount: entries.length,
    status: mergeActivityStatus(entries),
  };
}

function formatDynamicToolCallSummaryPart(label: string, count: number): string {
  return count > 1 ? `${label} ${count} times` : label;
}

function buildDynamicToolCallGroupSummaryParts(
  entries: DynamicToolCallBlock[],
): Array<{ key: string; label: string; count: number }> {
  const parts: Array<{ key: string; label: string; count: number }> = [];
  for (const entry of entries) {
    const key = buildDynamicToolCallSummaryPartKey(entry.entry.dynamicToolCall);
    const existing = parts.find((part) => part.key === key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    parts.push({
      key,
      label: resolveDynamicToolLabel(entry.entry),
      count: 1,
    });
  }
  return parts;
}

function isDynamicToolCallBlock(block: ThreadAgentEntryModel | undefined): block is DynamicToolCallBlock {
  if (!block) return false;
  return isTranscriptBlock(block) && block.type === "dynamicToolCall";
}

function buildExplorationGroup(blocks: ThreadTranscriptBlockModel[], seed: ThreadTranscriptBlockModel): ThreadExplorationGroupBlockModel {
  const entries = blocks.map((block) => block.entry);
  const automaticApprovalReviews = blocks.flatMap((block) => block.automaticApprovalReviews ?? []);
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
    ...(automaticApprovalReviews.length > 0 ? { automaticApprovalReviews } : {}),
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
    status: resolveMultiAgentGroupStatus(entries),
  };
}

function buildSubagentActivityInlineGroup(
  entries: SubagentActivityBlock[],
  seed: SubagentActivityBlock,
): SubagentActivityBlock {
  const rowsByConversationId = new Map<string, ThreadSubagentActivityInlineRowModel>();
  for (const entry of entries) {
    for (const row of entry.subagentActivityRows ?? []) {
      rowsByConversationId.set(row.conversationId, row);
    }
  }

  const rows = Array.from(rowsByConversationId.values());
  const statusLabel = resolveSubagentActivityStatusLabel(rows);
  return {
    ...seed,
    id: `${seed.id}::subagent-activity-inline-group`,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: [
      statusLabel,
      ...rows.flatMap((row) => [row.displayName, row.statusSummary ?? ""]),
    ].map((segment) => segment.trim()).filter(Boolean).join("\n"),
    subagentActivityRows: rows,
    subagentActivityStatusLabel: statusLabel,
  };
}

function buildWebSearchGroup(
  entries: WebSearchBlock[],
  seed: WebSearchBlock,
): ThreadWebSearchGroupBlockModel {
  return {
    id: `${seed.id}::web-search-group`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: entries.map((entry) => entry.searchableText).join("\n"),
    type: "webSearchGroup",
    entries,
    status: mergeActivityStatus(entries),
  };
}

function buildRenderEntryUnit(block: ThreadAgentRenderUnit["block"]): ThreadAgentRenderUnit {
  switch (block.type) {
    case "webSearchGroup":
      return { kind: "webSearchGroup", block };
    case "multiAgentGroup":
      return { kind: "multiAgentGroup", block };
    case "pendingMcpToolCalls":
      return { kind: "pendingMcpToolCalls", block };
    case "dynamicToolCallGroup":
      return { kind: "dynamicToolCallGroup", block };
    case "collapsedToolActivity":
      return { kind: "collapsedToolActivity", block };
    default:
      return { kind: "entry", block };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getRawString(rawItem: unknown, keys: readonly string[]): string | null {
  const record = asRecord(rawItem);
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function getFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function trimNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getRecordString(value: unknown, key: string): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const recordValue = record[key];
  return typeof recordValue === "string" && recordValue.length > 0 ? recordValue : null;
}

function getTrimmedRecordString(value: unknown, key: string): string | null {
  const raw = getRecordString(value, key)?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function resolveWebSearchSummaryDetail(entry: CodexConversationItem): string {
  const rawItem = asRecord(entry.rawItem);
  const action = rawItem && Object.prototype.hasOwnProperty.call(rawItem, "action")
    ? rawItem.action
    : entry.toolCall?.result;
  const fallbackQuery = getTrimmedRecordString(entry.toolCall?.args, "query")
    ?? getTrimmedRecordString(rawItem, "query")
    ?? "";
  return describeWebSearchAction(action, fallbackQuery).trim();
}

function formatActivePath(path: string | null | undefined): string {
  return normalizeExplorationPath(path)?.replace(/^\/+/, "") ?? path?.trim() ?? "";
}

function formatReadActiveSummary(action: Extract<CodexCommandAction, { type: "read" }>, cwd: string | null): string {
  const resolvedPath = resolveExplorationPath(action.path || action.name, cwd);
  const skillPathInfo = resolveExplorationSkillPathInfo(resolvedPath);
  if (skillPathInfo?.isSkillDefinitionFile === true) return `Reading ${skillPathInfo.skillName} skill`;

  const target = formatActivePath(action.path || action.name);
  return target.length > 0 ? `Reading ${target}` : "Reading";
}

function formatSearchActiveSummary(action: Extract<CodexCommandAction, { type: "search" }>): string {
  const folder = formatActivePath(action.path);
  if (folder.length > 0) return `Searching files in ${folder} folder`;

  const query = action.query?.trim();
  if (query && query.length > 0) return `Searching for ${query}`;
  return "Searching files";
}

function formatListFilesActiveSummary(action: Extract<CodexCommandAction, { type: "listFiles" }>): string {
  const folder = formatActivePath(action.path);
  return folder.length > 0 ? `Listing files in ${folder} folder` : "Listing files";
}

function formatExplorationActiveSummary(action: CodexCommandAction, cwd: string | null): string | null {
  if (action.type === "read") return formatReadActiveSummary(action, cwd);
  if (action.type === "search") return formatSearchActiveSummary(action);
  if (action.type === "listFiles") return formatListFilesActiveSummary(action);
  return null;
}

function resolveExplorationActiveSummary(
  entries: readonly CodexConversationItem[],
  inProgressOnly: boolean,
): ThreadCollapsedToolActivityActiveSummary | null {
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const entry = entries[entryIndex];
    if (!entry) continue;
    if (inProgressOnly && entry.status !== "inProgress") continue;

    const actions = extractCommandActions(entry);
    for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex -= 1) {
      const action = actions[actionIndex];
      if (!action) continue;
      const label = formatExplorationActiveSummary(action, entry.cwd ?? null);
      if (!label) continue;
      return {
        kind: "text",
        key: resolveConversationItemKeyId(entry) ?? `exploration:${entryIndex}:${actionIndex}`,
        label,
      };
    }
  }

  return null;
}

function isPatchActivityActive(entry: ThreadTranscriptBlockModel): boolean {
  return resolveCodexPatchSuccess(entry.status) === null;
}

function resolvePatchActiveSummary(
  entry: ThreadTranscriptBlockModel,
): ThreadCollapsedToolActivityActiveSummary | null {
  const latestChange = getCodexFileChangeEntries(entry.entry.fileChange?.changes).at(-1);
  if (!latestChange) return null;

  const [path, change] = latestChange;
  const diffStats = summarizeCodexUnifiedDiff(buildCodexFileChangeUnifiedDiff(path, change));
  const label = change.type === "add"
    ? "Creating"
    : change.type === "delete"
      ? "Deleting"
      : "Editing";
  return {
    kind: "fileChange",
    key: resolveConversationItemKeyId(entry.entry) ?? entry.id,
    label,
    displayPath: formatActivePath(path),
    additions: diffStats?.additions ?? 0,
    deletions: diffStats?.deletions ?? 0,
  };
}

function resolveWebSearchActiveSummary(
  entries: readonly ThreadTranscriptBlockModel[],
  inProgressOnly: boolean,
): ThreadCollapsedToolActivityActiveSummary | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (inProgressOnly && entry.status !== "inProgress") continue;

    const detail = resolveWebSearchSummaryDetail(entry.entry);
    return {
      kind: "text",
      key: `web-search:${index}`,
      label: detail.length > 0 ? `Searching the web for ${detail}` : "Searching the web",
    };
  }

  return null;
}

function resolveExecActiveSummary(
  entry: ThreadTranscriptBlockModel,
): ThreadCollapsedToolActivityActiveSummary | null {
  const command = resolveCommandText(entry.entry);
  if (entry.status === "interrupted") {
    return {
      kind: "text",
      key: resolveConversationItemKeyId(entry.entry) ?? entry.id,
      label: command ? `Stopped ${command}` : "Stopped command",
    };
  }

  return {
    kind: "text",
    key: resolveConversationItemKeyId(entry.entry) ?? entry.id,
    label: command ? `Running ${command}` : "Running command",
  };
}

function resolveAutomaticApprovalReviewActiveSummary(
  entry: ThreadTranscriptBlockModel,
): ThreadCollapsedToolActivityActiveSummary | null {
  const status = getAutomaticApprovalReviewStatus(entry.entry) ?? entry.status;
  if (status === "approved") {
    return {
      kind: "text",
      key: resolveConversationItemKeyId(entry.entry) ?? entry.id,
      label: "Approved request",
    };
  }
  if (status === "denied") {
    return {
      kind: "text",
      key: resolveConversationItemKeyId(entry.entry) ?? entry.id,
      label: "Denied request",
    };
  }
  return null;
}

function isCollapsedActivityEntryActive(entry: ThreadCollapsedToolActivityEntryModel): boolean {
  if (entry.type === "explorationGroup") return entry.entries.some((item) => item.status === "inProgress");
  if (entry.type === "fileChange") return isPatchActivityActive(entry);
  if (entry.type === "webSearch") return entry.status === "inProgress";
  if (entry.type === "webSearchGroup") return entry.entries.some((item) => item.status === "inProgress");
  if (entry.type === "exec") return entry.status === "inProgress";
  return false;
}

function resolveCollapsedActivityActiveSummaryPass(
  entries: readonly ThreadCollapsedToolActivityEntryModel[],
  inProgressOnly: boolean,
): ThreadCollapsedToolActivityActiveSummary | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (inProgressOnly && !isCollapsedActivityEntryActive(entry)) continue;

    if (entry.type === "explorationGroup") {
      const summary = resolveExplorationActiveSummary(entry.entries, inProgressOnly);
      if (summary) return summary;
      continue;
    }
    if (entry.type === "fileChange") {
      const summary = resolvePatchActiveSummary(entry);
      if (summary) return summary;
      continue;
    }
    if (entry.type === "webSearch") {
      const summary = resolveWebSearchActiveSummary([entry], inProgressOnly);
      if (summary) return summary;
      continue;
    }
    if (entry.type === "webSearchGroup") {
      const summary = resolveWebSearchActiveSummary(entry.entries, inProgressOnly);
      if (summary) return summary;
      continue;
    }
    if (entry.type === "exec") return resolveExecActiveSummary(entry);
    if (entry.type === "automaticApprovalReview" && !inProgressOnly) {
      const summary = resolveAutomaticApprovalReviewActiveSummary(entry);
      if (summary) return summary;
    }
  }

  return null;
}

export function resolveCollapsedToolActivityActiveSummary(
  entries: readonly ThreadCollapsedToolActivityEntryModel[],
): ThreadCollapsedToolActivityActiveSummary | null {
  return resolveCollapsedActivityActiveSummaryPass(entries, true);
}

export function resolveCollapsedToolActivitySummaryCues(
  entries: readonly ThreadCollapsedToolActivityEntryModel[],
): ThreadCollapsedToolActivitySummaryCues {
  const runningSummary = resolveCollapsedActivityActiveSummaryPass(entries, true);
  return {
    runningSummary,
    continuitySummary: runningSummary ?? resolveCollapsedActivityActiveSummaryPass(entries, false),
  };
}

export function shouldDisplayCollapsedToolActivityActiveSummary(
  summary: ThreadCollapsedToolActivityActiveSummary | null | undefined,
  threadDetailLevel: CodexThreadDetailLevel,
): summary is ThreadCollapsedToolActivityActiveSummary {
  if (!summary) return false;
  return !(threadDetailLevel === "STEPS_PROSE" && summary.kind === "fileChange");
}

function resolveConversationItemKeyId(entry: CodexConversationItem): string | null {
  const rawId = getRawString(entry.rawItem, ["id", "callId", "call_id"]);
  if (rawId) return rawId;
  if (entry.mcpToolCall?.callId) return entry.mcpToolCall.callId;
  if (entry.dynamicToolCall?.callId) return entry.dynamicToolCall.callId;
  return entry.itemId || entry.entryId || null;
}

function resolveTranscriptBlockItemType(block: ThreadTranscriptBlockModel): string {
  switch (block.type) {
    case "userMessage":
      return "user-message";
    case "assistantMessage":
      return "assistant-message";
    case "todoList":
      return "todo-list";
    case "proposedPlan":
      return "proposed-plan";
    case "fileChange":
      return "patch";
    case "turnDiff":
      return "turn-diff";
    case "mcpToolCall":
      return "mcp-tool-call";
    case "dynamicToolCall":
      return "dynamic-tool-call";
    case "webSearch":
      return "web-search";
    case "mcpServerElicitation":
      return "mcp-server-elicitation";
    case "streamError":
      return "stream-error";
    case "systemError":
      return "system-error";
    case "remoteTaskCreated":
      return "remote-task-created";
    case "personalityChanged":
      return "personality-changed";
    case "forkedFromConversation":
      return "forked-from-conversation";
    case "modelChanged":
      return "model-changed";
    case "modelRerouted":
      return "model-rerouted";
    case "contextCompaction":
      return "context-compaction";
    case "automaticApprovalReview":
      return "automatic-approval-review";
    case "autoReviewInterruptionWarning":
      return "auto-review-interruption-warning";
    case "multiAgentAction":
      return "multi-agent-action";
    case "subagentActivityInlineGroup":
      return "subagent-activity-inline-group";
    case "userInputResponse":
      return "user-input-response";
    case "planImplementation":
      return "plan-implementation";
    default:
      return block.type;
  }
}

function resolveWebSearchGroupQuery(block: ThreadWebSearchGroupBlockModel): string {
  const first = block.entries[0]?.entry;
  const resultQuery = getRecordString(first?.toolCall?.result, "query");
  if (resultQuery) return resultQuery;
  const argsQuery = getRecordString(first?.toolCall?.args, "query");
  if (argsQuery) return argsQuery;
  const rawQuery = getRawString(first?.rawItem, ["query"]);
  return rawQuery ?? "unknown";
}

function resolveMultiAgentGroupKeyParts(block: ThreadMultiAgentGroupBlockModel): { action: string; id: string | null } {
  const first = block.entries[0];
  const payload = normalizeMultiAgentActionPayload(first?.rawItem);
  return {
    action: payload?.action ?? "unknown",
    id: first ? resolveConversationItemKeyId(first) : null,
  };
}

function isSubagentActivityInlineGroupBlock(
  block: ThreadAgentItemModel | ThreadAgentEntryModel | undefined,
): block is SubagentActivityBlock {
  return Boolean(block && isTranscriptBlock(block) && block.type === "subagentActivityInlineGroup");
}

function resolveExplorationGroupKey(block: ThreadExplorationGroupBlockModel, index: number): string {
  const first = block.entries[0];
  if (!first) return `exploration:none-${index}`;
  if (first.semanticKind === "exec" || first.kind === "commandExecution") {
    return `exploration:${resolveConversationItemKeyId(first) ?? index}`;
  }
  return `exploration:${first.type ?? "none"}-${index}`;
}

function resolveTranscriptBlockRenderKey(block: ThreadTranscriptBlockModel, index: number): string {
  const itemType = resolveTranscriptBlockItemType(block);
  const itemId = resolveConversationItemKeyId(block.entry);
  return `item:${itemType}:${itemId ?? index}`;
}

function resolveAgentEntryBlockRenderKey(block: ThreadAgentEntryModel, index: number): string {
  if (block.type === "explorationGroup") return resolveExplorationGroupKey(block, index);
  if (block.type === "workedFor") return `item:worked-for:${block.id || index}`;
  if ("entry" in block) return resolveTranscriptBlockRenderKey(block, index);
  return block.renderKey ?? `${block.type}:${block.id || index}`;
}

export function resolveAgentRenderUnitKey(unit: ThreadAgentRenderUnit, index: number): string {
  if (unit.kind === "collapsedToolActivity") {
    const seed = unit.block.entries[0];
    const seedKey = seed?.renderKey ?? (seed ? resolveAgentEntryBlockRenderKey(seed, index) : `unknown-${index}`);
    return `collapsed-tool-activity:${seedKey}:${index}`;
  }
  if (unit.kind === "pendingMcpToolCalls") {
    const first = unit.block.entries[0]?.entry;
    return `pending-mcp-tool-calls:${first ? resolveConversationItemKeyId(first) ?? index : index}:${index}`;
  }
  if (unit.kind === "dynamicToolCallGroup") {
    const first = unit.block.entries[0]?.entry;
    return `dynamic-tool-call-group:${first ? resolveConversationItemKeyId(first) ?? index : index}:${index}`;
  }
  if (unit.kind === "multiAgentGroup") {
    const { action, id } = resolveMultiAgentGroupKeyParts(unit.block);
    return `multi-agent-group:${action}:${id ?? index}`;
  }
  if (unit.kind === "webSearchGroup") {
    return `web-search-group:${resolveWebSearchGroupQuery(unit.block)}:${index}`;
  }
  return resolveAgentEntryBlockRenderKey(unit.block, index);
}

function withRenderKey<TBlock extends ThreadAgentEntryModel>(block: TBlock, renderKey: string): TBlock {
  return {
    ...block,
    renderKey,
  };
}

function withRenderKeys(units: ThreadAgentRenderUnit[]): ThreadAgentRenderUnit[] {
  return units.map((unit, index) => ({
    ...unit,
    block: withRenderKey(unit.block, resolveAgentRenderUnitKey(unit, index)),
  }) as ThreadAgentRenderUnit);
}

export function materializeAgentRenderUnits(units: ThreadAgentRenderUnit[]): ThreadAgentEntryModel[] {
  return units.map((unit, index) => unit.block.renderKey
    ? unit.block
    : withRenderKey(unit.block, resolveAgentRenderUnitKey(unit, index)));
}

function isCollapsedActivityEntry(
  block: ThreadAgentEntryModel,
  options: { keepMcpToolCallsOpen?: boolean } = {},
): block is ThreadCollapsedToolActivityEntryModel {
  if (block.type === "explorationGroup") return true;
  if (block.type === "webSearchGroup") return true;
  if (isMcpToolCallBlock(block)) return options.keepMcpToolCallsOpen === true ? false : !isPendingMcpToolCallBlock(block);

  switch (block.type) {
    case "exec":
    case "webSearch":
      return true;
    case "automaticApprovalReview": {
      const status = getAutomaticApprovalReviewStatus(block.entry) ?? block.status;
      return status === "denied" || status === "timedOut";
    }
    case "fileChange":
      return isRenderableFileChangeBlock(block);
    default:
      return false;
  }
}

function mergeActivityStatus(entries: ThreadCollapsedToolActivityEntryModel[]): CodexConversationItem["status"] {
  const statuses = entries
    .map((entry) => entry.status)
    .filter((status): status is NonNullable<CodexConversationItem["status"]> => status !== undefined);
  if (statuses.length === 0) return undefined;
  if (statuses.includes("inProgress")) return "inProgress";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("interrupted")) return "interrupted";
  if (statuses.includes("declined")) return "declined";
  return "completed";
}

function emptyCollapsedToolActivitySummaryStats(): ThreadCollapsedToolActivitySummaryStats {
  return {
    createdFileCount: 0,
    runningCreatedFileCount: 0,
    stoppedCreatedFileCount: 0,
    editedFileCount: 0,
    runningEditedFileCount: 0,
    deletedFileCount: 0,
    runningDeletedFileCount: 0,
    changedLineCount: 0,
    runningCreatedLineCount: 0,
    exploredFileCount: 0,
    runningExploredFileCount: 0,
    loadedToolCount: 0,
    runningLoadedToolCount: 0,
    searchCount: 0,
    runningSearchCount: 0,
    listCount: 0,
    runningListCount: 0,
    commandCount: 0,
    runningCommandCount: 0,
    completedWebSearchCommandCount: 0,
    runningFolderCreationCommandCount: 0,
    runningWebSearchCommandCount: 0,
    deniedRequestCount: 0,
    timedOutRequestCount: 0,
    hookCount: 0,
    runningHookCount: 0,
    mcpToolCallCount: 0,
    runningMcpToolCallCount: 0,
    mcpToolCallSources: [],
    webSearchCount: 0,
    runningWebSearchCount: 0,
  };
}

interface FileChangePathSummarySets {
  createdPaths: Set<string>;
  runningCreatedPaths: Set<string>;
  stoppedCreatedPaths: Set<string>;
  editedPaths: Set<string>;
  runningEditedPaths: Set<string>;
  deletedPaths: Set<string>;
  runningDeletedPaths: Set<string>;
}

interface ExplorationPathSummarySets {
  readPaths: Set<string>;
  runningReadPaths: Set<string>;
  loadedToolPaths: Set<string>;
  runningLoadedToolPaths: Set<string>;
}

interface AutomaticApprovalReviewFailureSets {
  ids: Set<string>;
}

function emptyFileChangePathSummarySets(): FileChangePathSummarySets {
  return {
    createdPaths: new Set(),
    runningCreatedPaths: new Set(),
    stoppedCreatedPaths: new Set(),
    editedPaths: new Set(),
    runningEditedPaths: new Set(),
    deletedPaths: new Set(),
    runningDeletedPaths: new Set(),
  };
}

function emptyAutomaticApprovalReviewFailureSets(): AutomaticApprovalReviewFailureSets {
  return {
    ids: new Set(),
  };
}

function emptyExplorationPathSummarySets(): ExplorationPathSummarySets {
  return {
    readPaths: new Set(),
    runningReadPaths: new Set(),
    loadedToolPaths: new Set(),
    runningLoadedToolPaths: new Set(),
  };
}

function applyFileChangePathSummarySets(
  stats: ThreadCollapsedToolActivitySummaryStats,
  sets: FileChangePathSummarySets,
): void {
  stats.createdFileCount = sets.createdPaths.size;
  stats.runningCreatedFileCount = sets.runningCreatedPaths.size;
  stats.stoppedCreatedFileCount = sets.stoppedCreatedPaths.size;
  stats.editedFileCount = sets.editedPaths.size;
  stats.runningEditedFileCount = sets.runningEditedPaths.size;
  stats.deletedFileCount = sets.deletedPaths.size;
  stats.runningDeletedFileCount = sets.runningDeletedPaths.size;
}

function applyExplorationPathSummarySets(
  stats: ThreadCollapsedToolActivitySummaryStats,
  sets: ExplorationPathSummarySets,
): void {
  stats.exploredFileCount = sets.readPaths.size;
  stats.runningExploredFileCount = sets.runningReadPaths.size;
  stats.loadedToolCount = sets.loadedToolPaths.size;
  stats.runningLoadedToolCount = sets.runningLoadedToolPaths.size;
}

function buildExplorationSummaryFact(group: ThreadExplorationGroupBlockModel): CollapsedToolActivitySummaryFact {
  const entries = group.entries;
  const readPaths = new Set<string>();
  const runningReadPaths = new Set<string>();
  const loadedToolPaths = new Set<string>();
  const runningLoadedToolPaths = new Set<string>();
  const automaticApprovalReviewFailures = buildAutomaticApprovalReviewFailures(group.automaticApprovalReviews ?? []);
  let searchCount = 0;
  let runningSearchCount = 0;
  let listCount = 0;
  let runningListCount = 0;

  for (const entry of entries) {
    const isRunning = entry.status === "inProgress";
    for (const action of extractCommandActions(entry)) {
      if (action.type === "read") {
        const path = resolveExplorationPath(action.path || action.name, entry.cwd ?? null);
        if (!path) continue;
        const skillPathInfo = resolveExplorationSkillPathInfo(path);
        if (skillPathInfo?.isSkillDefinitionFile === true) {
          loadedToolPaths.add(path);
          if (isRunning) runningLoadedToolPaths.add(path);
          continue;
        }
        readPaths.add(path);
        if (isRunning) runningReadPaths.add(path);
        continue;
      }
      if (action.type === "search") {
        searchCount += 1;
        if (isRunning) runningSearchCount += 1;
        continue;
      }
      if (action.type === "listFiles") {
        listCount += 1;
        if (isRunning) runningListCount += 1;
      }
    }
  }

  return {
    type: "exploration",
    readPaths,
    runningReadPaths,
    loadedToolPaths,
    runningLoadedToolPaths,
    searchCount,
    runningSearchCount,
    listCount,
    runningListCount,
    ...(automaticApprovalReviewFailures.length > 0 ? { automaticApprovalReviewFailures } : {}),
  };
}

function countContentLines(content: string): number {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.length === 0) return 0;
  const lines = normalized.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

function buildAutomaticApprovalReviewFailures(
  reviews: readonly CodexConversationItem[],
): AutomaticApprovalReviewFailure[] {
  const failures: AutomaticApprovalReviewFailure[] = [];
  for (const review of reviews) {
    const reviewStatus = getAutomaticApprovalReviewStatus(review) ?? review.status;
    if (reviewStatus !== "denied" && reviewStatus !== "timedOut") continue;
    const reviewId = (resolveConversationItemKeyId(review) ?? review.itemId) || review.entryId || review.type;
    failures.push({
      id: reviewId,
      status: reviewStatus,
    });
  }
  return failures;
}

function buildPatchSummaryFact(
  entry: ThreadTranscriptBlockModel,
): CollapsedToolActivitySummaryFact {
  const automaticApprovalReviewFailures = buildAutomaticApprovalReviewFailures(entry.automaticApprovalReviews ?? []);
  const changes = getCodexFileChangeEntries(entry.entry.fileChange?.changes);
  const createdPaths = new Set<string>();
  const runningCreatedPaths = new Set<string>();
  const stoppedCreatedPaths = new Set<string>();
  const editedPaths = new Set<string>();
  const runningEditedPaths = new Set<string>();
  const deletedPaths = new Set<string>();
  const runningDeletedPaths = new Set<string>();
  let runningCreatedLineCount = 0;
  let changedLineCount = 0;

  const isRunning = entry.status === "inProgress";
  const isStopped = isRunning && entry.isTurnCancelled === true;
  for (const [path, change] of changes) {
    const diffStats = summarizeCodexUnifiedDiff(buildCodexFileChangeUnifiedDiff(path, change));
    changedLineCount += (diffStats?.additions ?? 0) + (diffStats?.deletions ?? 0);

    if (change.type === "add") {
      createdPaths.add(path);
      if (isStopped) {
        stoppedCreatedPaths.add(path);
        continue;
      }
      if (isRunning) {
        runningCreatedPaths.add(path);
        runningCreatedLineCount += countContentLines(change.content);
      }
      continue;
    }
    if (change.type === "delete") {
      deletedPaths.add(path);
      if (isRunning) runningDeletedPaths.add(path);
      continue;
    }
    editedPaths.add(path);
    if (isRunning) runningEditedPaths.add(path);
  }

  return {
    type: "patch",
    createdPaths,
    runningCreatedPaths,
    stoppedCreatedPaths,
    runningCreatedLineCount,
    changedLineCount,
    editedPaths,
    runningEditedPaths,
    deletedPaths,
    runningDeletedPaths,
    ...(automaticApprovalReviewFailures.length > 0 ? { automaticApprovalReviewFailures } : {}),
  };
}

function getAutomaticApprovalReviewStatus(entry: CodexConversationItem): string | null {
  const raw = typeof entry.rawItem === "object" && entry.rawItem !== null
    ? entry.rawItem as { review?: { status?: unknown } }
    : null;
  const status = raw?.review?.status;
  if (typeof status === "string") return status;
  const rawStatus = asRecord(entry.rawItem)?.status;
  return typeof rawStatus === "string" ? rawStatus : null;
}

function getMcpSourceName(entry: CodexConversationItem): string | null {
  const invocationServer = entry.mcpToolCall?.invocation.server;
  const serverName = invocationServer ?? entry.toolCall?.server ?? null;
  if (!serverName) return null;
  const trimmed = serverName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getMcpInvocationArguments(entry: CodexConversationItem): Record<string, unknown> | null {
  return asRecord(entry.mcpToolCall?.invocation.arguments ?? entry.toolCall?.args);
}

function getMcpRawSource(entry: CodexConversationItem): Record<string, unknown> | null {
  return asRecord(asRecord(entry.rawItem)?.source);
}

function getMcpAppRecord(entry: CodexConversationItem): Record<string, unknown> | null {
  const raw = asRecord(entry.rawItem);
  const candidates = [
    asRecord(raw?.app),
    asRecord(raw?.connector),
    asRecord(raw?.plugin),
    asRecord(raw?.appContext),
    asRecord(raw?.source),
    asRecord(entry.toolCall),
  ];
  return candidates.find((candidate) => {
    if (!candidate) return false;
    return getFirstString(
      candidate.id,
      candidate.appId,
      candidate.connectorId,
      candidate.pluginId,
      candidate.name,
    ) !== null;
  }) ?? null;
}

function getMcpLogoMetadata(entry: CodexConversationItem): {
  logoUrl: string | null;
  logoUrlDark: string | null;
} {
  const raw = asRecord(entry.rawItem);
  const tool = asRecord(entry.toolCall);
  const candidates = [
    raw,
    asRecord(raw?.source),
    asRecord(raw?.server),
    asRecord(raw?.app),
    asRecord(raw?.connector),
    asRecord(raw?.plugin),
    asRecord(raw?.meta),
    asRecord(raw?.metadata),
    tool,
    asRecord(tool?.source),
    asRecord(tool?.server),
    asRecord(tool?.app),
    asRecord(tool?.connector),
    asRecord(tool?.plugin),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const logoUrl = getFirstString(candidate.logoUrl, candidate.logo_url, candidate.logoPath, candidate.logo_path);
    const logoUrlDark = getFirstString(
      candidate.logoUrlDark,
      candidate.logoDarkUrl,
      candidate.logo_url_dark,
      candidate.logo_dark_url,
      candidate.logoDarkURL,
    );
    if (logoUrl || logoUrlDark) return { logoUrl, logoUrlDark };
  }

  return { logoUrl: null, logoUrlDark: null };
}

function getNativeAppName(nativeAppReference: unknown): string | null {
  if (typeof nativeAppReference === "string") return nativeAppReference.trim() || null;
  const nativeApp = asRecord(nativeAppReference);
  if (!nativeApp) return null;
  return getFirstString(
    nativeApp.appId,
    nativeApp.displayName,
    nativeApp.display_name,
    nativeApp.appName,
    nativeApp.app_name,
    nativeApp.name,
    nativeApp.title,
    nativeApp.bundleIdentifier,
    nativeApp.bundle_identifier,
    nativeApp.bundleId,
    nativeApp.bundle_id,
  );
}

function isNativeAppIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return MACOS_NATIVE_APP_IDENTIFIER_PATTERN.test(trimmed) || WINDOWS_NATIVE_APP_IDENTIFIER_PATTERN.test(trimmed);
}

function getNestedNativeAppIdentifier(value: unknown): string | null {
  const direct = trimNonEmptyString(value);
  if (direct) return isNativeAppIdentifier(direct) ? direct : null;

  const record = asRecord(value);
  if (!record) return null;

  return trimNonEmptyString(
    getFirstString(
      record.bundleIdentifier,
      record.bundle_identifier,
      record.bundleId,
      record.bundle_id,
    ),
  );
}

function getNestedNativeAppDisplayName(value: unknown): string | null {
  const direct = trimNonEmptyString(value);
  if (direct) return direct;

  const record = asRecord(value);
  if (!record) return null;

  return trimNonEmptyString(
    getFirstString(
      record.displayName,
      record.display_name,
      record.appName,
      record.app_name,
      record.name,
      record.title,
      record.bundleIdentifier,
      record.bundle_identifier,
      record.bundleId,
      record.bundle_id,
    ),
  );
}

function resolveComputerUseNativeAppIdentifier(args: Record<string, unknown>): string | null {
  return trimNonEmptyString(
    getFirstString(
      args.appId,
      args.app_id,
      getNestedNativeAppIdentifier(args.app),
      getNestedNativeAppIdentifier(args.currentApp),
      getNestedNativeAppIdentifier(args.current_app),
      args.bundleIdentifier,
      args.bundle_identifier,
      args.bundleId,
      args.bundle_id,
    ),
  );
}

function resolveComputerUseNativeAppDisplayName(args: Record<string, unknown>): string | null {
  return trimNonEmptyString(
    getFirstString(
      getNestedNativeAppDisplayName(args.app),
      getNestedNativeAppDisplayName(args.currentApp),
      getNestedNativeAppDisplayName(args.current_app),
      args.targetAppName,
      args.target_app_name,
      args.appName,
      args.app_name,
      args.bundleIdentifier,
      args.bundle_identifier,
      args.bundleId,
      args.bundle_id,
      args.displayName,
      args.display_name,
      args.application,
      args.name,
      args.title,
    ),
  );
}

function isChromeNativeApp(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return trimmed === CHROME_BUNDLE_ID
    || trimmed === CHROME_SOURCE_NAME
    || trimmed === CHROME_DISPLAY_NAME
    || lower === "chrome"
    || lower === CHROME_DISPLAY_NAME.toLowerCase()
    || WINDOWS_CHROME_PROCESS_PATTERN.test(trimmed);
}

function resolveComputerUseNativeAppReference(entry: CodexConversationItem): unknown | null {
  const rawSource = getMcpRawSource(entry);
  if (rawSource?.kind === "computerUse") return rawSource.app ?? null;
  if (getMcpSourceName(entry) !== COMPUTER_USE_SOURCE_KEY) return null;

  const args = getMcpInvocationArguments(entry);
  if (!args) return null;

  const appId = resolveComputerUseNativeAppIdentifier(args);
  if (appId) return { kind: "appId", appId };

  const displayName = resolveComputerUseNativeAppDisplayName(args);
  return displayName ? { kind: "displayName", displayName } : null;
}

function buildMcpSource(
  key: string,
  name: string,
  logoMetadata: { logoUrl: string | null; logoUrlDark: string | null },
  nativeAppReference: unknown | null = null,
): McpToolCallSummarySource {
  return {
    key,
    logoUrl: logoMetadata.logoUrl,
    logoUrlDark: logoMetadata.logoUrlDark,
    name,
    nativeAppReference,
  };
}

function resolveMcpToolCallSummarySource(entry: CodexConversationItem): McpToolCallSummarySource | null {
  const serverName = getMcpSourceName(entry);
  const logoMetadata = getMcpLogoMetadata(entry);
  const rawSource = getMcpRawSource(entry);

  if (rawSource?.kind === "browserUse") {
    const isChrome = rawSource.backend === "chrome";
    return buildMcpSource(
      isChrome ? BROWSER_USE_CHROME_SOURCE_KEY : BROWSER_USE_SOURCE_KEY,
      isChrome ? CHROME_SOURCE_NAME : BROWSER_USE_SOURCE_KEY,
      logoMetadata,
    );
  }

  const nativeAppReference = resolveComputerUseNativeAppReference(entry);
  if (nativeAppReference) {
    const nativeAppName = getNativeAppName(nativeAppReference);
    if (nativeAppName) {
      const normalizedNativeApp = nativeAppName.trim();
      const isChrome = isChromeNativeApp(normalizedNativeApp);
      return buildMcpSource(
        isChrome ? NATIVE_APP_CHROME_SOURCE_KEY : `native-app:${normalizedNativeApp}`,
        isChrome ? CHROME_SOURCE_NAME : humanizeIdentifier(normalizedNativeApp) || normalizedNativeApp,
        logoMetadata,
        nativeAppReference,
      );
    }
  }

  if (rawSource?.kind === "computerUse" || serverName === COMPUTER_USE_SOURCE_KEY) {
    return buildMcpSource(COMPUTER_USE_SOURCE_KEY, humanizeIdentifier(COMPUTER_USE_SOURCE_KEY), logoMetadata);
  }

  const rawSourceKey = rawSource ? getFirstString(rawSource.groupKey, rawSource.key, rawSource.id) : null;
  if (rawSource && rawSourceKey) {
    const rawSourceName = getFirstString(rawSource.name, rawSource.displayName, rawSource.title)
      ?? humanizeIdentifier(rawSourceKey)
      ?? rawSourceKey;
    return buildMcpSource(rawSourceKey, rawSourceName, logoMetadata, rawSource.nativeAppReference ?? null);
  }

  const appRecord = getMcpAppRecord(entry);
  const appId = appRecord
    ? getFirstString(appRecord.id, appRecord.appId, appRecord.connectorId, appRecord.pluginId)
    : null;
  if (appRecord && appId) {
    const appName = getFirstString(appRecord.name, appRecord.displayName, appRecord.title) ?? appId;
    return buildMcpSource(`app:${appId}`, appName, logoMetadata);
  }

  if (!serverName) return null;

  return buildMcpSource(
    `server:${serverName}`,
    humanizeIdentifier(serverName) || serverName,
    logoMetadata,
  );
}

function incrementMcpSource(
  stats: ThreadCollapsedToolActivitySummaryStats,
  source: McpToolCallSummarySource,
  isInProgress: boolean,
): void {
  const existing = stats.mcpToolCallSources.find((candidate) => candidate.key === source.key);
  if (existing) {
    existing.count += 1;
    if (isInProgress) existing.runningCount += 1;
    return;
  }
  stats.mcpToolCallSources.push({
    ...source,
    count: 1,
    runningCount: isInProgress ? 1 : 0,
  });
}

function applyAutomaticApprovalFailuresToStats(
  failures: readonly AutomaticApprovalReviewFailure[] | undefined,
  stats: ThreadCollapsedToolActivitySummaryStats,
  approvalFailureSets: AutomaticApprovalReviewFailureSets,
): void {
  for (const failure of failures ?? []) {
    if (approvalFailureSets.ids.has(failure.id)) continue;
    approvalFailureSets.ids.add(failure.id);
    if (failure.status === "denied") stats.deniedRequestCount += 1;
    if (failure.status === "timedOut") stats.timedOutRequestCount += 1;
  }
}

export function buildCollapsedToolActivitySummaryFact(
  entry: ThreadCollapsedToolActivityEntryModel,
): CollapsedToolActivitySummaryFact {
  if (entry.type === "explorationGroup") return buildExplorationSummaryFact(entry);
  if (entry.type === "fileChange") return buildPatchSummaryFact(entry);
  if (entry.type === "exec") {
    if (isExplorationCommandBlock(entry)) return { type: "other" };
    const isInProgress = entry.status === "inProgress";
    const command = resolveCommandText(entry.entry);
    const automaticApprovalReviewFailures = buildAutomaticApprovalReviewFailures(entry.automaticApprovalReviews ?? []);
    return {
      type: "exec",
      isInProgress,
      ...(command && /^\s*mkdir(?:\s|$)/.test(command) ? { createsFolder: true } : {}),
      ...(command && isCurlWebSearchCommand(command) && (isInProgress || entry.entry.exitCode === 0)
        ? { searchesWeb: true }
        : {}),
      ...(automaticApprovalReviewFailures.length > 0 ? { automaticApprovalReviewFailures } : {}),
    };
  }
  if (entry.type === "automaticApprovalReview") {
    const [failure] = buildAutomaticApprovalReviewFailures([entry.entry]);
    return failure ? { type: "automaticApprovalReview", id: failure.id, status: failure.status } : { type: "other" };
  }
  if (entry.type === "webSearchGroup") {
    return {
      type: "webSearch",
      count: entry.entries.length,
      runningCount: entry.entries.filter((item) => item.status === "inProgress").length,
    };
  }
  if (entry.type === "mcpToolCall") {
    const automaticApprovalReviewFailures = buildAutomaticApprovalReviewFailures(entry.automaticApprovalReviews ?? []);
    return {
      type: "mcpToolCall",
      isInProgress: entry.status === "inProgress",
      source: resolveMcpToolCallSummarySource(entry.entry),
      ...(automaticApprovalReviewFailures.length > 0 ? { automaticApprovalReviewFailures } : {}),
    };
  }
  if (entry.type === "webSearch") {
    return {
      type: "webSearch",
      count: 1,
      runningCount: entry.status === "inProgress" ? 1 : 0,
    };
  }
  return { type: "other" };
}

function applyCollapsedToolActivitySummaryFact(
  fact: CollapsedToolActivitySummaryFact,
  stats: ThreadCollapsedToolActivitySummaryStats,
  fileChangePathSets: FileChangePathSummarySets,
  explorationPathSets: ExplorationPathSummarySets,
  approvalFailureSets: AutomaticApprovalReviewFailureSets,
): void {
  switch (fact.type) {
    case "exploration":
      applyAutomaticApprovalFailuresToStats(fact.automaticApprovalReviewFailures, stats, approvalFailureSets);
      for (const path of fact.readPaths) explorationPathSets.readPaths.add(path);
      for (const path of fact.runningReadPaths) explorationPathSets.runningReadPaths.add(path);
      for (const path of fact.loadedToolPaths) explorationPathSets.loadedToolPaths.add(path);
      for (const path of fact.runningLoadedToolPaths) explorationPathSets.runningLoadedToolPaths.add(path);
      stats.searchCount += fact.searchCount;
      stats.runningSearchCount += fact.runningSearchCount;
      stats.listCount += fact.listCount;
      stats.runningListCount += fact.runningListCount;
      return;
    case "patch":
      applyAutomaticApprovalFailuresToStats(fact.automaticApprovalReviewFailures, stats, approvalFailureSets);
      for (const path of fact.createdPaths) fileChangePathSets.createdPaths.add(path);
      for (const path of fact.runningCreatedPaths) fileChangePathSets.runningCreatedPaths.add(path);
      for (const path of fact.stoppedCreatedPaths) fileChangePathSets.stoppedCreatedPaths.add(path);
      stats.runningCreatedLineCount += fact.runningCreatedLineCount;
      stats.changedLineCount += fact.changedLineCount;
      for (const path of fact.editedPaths) fileChangePathSets.editedPaths.add(path);
      for (const path of fact.runningEditedPaths) fileChangePathSets.runningEditedPaths.add(path);
      for (const path of fact.deletedPaths) fileChangePathSets.deletedPaths.add(path);
      for (const path of fact.runningDeletedPaths) fileChangePathSets.runningDeletedPaths.add(path);
      return;
    case "exec":
      applyAutomaticApprovalFailuresToStats(fact.automaticApprovalReviewFailures, stats, approvalFailureSets);
      stats.commandCount += 1;
      if (fact.isInProgress) {
        stats.runningCommandCount += 1;
        if (fact.createsFolder === true) stats.runningFolderCreationCommandCount += 1;
        if (fact.searchesWeb === true) stats.runningWebSearchCommandCount += 1;
        return;
      }
      if (fact.searchesWeb === true) stats.completedWebSearchCommandCount += 1;
      return;
    case "automaticApprovalReview":
      applyAutomaticApprovalFailuresToStats([fact], stats, approvalFailureSets);
      return;
    case "mcpToolCall":
      applyAutomaticApprovalFailuresToStats(fact.automaticApprovalReviewFailures, stats, approvalFailureSets);
      stats.mcpToolCallCount += 1;
      if (fact.isInProgress) stats.runningMcpToolCallCount += 1;
      if (fact.source) incrementMcpSource(stats, fact.source, fact.isInProgress);
      return;
    case "webSearch":
      stats.webSearchCount += fact.count;
      stats.runningWebSearchCount += fact.runningCount;
      return;
    case "other":
      return;
  }
}

export function collectCollapsedToolActivitySummaryStats(
  entries: ThreadCollapsedToolActivityEntryModel[],
): ThreadCollapsedToolActivitySummaryStats {
  const stats = emptyCollapsedToolActivitySummaryStats();
  const fileChangePathSets = emptyFileChangePathSummarySets();
  const explorationPathSets = emptyExplorationPathSummarySets();
  const approvalFailureSets = emptyAutomaticApprovalReviewFailureSets();

  for (const entry of entries) {
    applyCollapsedToolActivitySummaryFact(
      buildCollapsedToolActivitySummaryFact(entry),
      stats,
      fileChangePathSets,
      explorationPathSets,
      approvalFailureSets,
    );
  }

  applyFileChangePathSummarySets(stats, fileChangePathSets);
  applyExplorationPathSummarySets(stats, explorationPathSets);
  return stats;
}

function buildCollapsedActivityGroup(
  entries: ThreadCollapsedToolActivityEntryModel[],
  seed: ThreadCollapsedToolActivityEntryModel,
): ThreadCollapsedToolActivityBlockModel | null {
  const summaryStats = collectCollapsedToolActivitySummaryStats(entries);
  const summaryResult = buildCollapsedToolActivitySummary(summaryStats);
  if (!summaryResult) return null;
  const summaryCues = resolveCollapsedToolActivitySummaryCues(entries);

  return {
    id: `${seed.id}::collapsed-tool-activity`,
    turnId: seed.turnId,
    createdAt: entries[0]?.createdAt ?? seed.createdAt,
    updatedAt: Math.max(...entries.map((entry) => entry.updatedAt)),
    searchableText: buildSearchableTextFromActivityEntries(entries),
    type: "collapsedToolActivity",
    entries,
    summary: summaryResult.summary,
    summaryStats,
    summaryParts: summaryResult.parts,
    runningSummary: summaryCues.runningSummary,
    continuitySummary: summaryCues.continuitySummary,
    status: mergeActivityStatus(entries),
  };
}

function shouldCollapseSingleActivityEntry(entry: ThreadCollapsedToolActivityEntryModel): boolean {
  return entry.type !== "exec" && entry.type !== "mcpToolCall";
}

function isPendingMcpToolCallBlock(block: McpToolCallBlock): boolean {
  return block.status === "inProgress" && block.entry.mcpToolCall?.completed !== true;
}

function getPendingMcpToolCallBlock(unit: ThreadAgentRenderUnit): McpToolCallBlock | null {
  if (unit.kind !== "entry") return null;
  if (!isMcpToolCallBlock(unit.block)) return null;
  const block = unit.block;
  if (isPendingMcpToolCallExcludedFromGrouping(block)) return null;
  return block;
}

function isPendingMcpToolCallExcludedFromGrouping(block: McpToolCallBlock): boolean {
  const toolCall = block.entry.mcpToolCall;
  if (!toolCall) return true;
  if (toolCall.invocation.server === "computer-use") return true;
  if (toolCall.mcpAppResourceUri != null) return true;
  return false;
}

function resolvePendingMcpToolCallGroupKey(block: McpToolCallBlock): string | null {
  const source = resolveMcpToolCallSummarySource(block.entry);
  if (source) return source.key;
  const sourceName = getMcpSourceName(block.entry);
  return sourceName ? `server:${sourceName}` : null;
}

function getAutomaticApprovalReviewTargetItemId(entry: CodexConversationItem): string | null {
  const raw = typeof entry.rawItem === "object" && entry.rawItem !== null
    ? entry.rawItem as { targetItemId?: unknown }
    : null;
  return typeof raw?.targetItemId === "string" && raw.targetItemId.length > 0 ? raw.targetItemId : null;
}

function collectAutomaticApprovalTargetKeys(entry: ThreadTranscriptBlockModel): string[] {
  if (entry.type !== "exec" && entry.type !== "fileChange" && entry.type !== "mcpToolCall") return [];

  const keys = entry.type === "exec"
    ? [
        getRawString(entry.entry.rawItem, ["commandExecutionItemId", "callId", "call_id"]),
        resolveConversationItemKeyId(entry.entry),
        entry.entry.itemId,
        entry.entry.entryId,
      ]
    : entry.type === "mcpToolCall"
      ? [
          entry.entry.mcpToolCall?.callId ?? null,
          getRawString(entry.entry.rawItem, ["callId", "call_id", "id"]),
          entry.entry.itemId,
          entry.entry.entryId,
        ]
      : [
          getRawString(entry.entry.rawItem, ["callId", "call_id", "id"]),
          resolveConversationItemKeyId(entry.entry),
          entry.entry.itemId,
          entry.entry.entryId,
        ];

  return Array.from(new Set(keys.filter((key): key is string => typeof key === "string" && key.length > 0)));
}

function attachAutomaticApprovalReviewsToToolTargets(
  entries: ThreadAgentEntryModel[],
): ThreadAgentEntryModel[] {
  const targetKeys = new Set<string>();
  for (const entry of entries) {
    if (!isTranscriptBlock(entry)) continue;
    for (const key of collectAutomaticApprovalTargetKeys(entry)) targetKeys.add(key);
  }
  if (targetKeys.size === 0) return entries;

  const reviewsByTarget = new Map<string, CodexConversationItem[]>();
  const consumedReviewIds = new Set<string>();
  for (const entry of entries) {
    if (!isTranscriptBlock(entry) || entry.type !== "automaticApprovalReview") continue;
    const targetItemId = getAutomaticApprovalReviewTargetItemId(entry.entry);
    if (!targetItemId || !targetKeys.has(targetItemId)) continue;
    const reviews = reviewsByTarget.get(targetItemId) ?? [];
    reviews.push(entry.entry);
    reviewsByTarget.set(targetItemId, reviews);
    consumedReviewIds.add(entry.id);
  }

  if (consumedReviewIds.size === 0) return entries;

  const attachedEntries: ThreadAgentEntryModel[] = [];
  for (const entry of entries) {
    if (consumedReviewIds.has(entry.id)) continue;
    if (!isTranscriptBlock(entry)) {
      attachedEntries.push(entry);
      continue;
    }
    const reviews = collectAutomaticApprovalTargetKeys(entry).flatMap((key) => reviewsByTarget.get(key) ?? []);
    if (reviews.length === 0) {
      attachedEntries.push(entry);
      continue;
    }
    attachedEntries.push({
      ...entry,
      automaticApprovalReviews: [
        ...(entry.automaticApprovalReviews ?? []),
        ...reviews,
      ],
    });
  }

  return attachedEntries;
}

export function buildPreGroupedAgentRenderUnits(agentBlocks: ThreadAgentItemModel[]): ThreadAgentRenderUnit[] {
  if (agentBlocks.length === 0) return [];

  const grouped: ThreadAgentRenderUnit[] = [];
  let index = 0;

  while (index < agentBlocks.length) {
    const current = agentBlocks[index];
    if (!current) break;

    if (current.type === "workedFor") {
      grouped.push(buildRenderEntryUnit(current));
      index += 1;
      continue;
    }

    if (current.type === "webSearch") {
      const entries: WebSearchBlock[] = [current as WebSearchBlock];
      let cursor = index + 1;
      while (cursor < agentBlocks.length) {
        const candidate = agentBlocks[cursor];
        if (!candidate || candidate.type !== "webSearch") break;
        entries.push(candidate as WebSearchBlock);
        cursor += 1;
      }
      grouped.push(buildRenderEntryUnit(buildWebSearchGroup(entries, current as WebSearchBlock)));
      index = cursor;
      continue;
    }

    const currentMultiAgent = resolveMultiAgentBlockAction(current);
    if (currentMultiAgent) {
      const entries = [currentMultiAgent.block.entry];
      let cursor = index + 1;
      while (cursor < agentBlocks.length) {
        const candidate = resolveMultiAgentBlockAction(agentBlocks[cursor]);
        if (!candidate || candidate.action !== currentMultiAgent.action) break;
        entries.push(candidate.block.entry);
        cursor += 1;
      }
      grouped.push(buildRenderEntryUnit(buildMultiAgentGroup(entries, currentMultiAgent.block)));
      index = cursor;
      continue;
    }

    if (isSubagentActivityInlineGroupBlock(current)) {
      const entries: SubagentActivityBlock[] = [current];
      let cursor = index + 1;
      while (cursor < agentBlocks.length) {
        const candidate = agentBlocks[cursor];
        if (!isSubagentActivityInlineGroupBlock(candidate)) break;
        entries.push(candidate);
        cursor += 1;
      }
      grouped.push(buildRenderEntryUnit(buildSubagentActivityInlineGroup(entries, current)));
      index = cursor;
      continue;
    }

    grouped.push(buildRenderEntryUnit(current));
    index += 1;
  }

  return grouped;
}

function groupExplorationEntries(agentEntries: ThreadAgentEntryModel[]): ThreadAgentEntryModel[] {
  if (agentEntries.length === 0) return agentEntries;

  const grouped: ThreadAgentEntryModel[] = [];
  let index = 0;

  while (index < agentEntries.length) {
    const current = agentEntries[index];
    if (!current) break;

    if (current.type === "workedFor") {
      grouped.push(current);
      index += 1;
      continue;
    }

    if (!isTranscriptBlock(current) || !isExplorationCommandBlock(current)) {
      grouped.push(current);
      index += 1;
      continue;
    }

    const entries: ThreadTranscriptBlockModel[] = [current];
    let cursor = index + 1;
    while (cursor < agentEntries.length) {
      const candidate = agentEntries[cursor];
      if (!candidate) break;
      if (isTranscriptBlock(candidate) && (isExplorationCommandBlock(candidate) || candidate.type === "reasoning")) {
        entries.push(candidate);
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

function groupPendingMcpToolCallUnits(
  units: ThreadAgentRenderUnit[],
  options: BuildAgentRenderUnitsOptions = {},
): ThreadAgentRenderUnit[] {
  if (units.length === 0) return units;

  const grouped: ThreadAgentRenderUnit[] = [];
  let index = 0;

  while (index < units.length) {
    const currentUnit = units[index];
    if (!currentUnit) break;

    const current = getPendingMcpToolCallBlock(currentUnit);
    if (!current) {
      grouped.push(currentUnit);
      index += 1;
      continue;
    }

    const entries: McpToolCallBlock[] = [];
    let groupKey: string | null = null;
    let cursor = index;

    while (cursor < units.length) {
      const candidate = units[cursor] ? getPendingMcpToolCallBlock(units[cursor]) : null;
      if (!candidate) break;

      const candidateKey = resolvePendingMcpToolCallGroupKey(candidate);
      if (!candidateKey) break;
      if (groupKey !== null && candidateKey !== groupKey) break;

      groupKey = candidateKey;
      entries.push(candidate);
      cursor += 1;
    }

    if (entries.length > 1 || (options.keepLatestLiveActivityInGroup === true && entries.length > 0 && cursor === units.length)) {
      grouped.push(buildRenderEntryUnit(buildPendingMcpToolCallsGroup(entries, current)));
      index = cursor;
      continue;
    }

    grouped.push(currentUnit);
    index += 1;
  }

  return grouped;
}

export function buildAgentRenderUnits(
  agentBlocks: ThreadAgentItemModel[],
  options: BuildAgentRenderUnitsOptions = {},
): ThreadAgentRenderUnit[] {
  if (agentBlocks.length === 0) return [];

  const preGroupedUnits = buildPreGroupedAgentRenderUnits(agentBlocks);
  const preGroupedEntries = materializeAgentRenderUnits(preGroupedUnits);
  const entriesWithReviewAttachments = attachAutomaticApprovalReviewsToToolTargets(preGroupedEntries);
  const groupedWithReviewAttachments = groupExplorationEntries(entriesWithReviewAttachments);
  const collapsed: ThreadAgentEntryModel[] = [];
  let collapsedIndex = 0;
  const keepMcpToolCallsOpen = options.keepLatestLiveActivityInGroup === true;
  while (collapsedIndex < groupedWithReviewAttachments.length) {
    const current = groupedWithReviewAttachments[collapsedIndex];
    if (!current) break;
    if (!isCollapsedActivityEntry(current, { keepMcpToolCallsOpen })) {
      collapsed.push(current);
      collapsedIndex += 1;
      continue;
    }

    const entries = [current];
    let cursor = collapsedIndex + 1;
    while (cursor < groupedWithReviewAttachments.length) {
      const candidate = groupedWithReviewAttachments[cursor];
      if (!candidate || !isCollapsedActivityEntry(candidate, { keepMcpToolCallsOpen })) break;
      entries.push(candidate);
      cursor += 1;
    }

    if (entries.length === 1 && !shouldCollapseSingleActivityEntry(current)) {
      collapsed.push(current);
    } else {
      const collapsedGroup = buildCollapsedActivityGroup(entries, current);
      if (collapsedGroup) {
        collapsed.push(collapsedGroup);
      } else {
        collapsed.push(...entries);
      }
    }
    collapsedIndex = cursor;
  }

  const dynamicUnits = groupDynamicToolRuns(collapsed, options).map(buildRenderEntryUnit);
  return withRenderKeys(groupPendingMcpToolCallUnits(dynamicUnits, options));
}

function groupDynamicToolRuns(
  entries: ThreadAgentEntryModel[],
  options: BuildAgentRenderUnitsOptions = {},
): ThreadAgentEntryModel[] {
  const grouped: ThreadAgentEntryModel[] = [];
  let index = 0;

  while (index < entries.length) {
    const current = entries[index];
    if (!isDynamicToolCallBlock(current)) {
      if (current) grouped.push(current);
      index += 1;
      continue;
    }

    const dynamicEntries: DynamicToolCallBlock[] = [];
    let cursor = index;
    while (cursor < entries.length) {
      const candidate = entries[cursor];
      if (!isDynamicToolCallBlock(candidate)) break;
      if (isDynamicToolStandaloneInConversation(candidate.entry.dynamicToolCall)) {
        if (dynamicEntries.length > 0) break;
        dynamicEntries.push(candidate);
        cursor += 1;
        break;
      }
      dynamicEntries.push(candidate);
      cursor += 1;
    }

    const shouldGroupLatestLiveDynamic =
      options.keepLatestLiveActivityInGroup === true
      && cursor === entries.length
      && continuesCodexAppLiveActivityBetweenCalls(dynamicEntries[dynamicEntries.length - 1]?.entry.dynamicToolCall);

    if (dynamicEntries.length > 1 || shouldGroupLatestLiveDynamic) {
      grouped.push(buildDynamicToolCallGroup(dynamicEntries, current));
      index = cursor;
      continue;
    }

    grouped.push(current);
    index = cursor;
  }

  return grouped;
}
