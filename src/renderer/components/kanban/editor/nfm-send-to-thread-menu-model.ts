import type { CodexThreadSummary } from "@/lib/types";
import { normalizeSearchText } from "@/lib/search-text";
import { formatThreadMentionShortUuid } from "@/lib/nfm/thread-mention-display";

export type NfmSendToThreadMode = "send" | "wrap-toggle";

export type NfmSendToThreadTarget =
  | { kind: "thread"; threadId: string }
  | { kind: "new-thread" };

export interface NfmSendToThreadRequest {
  target: NfmSendToThreadTarget;
  mode: NfmSendToThreadMode;
}

export interface NfmSendToThreadNewRow {
  kind: "new-thread";
  id: "new-thread";
  label: "New thread";
  meta: string;
  target: NfmSendToThreadTarget;
}

export interface NfmSendToThreadExistingRow {
  kind: "thread";
  id: string;
  threadId: string;
  label: string;
  meta: string;
  statusLabel: string;
  thread: CodexThreadSummary;
  target: NfmSendToThreadTarget;
}

export type NfmSendToThreadRow = NfmSendToThreadNewRow | NfmSendToThreadExistingRow;

export interface NfmSendToThreadRowsInput {
  threads: readonly CodexThreadSummary[];
  query: string;
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

function threadMatchesQuery(thread: CodexThreadSummary, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeSearchText([
    thread.threadId,
    thread.threadName ?? "",
    thread.threadPreview,
    thread.cwd ?? "",
    resolveThreadStatusLabel(thread),
  ].join(" "));
  return haystack.includes(normalizedQuery);
}

function createThreadRow(thread: CodexThreadSummary): NfmSendToThreadExistingRow {
  const statusLabel = resolveThreadStatusLabel(thread);
  return {
    kind: "thread",
    id: `thread:${thread.threadId}`,
    threadId: thread.threadId,
    label: resolveNfmSendToThreadTitle(thread),
    meta: `${statusLabel} / ${formatThreadMentionShortUuid(thread.threadId)}`,
    statusLabel,
    thread,
    target: {
      kind: "thread",
      threadId: thread.threadId,
    },
  };
}

export function buildNfmSendToThreadRows({
  threads,
  query,
}: NfmSendToThreadRowsInput): NfmSendToThreadRow[] {
  const threadRows = threads
    .filter((thread) => !thread.archived && thread.ephemeral !== true)
    .filter((thread) => threadMatchesQuery(thread, query))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(createThreadRow);

  return [
    {
      kind: "new-thread",
      id: "new-thread",
      label: "New thread",
      meta: "Current card",
      target: { kind: "new-thread" },
    },
    ...threadRows,
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
