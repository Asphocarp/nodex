import { queryOptions } from "@tanstack/react-query";
import { invoke } from "./api";
import { queryKeys } from "./query-keys";
import type {
  BoardSummary,
  CodexScheduledAutomation,
  GitReviewBranchCommitsRequest,
  GitReviewBranchCommitsResult,
  GitReviewFileContents,
  GitReviewFileContentsInput,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewSummaryRequest,
  GitReviewSummaryResult,
  ProtocolMcpResourceReadResponse,
  ProtocolMcpServerStatus,
  Project,
  ThreadNotificationSettings,
  WindowRestoreSettings,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentSettingsSnapshot,
  WorkspaceDirectoryEntriesInput,
  WorkspaceDirectoryEntriesResult,
  WorkspaceFileBinaryReadResult,
  WorkspaceFileMetadata,
  WorkspaceFileReadInput,
  WorkspaceFileReadResult,
  WorkspaceFileRequest,
  ReviewDiffRequest,
  ReviewDiffResult,
} from "./types";
import type {
  GitBranchState,
  HistoryEntry,
  UndoRedoState,
} from "../../shared/ipc-api";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import type { ProtocolMcpResourceReadParams } from "../../shared/types";

export type HistoryRecentResult = UndoRedoState & { entries: HistoryEntry[] };

export function projectsListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.projects.list(),
    queryFn: () => invoke("projects:list") as Promise<Project[]>,
  });
}

export function boardByProjectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.boards.byProject(projectId),
    queryFn: () => invoke("board:summary:get", projectId) as Promise<BoardSummary>,
  });
}

export function historyRecentQueryOptions(projectId: string, sessionId?: string) {
  return queryOptions({
    queryKey: queryKeys.history.recent(projectId, sessionId),
    queryFn: () => invoke("history:recent", projectId, sessionId) as Promise<HistoryRecentResult>,
  });
}

export function windowRestoreSettingsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.settings.windowRestore(),
    queryFn: () => invoke("settings:window-restore:get") as Promise<WindowRestoreSettings>,
  });
}

export function threadNotificationSettingsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.settings.threadNotifications(),
    queryFn: () => invoke("settings:thread-notifications:get") as Promise<ThreadNotificationSettings>,
  });
}

export function commandKeymapStateQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.settings.commandKeymap(),
    queryFn: () => invoke("codex-command-keymap-state") as Promise<CommandKeymapState>,
    staleTime: 60_000,
  });
}

export function codexScheduledAutomationsListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.codexScheduledAutomations.list(),
    queryFn: () => invoke("codex:scheduled-automations:list") as Promise<CodexScheduledAutomation[]>,
    staleTime: 30_000,
  });
}

export function gitBranchStateQueryOptions(cwd: string) {
  return queryOptions({
    queryKey: queryKeys.git.branchState(cwd),
    queryFn: () => invoke("git:branch:state", cwd) as Promise<GitBranchState>,
    enabled: cwd.trim().length > 0,
  });
}

export function reviewSummaryQueryOptions(input: GitReviewSummaryRequest) {
  return queryOptions({
    queryKey: queryKeys.review.summary(input),
    queryFn: () => invoke("git:review:summary", input) as Promise<GitReviewSummaryResult>,
    enabled: input.cwd.trim().length > 0,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function reviewDiffQueryOptions(input: ReviewDiffRequest) {
  return queryOptions({
    queryKey: queryKeys.review.diff(input),
    queryFn: () => invoke("git:review:diff", input) as Promise<ReviewDiffResult>,
    enabled: input.cwd.trim().length > 0,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function reviewBranchCommitsQueryOptions(input: GitReviewBranchCommitsRequest) {
  return queryOptions({
    queryKey: queryKeys.review.branchCommits(input),
    queryFn: () => invoke("git:review:branch-commits", input) as Promise<GitReviewBranchCommitsResult>,
    enabled: input.cwd.trim().length > 0,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function reviewFileContentsQueryOptions(input: GitReviewFileContentsInput) {
  return queryOptions({
    queryKey: queryKeys.review.fileContents(input),
    queryFn: () => invoke("git:review:file-contents", input) as Promise<GitReviewFileContents>,
    enabled: input.cwd.trim().length > 0 && input.path.trim().length > 0,
  });
}

export function reviewSearchQueryOptions(input: GitReviewSearchInput) {
  return queryOptions({
    queryKey: queryKeys.review.search(input),
    queryFn: () => invoke("git:review:search", input) as Promise<GitReviewSearchResult>,
    enabled: input.cwd.trim().length > 0 && input.query.trim().length > 0,
  });
}

export function localEnvironmentConfigsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.localEnvironments.configs(projectId),
    queryFn: () => invoke("worktrees:environments:configs:list", projectId) as Promise<WorktreeEnvironmentConfigRecord[]>,
    enabled: projectId.trim().length > 0,
  });
}

export function localEnvironmentSnapshotQueryOptions(projectId: string, configPath?: string | null) {
  return queryOptions({
    queryKey: queryKeys.localEnvironments.config(projectId, configPath),
    queryFn: () => invoke("worktrees:environments:config:read", projectId, configPath) as Promise<WorktreeEnvironmentSettingsSnapshot>,
    enabled: projectId.trim().length > 0,
  });
}

export function mcpServerStatusesQueryOptions(threadId?: string | null) {
  return queryOptions({
    queryKey: queryKeys.mcp.statuses(threadId),
    queryFn: () => invoke("codex:mcp-server-statuses:list", threadId ?? null) as Promise<ProtocolMcpServerStatus[]>,
  });
}

export function mcpResourceQueryOptions(params: ProtocolMcpResourceReadParams) {
  return queryOptions({
    queryKey: queryKeys.mcp.resource(params),
    queryFn: () => invoke("codex:mcp-resource:read", params) as Promise<ProtocolMcpResourceReadResponse>,
    enabled: params.server.trim().length > 0 && params.uri.trim().length > 0,
  });
}

export function workspaceDirectoryQueryOptions(input: WorkspaceDirectoryEntriesInput) {
  return queryOptions({
    queryKey: queryKeys.workspaceFiles.directory(input),
    queryFn: () => invoke("workspace-directory-entries", input) as Promise<WorkspaceDirectoryEntriesResult>,
  });
}

export function workspaceFileMetadataQueryOptions(input: WorkspaceFileRequest) {
  return queryOptions({
    queryKey: queryKeys.workspaceFiles.metadata(input),
    queryFn: () => invoke("read-file-metadata", input) as Promise<WorkspaceFileMetadata>,
  });
}

export function workspaceFileTextQueryOptions(input: WorkspaceFileReadInput) {
  return queryOptions({
    queryKey: queryKeys.workspaceFiles.text(input),
    queryFn: () => invoke("read-file", input) as Promise<WorkspaceFileReadResult>,
  });
}

export function workspaceFileBinaryQueryOptions(input: WorkspaceFileRequest) {
  return queryOptions({
    queryKey: queryKeys.workspaceFiles.binary(input),
    queryFn: () => invoke("read-file-binary", input) as Promise<WorkspaceFileBinaryReadResult>,
  });
}
