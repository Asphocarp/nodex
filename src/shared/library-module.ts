import type {
  DatabaseId,
  DatabaseViewId,
  DataSourceId,
} from "./database-identities";
import type { DatabaseViewKind } from "./database-kernel";
import type { RelocationDocumentCommit } from "./block-documents/contracts";

export const LIBRARY_MODULE_CONTRACT_VERSION = 4 as const;
export const DEFAULT_LIBRARY_READ_LIMIT = 20 as const;
export const MAX_LIBRARY_READ_LIMIT = 100 as const;
export const MAX_LIBRARY_CURSOR_LENGTH = 2_048 as const;
export const MAX_LIBRARY_QUERY_LENGTH = 256 as const;

export type LibraryRouteTarget =
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "database"; readonly databaseId: DatabaseId }
  | { readonly kind: "canvas"; readonly canvasId: string }
  | { readonly kind: "view"; readonly viewId: DatabaseViewId };

export type LibraryResourceTarget = Exclude<
  LibraryRouteTarget,
  { readonly kind: "view" }
>;

export type LibraryNavigationParent =
  | { readonly kind: "library" }
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "database"; readonly databaseId: DatabaseId };

export interface LibraryPageNavigationNode {
  readonly kind: "page";
  readonly pageId: string;
  readonly title: string;
  readonly hasChildren: boolean;
  readonly parentRevision: number;
  readonly metadataRevision: number;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly updatedAt: string;
}

export interface LibraryDatabaseNavigationNode {
  readonly kind: "database";
  readonly databaseId: DatabaseId;
  readonly title: string;
  readonly defaultViewId: DatabaseViewId;
  readonly hasMultipleViews: boolean;
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly updatedAt: string;
}

export interface LibraryCanvasNavigationNode {
  readonly kind: "canvas";
  readonly canvasId: string;
  readonly title: string;
  readonly isPrimary: boolean;
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly updatedAt: string;
}

export interface LibraryViewNavigationNode {
  readonly kind: "view";
  readonly viewId: DatabaseViewId;
  readonly databaseId: DatabaseId;
  readonly dataSourceId: DataSourceId;
  readonly title: string;
  readonly viewKind: DatabaseViewKind;
  readonly isDefault: boolean;
  readonly revision: number;
}

export type LibraryNavigationNode =
  | LibraryPageNavigationNode
  | LibraryDatabaseNavigationNode
  | LibraryCanvasNavigationNode
  | LibraryViewNavigationNode;

export interface LibraryCatalogEntry {
  readonly target: Exclude<LibraryRouteTarget, { readonly kind: "view" }>;
  readonly title: string;
  readonly kind: "page" | "database" | "canvas";
  readonly lifecycle: "active" | "archived";
  readonly locationLabel: string;
  readonly updatedAt: string;
  readonly locationRevision: number;
  readonly metadataRevision: number;
}

export type LibraryRead =
  | { readonly mode: "metadata" }
  | { readonly mode: "canvas_target"; readonly canvasId: string }
  | {
      readonly mode: "children";
      readonly parent: LibraryNavigationParent;
      readonly cursor?: string;
      readonly limit?: number;
      readonly forceIncludeTarget?: LibraryRouteTarget;
    }
  | { readonly mode: "path"; readonly target: LibraryRouteTarget }
  | {
      readonly mode: "catalog";
      readonly query?: string;
      readonly kinds?: readonly ("page" | "database" | "canvas")[];
      readonly lifecycle?: "active" | "archived";
      readonly cursor?: string;
      readonly limit?: number;
    };

export interface LibraryModuleReadRequest {
  readonly version: typeof LIBRARY_MODULE_CONTRACT_VERSION;
  readonly read: LibraryRead;
}

export type LibraryCanvasLocation =
  | { readonly kind: "library" }
  | {
      readonly kind: "page";
      readonly pageId: string;
      readonly documentId: string;
    };

export interface LibraryCanvasSummary {
  readonly canvasId: string;
  readonly projectId: string;
  readonly title: string;
  readonly lifecycle: string;
  readonly isPrimary: boolean;
  readonly location: LibraryCanvasLocation;
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly updatedAt: string;
}

export type LibraryCanvasTarget =
  | { readonly status: "missing"; readonly canvasId: string }
  | {
      readonly status: "deleted";
      readonly canvasId: string;
      readonly libraryId: string;
    }
  | { readonly status: "available"; readonly summary: LibraryCanvasSummary };

export type LibraryReadValue =
  | { readonly kind: "metadata" }
  | { readonly kind: "canvas_target"; readonly value: LibraryCanvasTarget }
  | {
      readonly kind: "children";
      readonly parent: LibraryNavigationParent;
      readonly items: readonly LibraryNavigationNode[];
      readonly nextCursor: string | null;
      readonly hasMore: boolean;
      readonly total: number;
    }
  | {
      readonly kind: "path";
      readonly target: LibraryRouteTarget;
      readonly nodes: readonly LibraryNavigationNode[];
    }
  | {
      readonly kind: "catalog";
      readonly items: readonly LibraryCatalogEntry[];
      readonly nextCursor: string | null;
      readonly hasMore: boolean;
      readonly total: number;
    };

export interface LibraryModuleReadSnapshot {
  readonly version: typeof LIBRARY_MODULE_CONTRACT_VERSION;
  readonly profileId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly value: LibraryReadValue;
}

export interface LibraryPlacementAnchor {
  readonly blockId: string;
  readonly expectedLocationRevision: number;
}

export type LibraryPageInsertion =
  | {
      readonly kind: "append";
      readonly parentBlockId?: string;
    }
  | {
      readonly kind: "before";
      readonly parentBlockId?: string;
      readonly anchorBlockId: string;
    }
  | {
      readonly kind: "replace_empty_paragraph";
      readonly blockId: string;
    };

export type LibraryCanvasDestination =
  | {
      readonly kind: "library";
      readonly before?: LibraryPlacementAnchor;
    }
  | {
      readonly kind: "page";
      readonly pageId: string;
      readonly expectedDocumentGeneration: number;
      readonly expectedDocumentHeadSeq: number;
      readonly insertion: LibraryPageInsertion;
    };

export type LibraryWriteParent =
  | {
      readonly kind: "library";
      readonly before?: LibraryPlacementAnchor;
    }
  | {
      readonly kind: "page";
      readonly pageId: string;
      readonly expectedDocumentGeneration: number;
      readonly expectedDocumentHeadSeq: number;
      readonly before?: LibraryPlacementAnchor;
    };

export interface CreateLibraryPageOperation {
  readonly kind: "create_page";
  readonly pageId: string;
  readonly documentId: string;
  readonly title: string;
  readonly parent: LibraryWriteParent;
}

export interface CreateLibraryDatabaseOperation {
  readonly kind: "create_database";
  readonly databaseId: DatabaseId;
  readonly dataSourceId: DataSourceId;
  readonly viewId: DatabaseViewId;
  readonly name: string;
  readonly parent: LibraryWriteParent;
}

export interface CreateLibraryCanvasOperation {
  readonly kind: "create_canvas";
  readonly canvasId: string;
  readonly documentId: string;
  readonly displayName: string;
  readonly destination: LibraryCanvasDestination;
}

export interface RenameLibraryCanvasOperation {
  readonly kind: "rename_canvas";
  readonly canvasId: string;
  readonly displayName: string;
  readonly expectedMetadataRevision: number;
}

export interface MoveLibraryCanvasOperation {
  readonly kind: "move_canvas";
  readonly canvasId: string;
  readonly expectedLocationRevision: number;
  readonly destination: LibraryCanvasDestination;
}

export interface DuplicateLibraryCanvasOperation {
  readonly kind: "duplicate_canvas";
  readonly sourceCanvasId: string;
  readonly canvasId: string;
  readonly documentId: string;
  readonly displayName?: string;
  readonly expectedDocumentGeneration: number;
  readonly expectedDocumentHeadSeq: number;
  readonly destination: LibraryCanvasDestination;
}

export interface DeleteLibraryCanvasOperation {
  readonly kind: "delete_canvas";
  readonly canvasId: string;
  readonly expectedLocationRevision: number;
  readonly expectedMetadataRevision: number;
}

export interface MoveLibraryBlockOperation {
  readonly kind: "move_block";
  readonly target:
    | {
        readonly kind: "page";
        readonly pageId: string;
        readonly expectedLocationRevision: number;
      }
    | {
        readonly kind: "database";
        readonly databaseId: DatabaseId;
        readonly expectedLocationRevision: number;
      };
  readonly parent: LibraryWriteParent;
}

export interface ArchiveLibraryResourceOperation {
  readonly kind: "archive_resource";
  readonly target:
    | {
        readonly kind: "page";
        readonly pageId: string;
        readonly expectedMetadataRevision: number;
      }
    | {
        readonly kind: "database";
        readonly databaseId: DatabaseId;
        readonly expectedMetadataRevision: number;
      };
}

export interface RestoreLibraryResourceOperation {
  readonly kind: "restore_resource";
  readonly target:
    | {
        readonly kind: "page";
        readonly pageId: string;
        readonly expectedMetadataRevision: number;
      }
    | {
        readonly kind: "database";
        readonly databaseId: DatabaseId;
        readonly expectedMetadataRevision: number;
      };
}

export interface GrantLibraryResourceToProjectOperation {
  readonly kind: "grant_project_access";
  readonly projectId: string;
  readonly target:
    | { readonly kind: "page"; readonly pageId: string }
    | { readonly kind: "database"; readonly databaseId: DatabaseId };
  readonly access: "read" | "read_write";
}

export type LibraryApplyOperation =
  | CreateLibraryPageOperation
  | CreateLibraryDatabaseOperation
  | CreateLibraryCanvasOperation
  | RenameLibraryCanvasOperation
  | MoveLibraryCanvasOperation
  | DuplicateLibraryCanvasOperation
  | DeleteLibraryCanvasOperation
  | MoveLibraryBlockOperation
  | ArchiveLibraryResourceOperation
  | RestoreLibraryResourceOperation
  | GrantLibraryResourceToProjectOperation;

export interface LibraryModuleApplyRequest {
  readonly version: typeof LIBRARY_MODULE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly storeEpoch: string;
  readonly operation: LibraryApplyOperation;
}

export interface LibraryCanvasMutationResult {
  readonly operationKind: string;
  readonly canvasId: string;
  readonly documentId: string;
  readonly sourceCanvasId: string | null;
  readonly locationRevision: number;
  readonly metadataRevision: number;
  readonly documentCommits: readonly RelocationDocumentCommit[];
}

export interface LibraryModuleApplyReceipt {
  readonly version: typeof LIBRARY_MODULE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly storeEpoch: string;
  readonly libraryId: string;
  readonly operationKind: LibraryApplyOperation["kind"];
  readonly duplicate: boolean;
  readonly didMutate: boolean;
  readonly createdTarget: Exclude<LibraryRouteTarget, { readonly kind: "view" }> | null;
  readonly canvasMutation: LibraryCanvasMutationResult | null;
  readonly affectedParentKeys: readonly string[];
  readonly affectedPageIds: readonly string[];
  readonly affectedDatabaseIds: readonly DatabaseId[];
  readonly affectedViewIds: readonly DatabaseViewId[];
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type LibraryModuleApplyResult =
  | { readonly ok: true; readonly value: LibraryModuleApplyReceipt }
  | { readonly ok: false; readonly error: LibraryModuleError };

export type LibraryModuleErrorCode =
  | "invalid_request"
  | "store_epoch_mismatch"
  | "identity_conflict"
  | "resource_not_found"
  | "revision_conflict"
  | "invalid_parent"
  | "hierarchy_cycle"
  | "project_inactive"
  | "primary_database_bound"
  | "document_conflict"
  | "stale_cursor"
  | "state_corrupt"
  | "unknown";

export interface LibraryModuleError {
  readonly code: LibraryModuleErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type LibraryModuleReadResult =
  | { readonly ok: true; readonly value: LibraryModuleReadSnapshot }
  | { readonly ok: false; readonly error: LibraryModuleError };
