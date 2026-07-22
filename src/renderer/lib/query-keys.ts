import type { ProtocolMcpResourceReadParams } from "../../shared/types";
import type {
  WorkspaceDirectoryEntriesInput,
  WorkspaceFileMetadataInput,
  WorkspaceFileRequest,
} from "./types";

function normalizeHostId(hostId: string | undefined): string {
  return hostId ?? "local";
}

function normalizeNullable(value: string | null | undefined): string {
  return value ?? "";
}

export const queryKeys = {
  projects: {
    all: () => ["projects"] as const,
    list: () => ["projects", "list"] as const,
  },
  boards: {
    all: () => ["boards"] as const,
    byProject: (projectId: string) => ["boards", "byProject", projectId] as const,
  },
  blockDocuments: {
    all: () => ["blockDocuments"] as const,
    owned: (projectId: string, ownerBlockId: string) =>
      ["blockDocuments", "owned", projectId, ownerBlockId] as const,
  },
  pageTargets: {
    byId: (requestingProjectId: string, targetBlockId: string) => [
      "pageTargets",
      requestingProjectId,
      targetBlockId,
    ] as const,
  },
  pageOwnershipPaths: {
    all: () => ["pageOwnershipPaths"] as const,
    byProject: (requestingProjectId: string) => [
      "pageOwnershipPaths",
      requestingProjectId,
    ] as const,
    byPage: (requestingProjectId: string, targetPageId: string) => [
      "pageOwnershipPaths",
      requestingProjectId,
      targetPageId,
    ] as const,
  },
  blockReferences: {
    databaseView: (
      requestingProjectId: string,
      databaseViewId: string,
      hostBlockId?: string,
    ) => [
      "blockReferences",
      "databaseView",
      requestingProjectId,
      databaseViewId,
      normalizeNullable(hostBlockId),
    ] as const,
  },
  libraryDatabases: {
    all: () => ["libraryDatabases"] as const,
    descriptor: (
      accessProjectId: string | undefined,
      databaseId: string | null,
      viewId: string | null,
    ) => [
      "libraryDatabases",
      "descriptor",
      normalizeNullable(accessProjectId),
      normalizeNullable(databaseId),
      normalizeNullable(viewId),
    ] as const,
    view: (accessProjectId: string | undefined, viewId: string | null) => [
      "libraryDatabases",
      "view",
      normalizeNullable(accessProjectId),
      normalizeNullable(viewId),
    ] as const,
  },
  library: {
    all: () => ["libraryNavigation"] as const,
    metadata: () => ["libraryNavigation", "metadata"] as const,
    children: (parentKey: string, input: unknown) => [
      "libraryNavigation",
      "children",
      parentKey,
      input,
    ] as const,
    childrenPages: (parentKey: string, input: unknown) => [
      "libraryNavigation",
      "childrenPages",
      parentKey,
      input,
    ] as const,
    catalog: (input: unknown) => ["libraryNavigation", "catalog", input] as const,
    catalogPages: (input: unknown) => [
      "libraryNavigation",
      "catalogPages",
      input,
    ] as const,
    path: (target: unknown) => ["libraryNavigation", "path", target] as const,
    pageDetail: (pageId: string) => ["libraryPages", "detail", pageId] as const,
    pageDocument: (pageId: string) => ["libraryPages", "document", pageId] as const,
  },
  projectSessions: {
    all: () => ["projectSessions"] as const,
    summaries: (projectId: string | null) => ["projectSessions", "summaries", normalizeNullable(projectId)] as const,
    detail: (sessionId: string) => ["projectSessions", "detail", sessionId] as const,
  },
  settings: {
    all: () => ["settings"] as const,
    windowRestore: () => ["settings", "windowRestore"] as const,
    threadNotifications: () => ["settings", "threadNotifications"] as const,
    thirdPartyNotices: () => ["settings", "thirdPartyNotices"] as const,
    commandKeymap: () => ["codex-command-keymap-state"] as const,
  },
  git: {
    all: () => ["git"] as const,
    branchState: (cwd: string) => ["git", "branchState", cwd] as const,
  },
  localEnvironments: {
    all: () => ["localEnvironments"] as const,
    options: (projectId: string) => ["localEnvironments", "options", projectId] as const,
    configs: (projectId: string) => ["localEnvironments", "configs", projectId] as const,
    config: (projectId: string, configPath?: string | null) =>
      ["localEnvironments", "config", projectId, normalizeNullable(configPath)] as const,
  },
  mcp: {
    all: () => ["mcp"] as const,
    apps: () => ["mcp", "apps"] as const,
    statuses: () => ["mcp", "statuses"] as const,
    resource: (params: ProtocolMcpResourceReadParams) =>
      ["mcp", "resource", normalizeNullable(params.threadId), params.server, params.uri] as const,
  },
  codexSidebar: {
    all: () => ["codexSidebar"] as const,
    snapshot: () => ["codexSidebar", "snapshot"] as const,
    pinnedThreads: () => ["codexSidebar", "pinnedThreads"] as const,
  },
  codexModels: {
    all: () => ["codexModels"] as const,
    list: () => ["codexModels", "list"] as const,
  },
  agentProviderCatalog: {
    all: () => ["agentProviderCatalog"] as const,
    current: () => ["agentProviderCatalog", "current"] as const,
  },
  codexExperimentalFeatures: {
    all: () => ["codexExperimentalFeatures"] as const,
    list: () => ["codexExperimentalFeatures", "list"] as const,
  },
  codexHooks: {
    all: () => ["codexHooks"] as const,
    host: (hostId: string) => ["codexHooks", hostId] as const,
    list: (hostId: string, cwds: readonly string[]) => ["codexHooks", hostId, cwds] as const,
  },
  codexScheduledAutomations: {
    all: () => ["codexScheduledAutomations"] as const,
    list: () => ["codexScheduledAutomations", "list"] as const,
  },
  codexAutomationRuns: {
    all: () => ["codexAutomationRuns"] as const,
    inbox: (limit: number) => ["codexAutomationRuns", "inbox", limit] as const,
  },
  codexBackgroundTerminals: {
    all: () => ["codexBackgroundTerminals"] as const,
    processManager: (threads: readonly { threadId: string; title: string }[]) =>
      [
        "codexBackgroundTerminals",
        "processManager",
        ...threads.map((thread) => `${thread.threadId}\u0000${thread.title}`),
      ] as const,
  },
  workspaceFiles: {
    all: () => ["workspaceFiles"] as const,
    directory: (input: WorkspaceDirectoryEntriesInput) =>
      [
        "workspaceFiles",
        "directory",
        normalizeHostId(input.hostId),
        input.workspaceRoot,
        input.directoryPath ?? "",
        input.includeHidden ?? false,
        input.directoriesOnly ?? false,
      ] as const,
    metadata: (input: WorkspaceFileMetadataInput) =>
      [
        "workspaceFiles",
        "metadata",
        normalizeHostId(input.hostId),
        input.path,
        input.contentSampleByteLimit ?? 0,
        input.contentSampleMaxFileBytes ?? 0,
      ] as const,
    text: (input: WorkspaceFileRequest) =>
      ["workspaceFiles", "text", normalizeHostId(input.hostId), input.path] as const,
    binary: (input: WorkspaceFileRequest) =>
      ["workspaceFiles", "binary", normalizeHostId(input.hostId), input.path] as const,
  },
  codexConversationImageAssets: {
    resolve: (pointer: string) =>
      ["file", "image-src", pointer, "codex"] as const,
  },
};
