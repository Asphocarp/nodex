import { useCallback, useEffect, useSyncExternalStore } from "react";

type Listener = () => void;

const sameStringSet = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean => {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
};

/**
 * Caps live referenced-document providers across the whole renderer window.
 * Eligible surfaces are ordered by the last user/visibility activation. The
 * most recent `capacity` surfaces stay active; evicted rows remain expanded
 * and automatically resume when a newer surface collapses or leaves view.
 */
export class ReferenceSurfaceActivationBudget {
  readonly capacity: number;

  private activationSequence = 0;
  private readonly eligibleSequenceByKey = new Map<string, number>();
  private activeKeys = new Set<string>();
  private readonly listeners = new Set<Listener>();

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError(
        "Reference surface capacity must be a positive integer",
      );
    }
    this.capacity = capacity;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isActive = (key: string): boolean => this.activeKeys.has(key);

  getActiveKeys = (): readonly string[] => [...this.activeKeys];

  setEligible = (key: string, eligible: boolean): void => {
    const isEligible = this.eligibleSequenceByKey.has(key);
    if (eligible === isEligible) return;

    if (eligible) {
      this.activationSequence += 1;
      this.eligibleSequenceByKey.set(key, this.activationSequence);
    } else {
      this.eligibleSequenceByKey.delete(key);
    }
    this.recomputeActiveKeys();
  };

  /** Reopening or explicitly focusing an eligible row makes it most recent. */
  touch = (key: string): void => {
    if (!this.eligibleSequenceByKey.has(key)) return;
    this.activationSequence += 1;
    this.eligibleSequenceByKey.set(key, this.activationSequence);
    this.recomputeActiveKeys();
  };

  clear = (): void => {
    if (this.eligibleSequenceByKey.size === 0 && this.activeKeys.size === 0)
      return;
    this.eligibleSequenceByKey.clear();
    this.activeKeys = new Set();
    this.emit();
  };

  private recomputeActiveKeys(): void {
    const ordered = [...this.eligibleSequenceByKey.entries()].sort(
      (left, right) => right[1] - left[1],
    );
    const nextActiveKeys = new Set(
      ordered.slice(0, this.capacity).map(([key]) => key),
    );
    if (sameStringSet(this.activeKeys, nextActiveKeys)) return;
    this.activeKeys = nextActiveKeys;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const referenceSurfaceActivationBudget =
  new ReferenceSurfaceActivationBudget(3);

export const useReferenceSurfaceActivation = (
  key: string,
  eligible: boolean,
  budget: ReferenceSurfaceActivationBudget = referenceSurfaceActivationBudget,
): boolean => {
  useEffect(() => {
    budget.setEligible(key, eligible);
    return () => budget.setEligible(key, false);
  }, [budget, eligible, key]);

  const getSnapshot = useCallback(() => budget.isActive(key), [budget, key]);
  return useSyncExternalStore(budget.subscribe, getSnapshot, getSnapshot);
};
