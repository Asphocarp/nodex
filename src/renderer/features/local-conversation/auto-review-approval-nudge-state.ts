import { useCallback, useMemo } from "react";
import {
  appScope,
  getConcretePersistedAtom,
  persistedAtom,
  preloadPersistedAtom,
  scopedAtom,
  useMaitaiStore,
  usePersistedAtomValue,
  useScopeHandle,
  useScopedAtomValue,
  useSetPersistedAtom,
} from "@/lib/maitai";

export const AUTO_REVIEW_APPROVAL_NUDGE_DISMISSED_ATOM_KEY =
  "auto-review-approval-nudge-dismissed-v1";
export const DEFAULT_AUTO_REVIEW_APPROVAL_NUDGE_THRESHOLD = 3;

interface AutoReviewApprovalNudgeTransientState {
  readonly manualApprovalCountByThreadId: Readonly<Record<string, number>>;
  readonly activeThreadIds: Readonly<Record<string, true>>;
}

export interface AutoReviewApprovalNudgeState extends AutoReviewApprovalNudgeTransientState {
  readonly hydrated: boolean;
  readonly dismissed: boolean;
}

interface RecordManualApprovalInput {
  readonly threadId: string;
  readonly eligible: boolean;
  readonly threshold?: number;
}

const EMPTY_TRANSIENT_STATE: AutoReviewApprovalNudgeTransientState = Object.freeze({
  manualApprovalCountByThreadId: Object.freeze({}),
  activeThreadIds: Object.freeze({}),
});

const autoReviewApprovalNudgeTransientStateAtom = scopedAtom(appScope, EMPTY_TRANSIENT_STATE, {
  debugLabel: "auto-review-approval-nudge-transient-state",
});

export const autoReviewApprovalNudgeDismissedAtom = persistedAtom<boolean>({
  debugLabel: "auto-review-approval-nudge-dismissed",
  storageKey: AUTO_REVIEW_APPROVAL_NUDGE_DISMISSED_ATOM_KEY,
  defaultValue: false,
  hydration: "eager",
  synchronization: "cross-window",
  optimistic: true,
  writeFailure: "retain-and-error",
  decode: (value) => value === true,
});

export function recordManualApprovalInState(
  current: AutoReviewApprovalNudgeTransientState,
  input: RecordManualApprovalInput,
): AutoReviewApprovalNudgeTransientState {
  if (!input.eligible) return current;
  const threadId = input.threadId.trim();
  if (!threadId || current.activeThreadIds[threadId] === true) return current;

  const threshold = Math.max(
    1,
    Math.floor(input.threshold ?? DEFAULT_AUTO_REVIEW_APPROVAL_NUDGE_THRESHOLD),
  );
  const nextCount = (current.manualApprovalCountByThreadId[threadId] ?? 0) + 1;
  return {
    manualApprovalCountByThreadId: {
      ...current.manualApprovalCountByThreadId,
      [threadId]: nextCount,
    },
    activeThreadIds:
      nextCount >= threshold
        ? { ...current.activeThreadIds, [threadId]: true }
        : current.activeThreadIds,
  };
}

export function resolveAutoReviewApprovalNudgeInState(
  current: AutoReviewApprovalNudgeTransientState,
  rawThreadId: string,
): AutoReviewApprovalNudgeTransientState {
  const threadId = rawThreadId.trim();
  if (
    !threadId ||
    (current.activeThreadIds[threadId] !== true &&
      current.manualApprovalCountByThreadId[threadId] === undefined)
  ) {
    return current;
  }

  const manualApprovalCountByThreadId = {
    ...current.manualApprovalCountByThreadId,
  };
  const activeThreadIds = { ...current.activeThreadIds };
  delete manualApprovalCountByThreadId[threadId];
  delete activeThreadIds[threadId];
  return {
    manualApprovalCountByThreadId,
    activeThreadIds,
  };
}

export function useAutoReviewApprovalNudgeState(): AutoReviewApprovalNudgeState {
  const dismissedLoadable = usePersistedAtomValue(autoReviewApprovalNudgeDismissedAtom);
  const transientState = useScopedAtomValue(autoReviewApprovalNudgeTransientStateAtom);

  return useMemo(() => {
    const dismissed = dismissedLoadable.value;
    return {
      hydrated: dismissedLoadable.status === "ready",
      dismissed,
      manualApprovalCountByThreadId: dismissed
        ? EMPTY_TRANSIENT_STATE.manualApprovalCountByThreadId
        : transientState.manualApprovalCountByThreadId,
      activeThreadIds: dismissed
        ? EMPTY_TRANSIENT_STATE.activeThreadIds
        : transientState.activeThreadIds,
    };
  }, [dismissedLoadable.status, dismissedLoadable.value, transientState]);
}

export function useAutoReviewApprovalNudgeActions() {
  const store = useMaitaiStore();
  const appHandle = useScopeHandle(appScope);
  const setDismissed = useSetPersistedAtom(autoReviewApprovalNudgeDismissedAtom);

  const recordManualApproval = useCallback(
    async (input: RecordManualApprovalInput): Promise<void> => {
      if (!input.eligible || !input.threadId.trim()) return;
      await preloadPersistedAtom(store, autoReviewApprovalNudgeDismissedAtom);
      const dismissed = store.jotaiStore.get(
        getConcretePersistedAtom(store, autoReviewApprovalNudgeDismissedAtom),
      ).value;
      if (dismissed) return;
      appHandle.set(autoReviewApprovalNudgeTransientStateAtom, (current) =>
        recordManualApprovalInState(current, input),
      );
    },
    [appHandle, store],
  );

  const resolveNudge = useCallback(
    (threadId: string): void => {
      appHandle.set(autoReviewApprovalNudgeTransientStateAtom, (current) =>
        resolveAutoReviewApprovalNudgeInState(current, threadId),
      );
    },
    [appHandle],
  );

  const dismissNudges = useCallback(async (): Promise<void> => {
    appHandle.set(autoReviewApprovalNudgeTransientStateAtom, EMPTY_TRANSIENT_STATE);
    await setDismissed(true);
  }, [appHandle, setDismissed]);

  return {
    dismissNudges,
    recordManualApproval,
    resolveNudge,
  };
}
