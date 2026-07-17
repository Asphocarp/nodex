export interface PageOwnershipPathsChangedEvent {
  readonly libraryId?: string;
  readonly projectId?: string;
  readonly changeKind: "location" | "lifecycle" | "access";
}
