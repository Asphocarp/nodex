import type { CodexBackgroundProcessRow } from "../../shared/types";

export interface CodexBackgroundTerminalProcessThreadRef {
  threadId: string;
  title: string;
}

export type CodexBackgroundTerminalProcessRow = CodexBackgroundProcessRow;

export function buildCodexBackgroundTerminalProcessRows(
  threads: readonly CodexBackgroundTerminalProcessThreadRef[],
  processesByThreadId: ReadonlyMap<string, readonly CodexBackgroundProcessRow[]>,
): CodexBackgroundTerminalProcessRow[] {
  return sortCodexBackgroundTerminalProcessRows(
    threads.flatMap((thread) =>
      (processesByThreadId.get(thread.threadId) ?? []).map((row) => ({
        ...row,
        threadTitle: row.threadTitle ?? thread.title,
      })),
    ),
  );
}

export function sortCodexBackgroundTerminalProcessRows(
  rows: readonly CodexBackgroundTerminalProcessRow[],
): CodexBackgroundTerminalProcessRow[] {
  return [...rows].sort((left, right) => {
    const leftCpu = readBackgroundTerminalCpuPercent(left) ?? Number.NEGATIVE_INFINITY;
    const rightCpu = readBackgroundTerminalCpuPercent(right) ?? Number.NEGATIVE_INFINITY;
    if (leftCpu !== rightCpu) return rightCpu - leftCpu;

    const leftMemory = normalizeRssKbForSort(readBackgroundTerminalMemoryKb(left));
    const rightMemory = normalizeRssKbForSort(readBackgroundTerminalMemoryKb(right));
    if (leftMemory !== rightMemory) return rightMemory - leftMemory;

    const threadCompare = normalizeThreadTitleForSort(left).localeCompare(
      normalizeThreadTitleForSort(right),
    );
    if (threadCompare !== 0) return threadCompare;
    return left.command.localeCompare(right.command);
  });
}

function normalizeThreadTitleForSort(row: CodexBackgroundTerminalProcessRow): string {
  return row.threadTitle ?? row.threadId;
}

function normalizeRssKbForSort(value: bigint | null): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

export function formatBackgroundTerminalCpuPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}%`;
}

export function readBackgroundTerminalCpuPercent(
  row: CodexBackgroundTerminalProcessRow,
): number | null {
  return row.terminal?.cpuPercent ?? row.terminalSession?.cpuPercent ?? null;
}

export function readBackgroundTerminalMemoryKb(
  row: CodexBackgroundTerminalProcessRow,
): bigint | null {
  return row.terminal?.rssKb ?? row.terminalSession?.rssKb ?? null;
}

export function formatBackgroundTerminalMemoryKb(value: bigint | null): string {
  if (value === null) {
    return "n/a";
  }

  const kb = Number(value);
  if (!Number.isFinite(kb) || kb < 0) {
    return "n/a";
  }
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  if (kb < 1024 * 1024) {
    return `${(kb / 1024).toFixed(1)} MB`;
  }
  return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}

export function formatBackgroundTerminalPid(
  row: Pick<CodexBackgroundTerminalProcessRow, "osPid" | "processId">,
): string {
  return row.osPid === null ? (row.processId ?? "n/a") : String(row.osPid);
}
