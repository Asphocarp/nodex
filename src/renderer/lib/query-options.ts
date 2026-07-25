import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { invoke } from "./api";
import { queryKeys } from "./query-keys";
import type {
  CodexAutomationRunsInboxResponse,
  CodexModelOption,
  CodexScheduledAutomationListResponse,
  ProtocolMcpResourceReadResponse,
  ProtocolAppInfo,
  ProtocolExperimentalFeature,
  ProtocolListMcpServerStatusResponse,
  ProjectListOptions,
  ProjectWindow,
  ProjectSession,
  ProjectSessionSummaryWindow,
  ThreadNotificationSettings,
  WindowRestoreSettings,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentOption,
  WorktreeEnvironmentSettingsSnapshot,
  WorkspaceDirectoryEntriesInput,
  WorkspaceDirectoryEntriesResult,
  WorkspaceFileBinaryReadResult,
  WorkspaceFileMetadata,
  WorkspaceFileMetadataInput,
  WorkspaceFileReadResult,
  WorkspaceFileRequest,
  WorkspaceFileTextReadInput,
} from "./types";
import type { DatabaseViewWindowSnapshot } from "../../shared/database-views";
import type { GitBranchState } from "../../shared/ipc-api";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import type { ProtocolMcpResourceReadParams } from "../../shared/types";
import type { CodexHooksListInput, CodexHooksListResponse } from "../../shared/codex-hooks";
import type { AgentProviderCatalog } from "../../shared/agent-runtime";

const MCP_CATALOG_STALE_TIME_MS = 5 * 60_000;

export function projectsListQueryOptions(options: ProjectListOptions = {}) {
  const includeArchived = options.includeArchived === true;
  return infiniteQueryOptions({
    queryKey: queryKeys.projects.list(includeArchived),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ProjectWindow> =>
      await invoke("projects:list", {
        includeArchived,
        after: pageParam,
        first: 100,
      }) as ProjectWindow,
    getNextPageParam: (window) => window.nextCursor ?? undefined,
  });
}

export function boardByProjectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.boards.byProject(projectId),
    queryFn: () =>
      invoke(
        "database:view-window:get",
        projectId,
        { first: 50 },
      ) as Promise<DatabaseViewWindowSnapshot>,
  });
}

export function projectSessionSummariesQueryOptions(projectId: string | null) {
  return queryOptions({
    queryKey: queryKeys.projectSessions.summaries(projectId),
    queryFn: async (): Promise<ProjectSessionSummaryWindow> =>
      await invoke("workspace:tasks:list", projectId, {
        first: 50,
      }) as ProjectSessionSummaryWindow,
    staleTime: 30_000,
  });
}

export function projectSessionDetailQueryOptions(sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.projectSessions.detail(sessionId),
    queryFn: () => invoke("project-sessions:get", sessionId) as Promise<ProjectSession | null>,
    staleTime: 30_000,
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
    queryFn: async () => {
      const response = await invoke("codex:scheduled-automations:list") as CodexScheduledAutomationListResponse;
      return response.items;
    },
    staleTime: 30_000,
  });
}

export function codexAutomationRunsInboxQueryOptions(limit = 200) {
  return queryOptions({
    queryKey: queryKeys.codexAutomationRuns.inbox(limit),
    queryFn: () => invoke("codex:automation-runs:inbox-items", limit) as Promise<CodexAutomationRunsInboxResponse>,
    staleTime: 30_000,
  });
}

export function codexModelsListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.codexModels.list(),
    queryFn: () => invoke("codex:model:list") as Promise<CodexModelOption[]>,
    staleTime: 60_000,
  });
}

export function agentProviderCatalogQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.agentProviderCatalog.current(),
    queryFn: () => invoke("agent-runtime:catalog:get") as Promise<AgentProviderCatalog>,
    staleTime: 5 * 60_000,
  });
}

export function codexExperimentalFeaturesListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.codexExperimentalFeatures.list(),
    queryFn: async () => {
      try {
        return await invoke("codex:experimental-features:list") as ProtocolExperimentalFeature[];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });
}

export function codexHooksListQueryOptions(input: CodexHooksListInput) {
  const { hostId, cwds } = input;
  return queryOptions({
    queryKey: queryKeys.codexHooks.list(hostId, cwds),
    queryFn: () => invoke("codex:hooks:list", { hostId, cwds }) as Promise<CodexHooksListResponse>,
    enabled: hostId.trim().length > 0 && cwds.length > 0,
    refetchOnWindowFocus: true,
    staleTime: 5 * 60_000,
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

export function localEnvironmentOptionsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.localEnvironments.options(projectId),
    queryFn: () => invoke("worktrees:environments:list", projectId) as Promise<WorktreeEnvironmentOption[]>,
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

export function mcpServerStatusesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.mcp.statuses(),
    queryFn: () => invoke("codex:mcp-server-statuses:list") as Promise<ProtocolListMcpServerStatusResponse>,
    staleTime: MCP_CATALOG_STALE_TIME_MS,
  });
}

export function mcpAppsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.mcp.apps(),
    queryFn: () => invoke("codex:mcp-apps:list") as Promise<ProtocolAppInfo[]>,
    retry: false,
    staleTime: MCP_CATALOG_STALE_TIME_MS,
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

export function workspaceFileMetadataQueryOptions(input: WorkspaceFileMetadataInput) {
  return queryOptions({
    queryKey: queryKeys.workspaceFiles.metadata(input),
    queryFn: () => invoke("read-file-metadata", input) as Promise<WorkspaceFileMetadata>,
  });
}

export function workspaceFileTextQueryOptions(input: WorkspaceFileTextReadInput) {
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
