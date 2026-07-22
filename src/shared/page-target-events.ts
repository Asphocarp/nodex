export type PageTargetChangeKind =
  | "content"
  | "lifecycle"
  | "location"
  | "metadata";

export const PAGE_TARGET_CHANGE_EVENT_VERSION = 1 as const;

/** Invalidation coordinate for the membership-independent Page target reader. */
export interface PageTargetChangedEvent {
  readonly version: typeof PAGE_TARGET_CHANGE_EVENT_VERSION;
  readonly libraryId: string;
  readonly storeEpoch: string | null;
  readonly changeLogSeq: number | null;
  readonly targetPageId: string;
  readonly changeKind: PageTargetChangeKind;
  readonly affectedDatabaseIds: readonly string[];
  readonly affectedDataSourceIds: readonly string[];
  readonly document?: {
    readonly id: string;
    readonly generation: number;
    readonly headSeq: number;
  };
}
