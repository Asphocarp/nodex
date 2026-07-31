import type { ProjectSessionSummary } from "../../shared/types";
import type { CodexPendingWorktreeEntry } from "../../shared/codex-pending-worktree";
import type { WorkbenchAgentDockState } from "../../shared/workbench-scene";
import { sortProjectSessionSummariesForSidebar } from "./project-session-query-cache";
import { resolveThreadStatusDisplayLabel } from "./thread-status-display";

export type ProjectAgentDockAttention = "none" | "activity" | "request";

export interface ProjectAgentDockTargetRow {
  readonly id: string;
  readonly kind: "new" | "session";
  readonly sessionId: string | null;
  readonly label: string;
  readonly statusLabel: string;
  readonly preview: string | null;
  readonly selected: boolean;
  readonly attention: ProjectAgentDockAttention;
}

export interface ProjectAgentDockModel {
  readonly trigger: ProjectAgentDockTargetRow;
  readonly rows: readonly ProjectAgentDockTargetRow[];
  readonly canSend: boolean;
  readonly collectionMessage: string | null;
  readonly hasMore: boolean;
}

export interface ProjectAgentDockPendingWorktreeModel {
  readonly clientThreadId: string;
  readonly statusLabel: string;
  readonly composerBlockedReason: string;
  readonly attention: Exclude<ProjectAgentDockAttention, "none">;
}

export type ProjectAgentDockPendingWorktreeEntry = Extract<
  CodexPendingWorktreeEntry,
  { readonly launchMode: "start-conversation" }
>;

export type ProjectAgentDockCollectionState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly refreshError: string | null }
  | { readonly kind: "error"; readonly message: string };

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function resolveProjectAgentDockPendingWorktree(
  entries: readonly CodexPendingWorktreeEntry[],
  projectSessionId: string | null,
  hasAttachedThread: boolean,
): ProjectAgentDockPendingWorktreeEntry | null {
  if (!projectSessionId || hasAttachedThread) return null;

  let latest: ProjectAgentDockPendingWorktreeEntry | null = null;
  for (const entry of entries) {
    if (
      entry.launchMode !== "start-conversation"
      || entry.projectSessionId !== projectSessionId
    ) {
      continue;
    }
    if (
      latest === null
      || entry.createdAt > latest.createdAt
      || (
        entry.createdAt === latest.createdAt
        && entry.attempt > latest.attempt
      )
    ) {
      latest = entry;
    }
  }
  return latest;
}

export function buildProjectAgentDockPendingWorktreeModel(
  entry: ProjectAgentDockPendingWorktreeEntry,
): ProjectAgentDockPendingWorktreeModel {
  const statusLabel = entry.phase === "queued"
    ? "Queued…"
    : entry.phase === "creating"
      ? "Creating worktree…"
      : entry.phase === "setting-up"
        ? "Running setup…"
        : entry.phase === "worktree-ready"
          ? "Starting task…"
          : "Setup failed";
  return {
    clientThreadId: entry.clientThreadId,
    statusLabel,
    composerBlockedReason: entry.phase === "failed"
      ? "Resolve the failed worktree setup before starting this task again"
      : "Worktree setup is already in progress",
    attention: entry.phase === "failed" || entry.needsAttention
      ? "request"
      : "activity",
  };
}

function attentionForSession(
  session: ProjectSessionSummary,
): ProjectAgentDockAttention {
  const flags = session.thread?.statusActiveFlags ?? [];
  if (
    flags.includes("waitingOnApproval")
    || flags.includes("waitingOnUserInput")
  ) {
    return "request";
  }
  return session.thread?.statusType === "active" ? "activity" : "none";
}

function sessionRow(
  session: ProjectSessionSummary,
  selectedSessionId: string | null,
): ProjectAgentDockTargetRow {
  return {
    id: `session:${session.id}`,
    kind: "session",
    sessionId: session.id,
    label: session.displayTitle || session.noThreadFallbackTitle || "New task",
    statusLabel: session.thread
      ? resolveThreadStatusDisplayLabel(session.thread)
      : "Draft",
    preview: session.thread?.threadPreview.trim() || null,
    selected: session.id === selectedSessionId,
    attention: attentionForSession(session),
  };
}

function newTaskRow(selected: boolean): ProjectAgentDockTargetRow {
  return {
    id: "new",
    kind: "new",
    sessionId: null,
    label: "New task",
    statusLabel: "Draft",
    preview: null,
    selected,
    attention: "none",
  };
}

export function buildProjectAgentDockModel({
  projectId,
  dock,
  summaries,
  exactSelectedSession,
  collectionState,
  hasMore,
  query,
}: {
  readonly projectId: string;
  readonly dock: WorkbenchAgentDockState;
  readonly summaries: readonly ProjectSessionSummary[];
  readonly exactSelectedSession: ProjectSessionSummary | null;
  readonly collectionState: ProjectAgentDockCollectionState;
  readonly hasMore: boolean;
  readonly query: string;
}): ProjectAgentDockModel {
  const selectedSessionId = dock.binding.kind === "session"
    ? dock.binding.sessionId
    : null;
  const inScope = summaries.filter((session) =>
    session.projectId === projectId && !session.archived
  );
  const selectedExact = exactSelectedSession?.projectId === projectId
    && !exactSelectedSession.archived
    ? exactSelectedSession
    : null;
  const withExact = selectedExact
    && !inScope.some((session) => session.id === selectedExact.id)
    ? [...inScope, selectedExact]
    : inScope;
  const normalizedQuery = normalizeSearch(query);
  const sessionRows = sortProjectSessionSummariesForSidebar(withExact)
    .map((session) => sessionRow(session, selectedSessionId))
    .filter((row) => {
      if (!normalizedQuery) return true;
      return normalizeSearch([
        row.label,
        row.statusLabel,
        row.preview ?? "",
      ].join(" ")).includes(normalizedQuery);
    });
  const newRow = newTaskRow(dock.binding.kind === "new");
  const trigger = dock.binding.kind === "new"
    ? newRow
    : sessionRows.find((row) => row.sessionId === selectedSessionId)
      ?? {
        ...sessionRow({
          id: selectedSessionId ?? "unavailable",
          projectId,
          noThreadFallbackTitle: "Task unavailable",
          displayTitle: "Task unavailable",
          order: Number.MAX_SAFE_INTEGER,
          pinned: false,
          pinnedOrder: null,
          archived: false,
          archivedAt: null,
          unread: false,
          thread: null,
          createdAt: "",
          updatedAt: "",
        }, selectedSessionId),
        statusLabel: "Unavailable",
      };
  const collectionMessage = collectionState.kind === "loading"
    ? "Loading tasks…"
    : collectionState.kind === "error"
      ? collectionState.message
      : collectionState.kind === "ready"
        ? collectionState.refreshError
        : null;

  return {
    trigger,
    rows: [newRow, ...sessionRows],
    canSend: dock.binding.kind === "new" || selectedExact !== null,
    collectionMessage,
    hasMore,
  };
}
