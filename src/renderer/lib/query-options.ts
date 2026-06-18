import { queryOptions } from "@tanstack/react-query";
import { invoke } from "./api";
import { queryKeys } from "./query-keys";
import type {
  BoardSummary,
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
} from "./types";
import type {
  GitBranchState,
  HistoryEntry,
  UndoRedoState,
} from "../../shared/ipc-api";
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

export function gitBranchStateQueryOptions(cwd: string) {
  return queryOptions({
    queryKey: queryKeys.git.branchState(cwd),
    queryFn: () => invoke("git:branch:state", cwd) as Promise<GitBranchState>,
    enabled: cwd.trim().length > 0,
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
