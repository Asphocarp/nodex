import type {
  VirtualizedLatestTurnRestoreState,
  VirtualizedTurnListRestoreState,
} from "./local-conversation-turn-virtualization";

const MAX_THREAD_RESTORE_ENTRIES = 50;

export interface LocalConversationVirtualizedTurnRestoreSnapshot {
  distanceFromBottomPx: number;
  latestTurn: VirtualizedLatestTurnRestoreState | null;
  virtualizedTurnList: VirtualizedTurnListRestoreState | null;
}

const restoreSnapshotsByThreadId = new Map<string, LocalConversationVirtualizedTurnRestoreSnapshot>();

function touchThreadRestoreSnapshot(threadId: string): void {
  const snapshot = restoreSnapshotsByThreadId.get(threadId);
  if (!snapshot) return;
  restoreSnapshotsByThreadId.delete(threadId);
  restoreSnapshotsByThreadId.set(threadId, snapshot);
}

function trimThreadRestoreSnapshots(): void {
  while (restoreSnapshotsByThreadId.size > MAX_THREAD_RESTORE_ENTRIES) {
    const oldestThreadId = restoreSnapshotsByThreadId.keys().next().value;
    if (typeof oldestThreadId !== "string") return;
    restoreSnapshotsByThreadId.delete(oldestThreadId);
  }
}

export function readLocalConversationVirtualizedTurnRestoreSnapshot(
  threadId: string | null,
): LocalConversationVirtualizedTurnRestoreSnapshot | null {
  if (!threadId) return null;
  const snapshot = restoreSnapshotsByThreadId.get(threadId) ?? null;
  touchThreadRestoreSnapshot(threadId);
  return snapshot;
}

export function writeLocalConversationVirtualizedTurnRestoreSnapshot(
  threadId: string | null,
  snapshot: LocalConversationVirtualizedTurnRestoreSnapshot,
): void {
  if (!threadId) return;
  restoreSnapshotsByThreadId.set(threadId, snapshot);
  trimThreadRestoreSnapshots();
}

export function clearLocalConversationVirtualizedTurnRestoreSnapshotsForTests(): void {
  restoreSnapshotsByThreadId.clear();
}
