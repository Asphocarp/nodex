import { useCallback, useEffect, useSyncExternalStore } from "react";

type Listener = () => void;

export const ReferenceSurfaceActivationPriority = {
  visibility: 0,
  editing: 1,
} as const;

export interface ReferenceSurfaceActivationRank {
  readonly visibility: "prewarm" | "visible";
  readonly viewportCenterDistance: number;
  readonly documentOrder: number;
}

interface EligibleSurface {
  readonly sequence: number;
  readonly priority: number;
  readonly rank: ReferenceSurfaceActivationRank;
}

const defaultRank: ReferenceSurfaceActivationRank = {
  visibility: "prewarm",
  viewportCenterDistance: Number.POSITIVE_INFINITY,
  documentOrder: Number.POSITIVE_INFINITY,
};

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
 * Eligible surfaces are ordered by interaction priority and then by the last
 * user/visibility activation. The first `capacity` surfaces stay active;
 * evicted rows remain expanded and resume when a higher-ranked surface leaves.
 */
export class ReferenceSurfaceActivationBudget {
  readonly capacity: number;

  private activationSequence = 0;
  private readonly eligibleByKey = new Map<string, EligibleSurface>();
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

  setEligible = (
    key: string,
    eligible: boolean,
    priority = 0,
    rank: ReferenceSurfaceActivationRank = defaultRank,
  ): void => {
    const current = this.eligibleByKey.get(key);
    if (!eligible) {
      if (!current) return;
      this.eligibleByKey.delete(key);
      this.recomputeActiveKeys();
      return;
    }

    if (!current) {
      this.activationSequence += 1;
      this.eligibleByKey.set(key, {
        sequence: this.activationSequence,
        priority,
        rank,
      });
      this.recomputeActiveKeys();
      return;
    }

    if (
      current.priority === priority
      && current.rank.visibility === rank.visibility
      && current.rank.viewportCenterDistance === rank.viewportCenterDistance
      && current.rank.documentOrder === rank.documentOrder
    ) return;
    this.eligibleByKey.set(key, { ...current, priority, rank });
    this.recomputeActiveKeys();
  };

  /** Reopening or explicitly focusing an eligible row makes it most recent. */
  touch = (key: string): void => {
    const current = this.eligibleByKey.get(key);
    if (!current) return;
    this.activationSequence += 1;
    this.eligibleByKey.set(key, {
      ...current,
      sequence: this.activationSequence,
    });
    this.recomputeActiveKeys();
  };

  clear = (): void => {
    if (this.eligibleByKey.size === 0 && this.activeKeys.size === 0)
      return;
    this.eligibleByKey.clear();
    this.activeKeys = new Set();
    this.emit();
  };

  private recomputeActiveKeys(): void {
    const ordered = [...this.eligibleByKey.entries()].sort(
      (left, right) =>
        right[1].priority - left[1].priority
        || Number(right[1].rank.visibility === "visible")
          - Number(left[1].rank.visibility === "visible")
        || left[1].rank.viewportCenterDistance
          - right[1].rank.viewportCenterDistance
        || left[1].rank.documentOrder - right[1].rank.documentOrder
        || right[1].sequence - left[1].sequence,
    );
    const nextActiveKeys = new Set(
      ordered.slice(0, this.capacity).map(([key]) => key),
    );
    if (sameStringSet(this.activeKeys, nextActiveKeys)) {
      this.activeKeys = nextActiveKeys;
      return;
    }
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
  priority = 0,
  rank: ReferenceSurfaceActivationRank = defaultRank,
): boolean => {
  const rankVisibility = rank.visibility;
  const rankViewportCenterDistance = rank.viewportCenterDistance;
  const rankDocumentOrder = rank.documentOrder;
  useEffect(() => {
    budget.setEligible(key, eligible, priority, {
      visibility: rankVisibility,
      viewportCenterDistance: rankViewportCenterDistance,
      documentOrder: rankDocumentOrder,
    });
    return () => budget.setEligible(key, false);
  }, [
    budget,
    eligible,
    key,
    priority,
    rankDocumentOrder,
    rankViewportCenterDistance,
    rankVisibility,
  ]);

  const getSnapshot = useCallback(() => budget.isActive(key), [budget, key]);
  return useSyncExternalStore(budget.subscribe, getSnapshot, getSnapshot);
};
