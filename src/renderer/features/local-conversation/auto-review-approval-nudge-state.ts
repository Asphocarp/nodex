import {
  readAtom,
  subscribeAtom,
  writeAtom,
} from "@/lib/persisted-atom-store";

export const AUTO_REVIEW_APPROVAL_NUDGE_DISMISSED_ATOM_KEY =
  "auto-review-approval-nudge-dismissed-v1";
export const DEFAULT_AUTO_REVIEW_APPROVAL_NUDGE_THRESHOLD = 3;

export interface AutoReviewApprovalNudgeState {
  hydrated: boolean;
  dismissed: boolean;
  manualApprovalCountByThreadId: ReadonlyMap<string, number>;
  activeThreadIds: ReadonlySet<string>;
}

type AutoReviewApprovalNudgeListener = () => void;

const EMPTY_COUNTS = new Map<string, number>();
const EMPTY_ACTIVE_THREAD_IDS = new Set<string>();

let state: AutoReviewApprovalNudgeState = {
  hydrated: false,
  dismissed: false,
  manualApprovalCountByThreadId: EMPTY_COUNTS,
  activeThreadIds: EMPTY_ACTIVE_THREAD_IDS,
};
let hydratePromise: Promise<void> | null = null;
let atomUnsubscribe: (() => void) | null = null;
const listeners = new Set<AutoReviewApprovalNudgeListener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function replaceState(nextState: AutoReviewApprovalNudgeState): void {
  if (state === nextState) return;
  state = nextState;
  emit();
}

function applyDismissedState(dismissed: boolean): void {
  replaceState({
    hydrated: true,
    dismissed,
    manualApprovalCountByThreadId: dismissed
      ? EMPTY_COUNTS
      : state.manualApprovalCountByThreadId,
    activeThreadIds: dismissed
      ? EMPTY_ACTIVE_THREAD_IDS
      : state.activeThreadIds,
  });
}

export function getAutoReviewApprovalNudgeState(): AutoReviewApprovalNudgeState {
  return state;
}

export function subscribeAutoReviewApprovalNudgeState(
  listener: AutoReviewApprovalNudgeListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function hydrateAutoReviewApprovalNudgeState(): Promise<void> {
  if (state.hydrated) return;
  if (hydratePromise) return hydratePromise;

  atomUnsubscribe ??= subscribeAtom(
    AUTO_REVIEW_APPROVAL_NUDGE_DISMISSED_ATOM_KEY,
    (value) => applyDismissedState(value === true),
  );
  hydratePromise = readAtom(AUTO_REVIEW_APPROVAL_NUDGE_DISMISSED_ATOM_KEY, false)
    .then((value) => applyDismissedState(value === true))
    .finally(() => {
      hydratePromise = null;
    });
  return hydratePromise;
}

export async function recordManualApprovalForAutoReviewNudge(input: {
  threadId: string;
  eligible: boolean;
  threshold?: number;
}): Promise<void> {
  if (!input.eligible) return;
  const threadId = input.threadId.trim();
  if (!threadId) return;
  await hydrateAutoReviewApprovalNudgeState();
  if (state.dismissed || state.activeThreadIds.has(threadId)) return;

  const threshold = Math.max(1, Math.floor(
    input.threshold ?? DEFAULT_AUTO_REVIEW_APPROVAL_NUDGE_THRESHOLD,
  ));
  const nextCount = (state.manualApprovalCountByThreadId.get(threadId) ?? 0) + 1;
  const counts = new Map(state.manualApprovalCountByThreadId);
  counts.set(threadId, nextCount);
  const activeThreadIds = new Set(state.activeThreadIds);
  if (nextCount >= threshold) activeThreadIds.add(threadId);
  replaceState({
    ...state,
    manualApprovalCountByThreadId: counts,
    activeThreadIds,
  });
}

export function resolveAutoReviewApprovalNudge(threadId: string): void {
  if (!state.activeThreadIds.has(threadId) && !state.manualApprovalCountByThreadId.has(threadId)) {
    return;
  }
  const counts = new Map(state.manualApprovalCountByThreadId);
  counts.delete(threadId);
  const activeThreadIds = new Set(state.activeThreadIds);
  activeThreadIds.delete(threadId);
  replaceState({
    ...state,
    manualApprovalCountByThreadId: counts,
    activeThreadIds,
  });
}

export async function dismissAutoReviewApprovalNudges(): Promise<void> {
  applyDismissedState(true);
  await writeAtom(AUTO_REVIEW_APPROVAL_NUDGE_DISMISSED_ATOM_KEY, true);
}

export function resetAutoReviewApprovalNudgeStateForTests(): void {
  atomUnsubscribe?.();
  atomUnsubscribe = null;
  hydratePromise = null;
  state = {
    hydrated: false,
    dismissed: false,
    manualApprovalCountByThreadId: EMPTY_COUNTS,
    activeThreadIds: EMPTY_ACTIVE_THREAD_IDS,
  };
  listeners.clear();
}
