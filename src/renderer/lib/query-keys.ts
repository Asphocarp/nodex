import type { ProtocolMcpResourceReadParams } from "../../shared/types";
import type {
  GitReviewBranchCommitsRequest,
  GitReviewFileContentsInput,
  GitReviewSearchInput,
  GitReviewSummaryRequest,
  ReviewDiffRequest,
  WorkspaceDirectoryEntriesInput,
  WorkspaceFileReadInput,
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
  history: {
    all: () => ["history"] as const,
    recent: (projectId: string, sessionId?: string) =>
      ["history", "recent", projectId, sessionId ?? ""] as const,
  },
  settings: {
    all: () => ["settings"] as const,
    windowRestore: () => ["settings", "windowRestore"] as const,
    threadNotifications: () => ["settings", "threadNotifications"] as const,
    commandKeymap: () => ["codex-command-keymap-state"] as const,
  },
  git: {
    all: () => ["git"] as const,
    branchState: (cwd: string) => ["git", "branchState", cwd] as const,
  },
  review: {
    all: () => ["review"] as const,
    summary: (input: GitReviewSummaryRequest) => [
      "review",
      "summary",
      input.cwd,
      input.source,
      normalizeNullable(input.baseBranch ?? input.baseRef),
      normalizeNullable(input.commitSha),
      input.hideWhitespace === true,
    ] as const,
    diff: (input: ReviewDiffRequest) => [
      "review",
      "diff",
      input.cwd,
      input.source,
      normalizeNullable(input.baseBranch ?? input.baseRef),
      normalizeNullable(input.commitSha),
      input.hideWhitespace === true,
      ...(input.files ?? []),
    ] as const,
    branchCommits: (input: GitReviewBranchCommitsRequest) => [
      "review",
      "branchCommits",
      input.cwd,
      normalizeNullable(input.baseBranch),
    ] as const,
    fileContents: (input: GitReviewFileContentsInput) => [
      "review",
      "fileContents",
      input.cwd,
      input.source,
      input.path,
      normalizeNullable(input.previousPath),
      normalizeNullable(input.baseRef),
      normalizeNullable(input.commitSha),
    ] as const,
    search: (input: GitReviewSearchInput) => [
      "review",
      "search",
      input.cwd,
      input.source,
      input.query,
      normalizeNullable(input.baseBranch ?? input.baseRef),
      normalizeNullable(input.commitSha),
      input.hideWhitespace === true,
      input.limit ?? 0,
    ] as const,
  },
  localEnvironments: {
    all: () => ["localEnvironments"] as const,
    configs: (projectId: string) => ["localEnvironments", "configs", projectId] as const,
    config: (projectId: string, configPath?: string | null) =>
      ["localEnvironments", "config", projectId, normalizeNullable(configPath)] as const,
  },
  mcp: {
    all: () => ["mcp"] as const,
    statuses: (threadId?: string | null) => ["mcp", "statuses", normalizeNullable(threadId)] as const,
    resource: (params: ProtocolMcpResourceReadParams) =>
      ["mcp", "resource", normalizeNullable(params.threadId), params.server, params.uri] as const,
  },
  codexSidebar: {
    all: () => ["codexSidebar"] as const,
    snapshot: () => ["codexSidebar", "snapshot"] as const,
    pinnedThreads: () => ["codexSidebar", "pinnedThreads"] as const,
  },
  codexScheduledAutomations: {
    all: () => ["codexScheduledAutomations"] as const,
    list: () => ["codexScheduledAutomations", "list"] as const,
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
      ["workspaceFiles", "directory", normalizeHostId(input.hostId), input.workspaceRoot, input.path] as const,
    metadata: (input: WorkspaceFileRequest) =>
      ["workspaceFiles", "metadata", normalizeHostId(input.hostId), input.workspaceRoot, input.path] as const,
    text: (input: WorkspaceFileReadInput) =>
      ["workspaceFiles", "text", normalizeHostId(input.hostId), input.workspaceRoot, input.path, input.maxBytes ?? 0] as const,
    binary: (input: WorkspaceFileRequest) =>
      ["workspaceFiles", "binary", normalizeHostId(input.hostId), input.workspaceRoot, input.path] as const,
  },
};
