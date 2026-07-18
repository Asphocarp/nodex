import type {
  DatabaseId,
  DatabaseViewId,
} from "./database-identities";

export const LIBRARY_NAVIGATION_EVENT_VERSION = 1 as const;

export interface LibraryNavigationChangedEvent {
  readonly version: typeof LIBRARY_NAVIGATION_EVENT_VERSION;
  readonly libraryId: string;
  readonly storeEpoch: string | null;
  readonly changeLogSeq: number | null;
  readonly changeKind:
    | "content"
    | "location"
    | "lifecycle"
    | "database"
    | "view";
  readonly affectedParentKeys: readonly string[];
  readonly affectedPageIds: readonly string[];
  readonly affectedDatabaseIds: readonly DatabaseId[];
  readonly affectedViewIds: readonly DatabaseViewId[];
}
