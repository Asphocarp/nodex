export type PageTargetChangeKind =
  | "content"
  | "lifecycle"
  | "location"
  | "metadata";

/** Invalidation coordinate for the membership-independent Page target reader. */
export interface PageTargetChangedEvent {
  readonly libraryId: string;
  readonly targetPageId: string;
  readonly changeKind: PageTargetChangeKind;
  readonly document?: {
    readonly id: string;
    readonly generation: number;
    readonly headSeq: number;
  };
}
