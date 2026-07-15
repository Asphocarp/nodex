export type CardTargetChangeKind =
  | "content"
  | "lifecycle"
  | "location"
  | "metadata";

/** Invalidation coordinate for the membership-independent Card target reader. */
export interface CardTargetChangedEvent {
  readonly projectId: string;
  readonly targetBlockId: string;
  readonly changeKind: CardTargetChangeKind;
  readonly document?: {
    readonly id: string;
    readonly generation: number;
    readonly headSeq: number;
  };
}
