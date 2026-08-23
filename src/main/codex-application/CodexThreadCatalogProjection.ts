import path from "node:path";
import type { ThreadSource } from "@nodex/codex-app-server-protocol/v2/ThreadSource";
import type {
  CodexThreadActiveFlag,
  CodexThreadRuntimeStatus,
  CodexThreadSummary,
  CodexThreadStatusType,
  Project,
} from "../../shared/types";
import { normalizeCodexManualThreadTitle } from "../../shared/codex-thread-title";
import { MAX_PROJECT_SESSION_TITLE_LENGTH } from "../../shared/schemas/project-sessions";
import type { DesktopProjectWorkspaceThread } from "../core-client/project-workspace-adapter";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CodexThreadStatusSchema } from "../../shared/schemas/codex";
import { hasCodexSubagentSource } from "../../shared/codex-subagent-metadata";

export interface ParsedThreadStatus {
  readonly statusType: CodexThreadStatusType;
  readonly statusActiveFlags: CodexThreadActiveFlag[];
  readonly threadRuntimeStatus: CodexThreadRuntimeStatus;
}

const normalizeSidebarPath = (
  value: string | null | undefined,
  foldPathCase: boolean,
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const resolved = path.resolve(trimmed);
    return foldPathCase ? resolved.toLowerCase() : resolved;
  } catch {
    return null;
  }
};

const isSameOrDescendantPath = (candidatePath: string, rootPath: string): boolean => {
  if (candidatePath === rootPath) return true;
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const resolveSidebarProjectIdForCwd = (
  cwd: string | null | undefined,
  projects: readonly Project[],
  foldPathCase: boolean,
): string | null => {
  const normalizedCwd = normalizeSidebarPath(cwd, foldPathCase);
  if (!normalizedCwd) return null;

  let best: { projectId: string; sourcePath: string } | null = null;
  for (const project of projects) {
    for (const source of project.sources) {
      const sourcePath = normalizeSidebarPath(source.root, foldPathCase);
      if (!sourcePath || !isSameOrDescendantPath(normalizedCwd, sourcePath)) continue;
      if (!best || sourcePath.length > best.sourcePath.length) {
        best = { projectId: project.id, sourcePath };
      }
    }
  }

  return best?.projectId ?? null;
};

export const resolveSidebarThreadTitle = (thread: {
  readonly threadName?: string | null;
  readonly threadPreview?: string | null;
}): string => {
  const title = thread.threadName?.trim() || thread.threadPreview?.trim();
  return title || "New thread";
};

export const normalizeSidebarSessionFallbackTitle = (thread: {
  readonly threadName?: string | null;
  readonly threadPreview?: string | null;
}): string =>
  normalizeCodexManualThreadTitle(
    resolveSidebarThreadTitle(thread),
    MAX_PROJECT_SESSION_TITLE_LENGTH,
  ) ?? "New thread";

const buildThreadRuntimeStatus = (
  statusType: CodexThreadStatusType,
  statusActiveFlags: CodexThreadActiveFlag[],
): CodexThreadRuntimeStatus =>
  statusType === "active"
    ? { type: "active", activeFlags: [...statusActiveFlags] }
    : { type: statusType };

export const parseThreadStatus = (status: unknown): ParsedThreadStatus => {
  const parsed = CodexThreadStatusSchema.safeParse(status);
  if (!parsed.success) {
    return {
      statusType: "notLoaded",
      statusActiveFlags: [],
      threadRuntimeStatus: buildThreadRuntimeStatus("notLoaded", []),
    };
  }
  const statusType = parsed.data.type;
  const activeFlags = statusType === "active" ? parsed.data.activeFlags : [];
  return {
    statusType,
    statusActiveFlags: activeFlags,
    threadRuntimeStatus: parsed.data,
  };
};

export const parseThreadSourceValue = (value: unknown): ThreadSource | null =>
  typeof value === "string" && value.trim().length > 0 ? (value as ThreadSource) : null;

export const isInternalThreadSourceValue = (threadSource: ThreadSource | null): boolean =>
  threadSource === "system" || threadSource === "subagent";

export const isNonSidebarThreadWithoutParent = (thread: Record<string, unknown>): boolean => {
  const threadSource = parseThreadSourceValue(thread.threadSource);
  return isInternalThreadSourceValue(threadSource) || hasCodexSubagentSource(thread.source);
};

export const buildWorkspaceThreadSummary = (
  thread: DesktopProjectWorkspaceThread,
  overrides: {
    readonly archived?: boolean;
    readonly hasUnreadTurn?: boolean;
    readonly pinnedOrder?: number | null;
  } = {},
): CodexThreadSummary => {
  const pinnedOrder =
    overrides.pinnedOrder === undefined ? thread.pinnedOrder : overrides.pinnedOrder;
  return {
    threadId: thread.threadId,
    projectId: thread.projectId,
    forkedFromId: thread.forkedFromId,
    source: thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : null,
    ephemeral: false,
    threadSource: thread.threadSource,
    serviceName: thread.serviceName,
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    agentPath: thread.agentPath,
    threadName: thread.threadName,
    threadPreview: thread.threadPreview,
    modelProvider: thread.modelProvider,
    executionProfile: thread.executionProfile,
    cwd: thread.cwd,
    managedWorktreePath: thread.managedWorktreePath,
    projectlessOutputDirectory: thread.projectlessOutputDirectory,
    projectlessWorkspaceBrowserRoot: thread.projectlessWorkspaceBrowserRoot,
    statusType: thread.statusType,
    statusActiveFlags: [...thread.statusActiveFlags],
    archived: overrides.archived ?? thread.archived,
    pinned: pinnedOrder !== null,
    hasUnreadTurn: overrides.hasUnreadTurn ?? thread.hasUnreadTurn,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    recencyAt: thread.recencyAt,
    linkedAt: thread.linkedAt,
  };
};

type CoreWorkspaceThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "thread" }
>["thread"];

/** Direct Core projection used by final Effect application services. */
export const buildCoreWorkspaceThreadSummary = (
  thread: CoreWorkspaceThread,
): CodexThreadSummary => ({
  threadId: thread.thread_id,
  projectId: thread.project_id ?? null,
  forkedFromId: thread.forked_from_id ?? null,
  source: thread.parent_thread_id ? { parentThreadId: thread.parent_thread_id } : null,
  ephemeral: false,
  threadSource: thread.thread_source ?? null,
  serviceName: thread.service_name ?? null,
  agentNickname: thread.agent_nickname ?? null,
  agentRole: thread.agent_role ?? null,
  agentPath: thread.agent_path ?? null,
  threadName: thread.thread_name ?? null,
  threadPreview: thread.thread_preview,
  modelProvider: thread.model_provider,
  executionProfile: thread.model_id
    ? {
        providerId: thread.model_provider,
        modelId: thread.model_id,
        harnessId: thread.harness_id ?? null,
        reasoningEffort: thread.reasoning_effort ?? null,
        serviceTier: thread.service_tier ?? null,
      }
    : null,
  cwd: thread.cwd ?? null,
  managedWorktreePath: thread.managed_worktree_path ?? null,
  projectlessOutputDirectory: thread.projectless_output_directory ?? null,
  projectlessWorkspaceBrowserRoot: thread.projectless_workspace_browser_root ?? null,
  statusType: thread.status.status_type,
  statusActiveFlags: [...thread.status.active_flags],
  archived: thread.archived,
  pinned: thread.pinned_order !== null && thread.pinned_order !== undefined,
  hasUnreadTurn: thread.has_unread_turn,
  createdAt: thread.created_at,
  updatedAt: thread.updated_at,
  recencyAt: thread.recency_at,
  linkedAt: thread.linked_at,
});

export const hasSidebarThreadSummaryChanged = (
  previous: CodexThreadSummary | null,
  next: CodexThreadSummary,
): boolean => {
  if (!previous) return true;
  return (
    previous.projectId !== next.projectId ||
    previous.threadSource !== next.threadSource ||
    previous.agentNickname !== next.agentNickname ||
    previous.agentRole !== next.agentRole ||
    previous.agentPath !== next.agentPath ||
    previous.threadName !== next.threadName ||
    previous.threadPreview !== next.threadPreview ||
    previous.modelProvider !== next.modelProvider ||
    previous.cwd !== next.cwd ||
    previous.managedWorktreePath !== next.managedWorktreePath ||
    previous.projectlessOutputDirectory !== next.projectlessOutputDirectory ||
    previous.projectlessWorkspaceBrowserRoot !== next.projectlessWorkspaceBrowserRoot ||
    previous.statusType !== next.statusType ||
    previous.statusActiveFlags.join("\u0000") !== next.statusActiveFlags.join("\u0000") ||
    previous.hasUnreadTurn !== next.hasUnreadTurn ||
    previous.archived !== next.archived ||
    previous.createdAt !== next.createdAt ||
    previous.recencyAt !== next.recencyAt
  );
};
