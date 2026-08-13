export const INITIAL_DATA_SOURCE_SUFFIX = ":data-source:initial" as const;

export const initialDataSourceId = (databaseId: string): string => {
  const canonicalDatabaseId = databaseId.trim();
  if (!canonicalDatabaseId) {
    throw new TypeError("databaseId must be a non-empty identity");
  }
  return `${canonicalDatabaseId}${INITIAL_DATA_SOURCE_SUFFIX}`;
};

export type ProjectLifecycle = "active" | "inactive" | "archived";
export type ProjectResourceAccess = "read" | "read_write";
export type ProjectResourceRootKind = "page" | "database" | "canvas";

export interface LocalProfileLibrary {
  readonly profileId: string;
  readonly libraryId: string;
}

export interface ProjectResourceGrant {
  readonly id: string;
  readonly projectId: string;
  readonly libraryId: string;
  readonly rootKind: ProjectResourceRootKind;
  readonly rootId: string;
  readonly access: ProjectResourceAccess;
  readonly recursive: true;
  readonly revision: number;
  readonly lifecycle: "active" | "revoked";
  readonly createdAt: string;
  readonly updatedAt: string;
}
