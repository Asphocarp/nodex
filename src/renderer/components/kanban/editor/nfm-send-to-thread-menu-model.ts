import type { CodexThreadSummary } from "@/lib/types";
import { normalizeSearchText } from "@/lib/search-text";
import { formatThreadMentionShortUuid } from "@/lib/nfm/thread-mention-display";

export type NfmSendToThreadMode = "send" | "wrap-toggle";

export type NfmSendToThreadTarget =
  | { kind: "thread"; threadId: string }
  | { kind: "new-thread"; sessionId?: string };

export interface NfmSendToThreadRequest {
  target: NfmSendToThreadTarget;
  mode: NfmSendToThreadMode;
}

export type NfmSendToThreadPreferredTarget =
  | { kind: "thread"; thread: CodexThreadSummary; meta: string }
  | { kind: "new-thread"; sessionId: string; meta: "This session"; label?: "New chat" };

export interface NfmSendToThreadNewRow {
  kind: "new-thread";
  id: string;
  label: "New chat";
  meta: string;
  isFooterAction: boolean;
  isPreferredTarget: boolean;
  target: Extract<NfmSendToThreadTarget, { kind: "new-thread" }>;
}

export interface NfmSendToThreadExistingRow {
  kind: "thread";
  id: string;
  threadId: string;
  label: string;
  meta: string;
  statusLabel: string;
  isPreferredTarget: boolean;
  thread: CodexThreadSummary;
  target: Extract<NfmSendToThreadTarget, { kind: "thread" }>;
}

export type NfmSendToThreadRow = NfmSendToThreadNewRow | NfmSendToThreadExistingRow;

export interface NfmSendToThreadRowsInput {
  threads: readonly CodexThreadSummary[];
  query: string;
  preferredTarget?: NfmSendToThreadPreferredTarget | null;
  projectNameById?: Readonly<Record<string, string>>;
}

function firstPreviewLine(thread: CodexThreadSummary): string {
  return thread.threadPreview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

export function resolveNfmSendToThreadTitle(thread: CodexThreadSummary): string {
  return thread.threadName?.trim()
    || firstPreviewLine(thread)
    || formatThreadMentionShortUuid(thread.threadId);
}

function resolveThreadStatusLabel(thread: CodexThreadSummary): string {
  if (thread.statusType === "systemError") return "Error";
  if (thread.statusActiveFlags.includes("waitingOnApproval")) return "Approval";
  if (thread.statusActiveFlags.includes("waitingOnUserInput")) return "Waiting";
  if (thread.statusType === "active") return "Running";
  return "Ready";
}

function resolveThreadProjectLabel(
  thread: CodexThreadSummary,
  projectNameById: Readonly<Record<string, string>>,
): string {
  const projectId = thread.projectId?.trim();
  if (!projectId) return "Unscoped";
  return projectNameById[projectId]?.trim() || projectId;
}

function threadMatchesQuery(
  thread: CodexThreadSummary,
  query: string,
  projectNameById: Readonly<Record<string, string>>,
): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeSearchText([
    thread.threadId,
    thread.threadName ?? "",
    thread.threadPreview,
    thread.cwd ?? "",
    resolveThreadProjectLabel(thread, projectNameById),
    resolveThreadStatusLabel(thread),
  ].join(" "));
  return haystack.includes(normalizedQuery);
}

function newThreadMatchesQuery(row: Pick<NfmSendToThreadNewRow, "label" | "meta" | "target">, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeSearchText([
    row.label,
    row.meta,
  ].join(" "));
  return haystack.includes(normalizedQuery);
}

function isAvailableThread(thread: CodexThreadSummary): boolean {
  return !thread.archived && thread.ephemeral !== true;
}

function mergeSendToThreadSummaries(
  threads: readonly CodexThreadSummary[],
  preferredTarget: NfmSendToThreadPreferredTarget | null | undefined,
): CodexThreadSummary[] {
  const threadsById = new Map<string, CodexThreadSummary>();
  if (preferredTarget?.kind === "thread") {
    threadsById.set(preferredTarget.thread.threadId, preferredTarget.thread);
  }
  for (const thread of threads) {
    threadsById.set(thread.threadId, thread);
  }
  return [...threadsById.values()];
}

function createThreadRow(
  thread: CodexThreadSummary,
  preferredMeta: string | null,
  projectNameById: Readonly<Record<string, string>>,
): NfmSendToThreadExistingRow {
  const statusLabel = resolveThreadStatusLabel(thread);
  return {
    kind: "thread",
    id: `thread:${thread.threadId}`,
    threadId: thread.threadId,
    label: resolveNfmSendToThreadTitle(thread),
    meta: preferredMeta ?? resolveThreadProjectLabel(thread, projectNameById),
    statusLabel,
    isPreferredTarget: preferredMeta !== null,
    thread,
    target: {
      kind: "thread",
      threadId: thread.threadId,
    },
  };
}

function createPreferredNewThreadRow(
  preferredTarget: Extract<NfmSendToThreadPreferredTarget, { kind: "new-thread" }>,
): NfmSendToThreadNewRow {
  return {
    kind: "new-thread",
    id: `new-thread:${preferredTarget.sessionId}`,
    label: preferredTarget.label ?? "New chat",
    meta: preferredTarget.meta,
    isFooterAction: false,
    isPreferredTarget: true,
    target: {
      kind: "new-thread",
      sessionId: preferredTarget.sessionId,
    },
  };
}

function createProjectNewThreadRow(): NfmSendToThreadNewRow {
  return {
    kind: "new-thread",
    id: "new-thread",
    label: "New chat",
    meta: "This project",
    isFooterAction: true,
    isPreferredTarget: false,
    target: { kind: "new-thread" },
  };
}

export function buildNfmSendToThreadRows({
  threads,
  query,
  preferredTarget = null,
  projectNameById = {},
}: NfmSendToThreadRowsInput): NfmSendToThreadRow[] {
  const preferredExistingThreadId = preferredTarget?.kind === "thread"
    ? preferredTarget.thread.threadId
    : null;
  const preferredNewThreadRow = preferredTarget?.kind === "new-thread"
    ? createPreferredNewThreadRow(preferredTarget)
    : null;
  const visiblePreferredNewThreadRow = preferredNewThreadRow && newThreadMatchesQuery(preferredNewThreadRow, query)
    ? preferredNewThreadRow
    : null;
  const threadRows = mergeSendToThreadSummaries(threads, preferredTarget)
    .filter(isAvailableThread)
    .filter((thread) => threadMatchesQuery(thread, query, projectNameById))
    .sort((left, right) => {
      const leftIsPreferred = left.threadId === preferredExistingThreadId;
      const rightIsPreferred = right.threadId === preferredExistingThreadId;
      if (leftIsPreferred !== rightIsPreferred) return leftIsPreferred ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    })
    .map((thread) => createThreadRow(
      thread,
      thread.threadId === preferredExistingThreadId && preferredTarget?.kind === "thread"
        ? preferredTarget.meta
        : null,
      projectNameById,
    ));

  if (visiblePreferredNewThreadRow) {
    return [
      visiblePreferredNewThreadRow,
      ...threadRows,
    ];
  }

  return [
    ...threadRows,
    createProjectNewThreadRow(),
  ];
}

function getInitialNfmSendToThreadFocusedRowId(
  query: string,
  rows: readonly NfmSendToThreadRow[],
): string | null {
  if (!normalizeSearchText(query)) return null;
  return rows.find((row) => row.kind === "thread")?.id ?? rows[0]?.id ?? null;
}

export function resolveNfmSendToThreadFocusedRowId(
  focusedRowId: string | null,
  query: string,
  rows: readonly NfmSendToThreadRow[],
): string | null {
  if (focusedRowId && rows.some((row) => row.id === focusedRowId)) {
    return focusedRowId;
  }

  return getInitialNfmSendToThreadFocusedRowId(query, rows);
}

export function moveNfmSendToThreadFocus(
  currentIndex: number,
  direction: 1 | -1,
  rows: readonly NfmSendToThreadRow[],
): number {
  if (rows.length === 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : rows.length - 1;

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0) return rows.length - 1;
  if (nextIndex >= rows.length) return 0;
  return nextIndex;
}

export function moveNfmSendToThreadFocusedRowId(
  focusedRowId: string | null,
  direction: 1 | -1,
  rows: readonly NfmSendToThreadRow[],
): string | null {
  if (rows.length === 0) return null;

  const currentIndex = focusedRowId
    ? rows.findIndex((row) => row.id === focusedRowId)
    : -1;
  const nextIndex = moveNfmSendToThreadFocus(currentIndex, direction, rows);
  return rows[nextIndex]?.id ?? null;
}
