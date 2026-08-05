import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
  DatabaseViewFilterNode,
  DatabaseViewConfig,
  DatabaseViewKind,
  DatabaseViewSort,
} from "./database-kernel";
import type { Page } from "./page";

export const DATABASE_MODULE_CONTRACT_VERSION = 1 as const;
export const MAX_DATABASE_MODULE_BULK_ENTRIES = 100 as const;

export interface DatabaseContainerRecord {
  readonly databaseId: string;
  readonly libraryId: string;
  readonly name: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly defaultViewId: string | null;
  readonly accessRevision: number;
  readonly metadataRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataSourceRecord {
  readonly dataSourceId: string;
  readonly libraryId: string;
  readonly homeDatabaseId: string;
  readonly name: string;
  readonly schemaKey: string;
  readonly schemaRevision: number;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly rankKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataSourcePropertyRecord {
  readonly propertyId: string;
  readonly dataSourceId: string;
  readonly key: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  readonly rankKey: string;
  readonly lifecycle: "active" | "deleted";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabaseViewRecord {
  readonly viewId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly name: string;
  readonly kind: DatabaseViewKind;
  readonly config: DatabaseViewConfig;
  readonly isDefault: boolean;
  readonly revision: number;
  readonly rankKey: string;
  readonly lifecycle: "active" | "deleted";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabaseContainerDescriptor {
  readonly database: DatabaseContainerRecord;
  readonly dataSources: readonly DataSourceRecord[];
  readonly views: readonly DatabaseViewRecord[];
}

export interface DataSourceDescriptor {
  readonly dataSource: DataSourceRecord;
  readonly properties: readonly DataSourcePropertyRecord[];
}

export interface DataSourcePageValue {
  readonly propertyId: string;
  readonly valueType: DatabasePropertyValueType;
  readonly value: DatabaseJsonValue;
  readonly revision: number;
}

export interface DataSourcePageRow {
  readonly page: Page;
  readonly membership: {
    readonly membershipId: string;
    readonly dataSourceId: string;
    readonly revision: number;
    readonly createdAt: string;
  };
  readonly values: Readonly<Record<string, DataSourcePageValue>>;
  readonly position: null | {
    readonly groupKey: string | null;
    readonly rankKey: string;
    readonly revision: number;
  };
  readonly effectiveGroupKey: string | null;
}

export interface DatabaseViewQueryResult {
  readonly database: DatabaseContainerRecord;
  readonly dataSource: DataSourceRecord;
  readonly view: DatabaseViewRecord;
  readonly properties: readonly DataSourcePropertyRecord[];
  readonly rows: readonly DataSourcePageRow[];
}

export interface DataSourceQueryResult {
  readonly database: DatabaseContainerRecord;
  readonly dataSource: DataSourceRecord;
  readonly properties: readonly DataSourcePropertyRecord[];
  readonly rows: readonly DataSourcePageRow[];
}

export type DatabaseRead =
  | {
      readonly target: { readonly kind: "project_default" };
      readonly mode: "catalog" | "database" | "query";
    }
  | {
      readonly target: {
        readonly kind: "database";
        readonly databaseId: string;
      };
      readonly mode: "database";
    }
  | {
      readonly target: {
        readonly kind: "data_source";
        readonly dataSourceId: string;
      };
      readonly mode: "data_source";
    }
  | {
      readonly target: {
        readonly kind: "data_source";
        readonly dataSourceId: string;
      };
      readonly mode: "query";
      readonly filter?: DatabaseViewFilterNode;
      readonly sort?: readonly DatabaseViewSort[];
    }
  | {
      readonly target: { readonly kind: "view"; readonly viewId: string };
      readonly mode: "view" | "query";
    };

export type DatabaseReadValue =
  | {
      readonly kind: "catalog";
      readonly databases: readonly DatabaseContainerDescriptor[];
    }
  | { readonly kind: "database"; readonly value: DatabaseContainerDescriptor }
  | { readonly kind: "data_source"; readonly value: DataSourceDescriptor }
  | { readonly kind: "view"; readonly value: DatabaseViewRecord }
  | { readonly kind: "query"; readonly value: DatabaseViewQueryResult }
  | { readonly kind: "data_source_query"; readonly value: DataSourceQueryResult };

export interface DatabaseModuleReadRequest {
  readonly version: typeof DATABASE_MODULE_CONTRACT_VERSION;
  readonly projectId: string;
  readonly read: DatabaseRead;
}

export interface DatabaseModuleReadSnapshot {
  readonly version: typeof DATABASE_MODULE_CONTRACT_VERSION;
  readonly projectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly value: DatabaseReadValue;
}

export type DatabaseModuleErrorCode =
  | "invalid_request"
  | "store_not_initialized"
  | "project_not_found"
  | "resource_not_found"
  | "authorization_denied"
  | "revision_conflict"
  | "operation_id_collision"
  | "state_corrupt"
  | "unsupported_operation"
  | "unknown";

export interface DatabaseModuleError {
  readonly code: DatabaseModuleErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

export type DatabaseModuleReadResult =
  | { readonly ok: true; readonly value: DatabaseModuleReadSnapshot }
  | { readonly ok: false; readonly error: DatabaseModuleError };

export interface PutDataSourcePropertyOperation {
  readonly kind: "put_property";
  readonly dataSourceId: string;
  readonly propertyId: string;
  readonly expectedDataSourceRevision: number;
  readonly expectedPropertyRevision: number;
  readonly key: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  readonly beforePropertyId?: string;
}

export interface DeleteDataSourcePropertyOperation {
  readonly kind: "delete_property";
  readonly dataSourceId: string;
  readonly propertyId: string;
  readonly expectedDataSourceRevision: number;
  readonly expectedPropertyRevision: number;
}

export interface SetDataSourcePageValueOperation {
  readonly kind: "set_value";
  readonly pageId: string;
  readonly dataSourceId: string;
  readonly propertyId: string;
  readonly expectedValueRevision: number;
  readonly value: DatabaseJsonValue;
}

export interface SetDataSourcePageValuesOperation {
  readonly kind: "set_values";
  readonly values: readonly Omit<SetDataSourcePageValueOperation, "kind">[];
}

export interface AddRemoveDataSourcePageValueOperation {
  readonly kind: "add_remove_value";
  readonly pageId: string;
  readonly dataSourceId: string;
  readonly propertyId: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

export interface TransferDataSourcePageOperation {
  readonly kind: "transfer_page";
  readonly pageId: string;
  readonly expectedParentRevision: number;
  /** Zero when the Page currently has no active Data Source membership. */
  readonly expectedActiveMembershipRevision: number;
  readonly target:
    | { readonly kind: "library"; readonly libraryId: string }
    | { readonly kind: "page"; readonly pageId: string }
    | {
        readonly kind: "data_source";
        readonly dataSourceId: string;
      };
}

export interface PutDatabaseViewOperationV2 {
  readonly kind: "put_view";
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly viewId: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly viewKind: DatabaseViewKind;
  readonly config: DatabaseViewConfig;
  readonly isDefault: boolean;
  /** Undefined preserves an update's rank; null explicitly appends. */
  readonly beforeViewId?: string | null;
}

export interface DeleteDatabaseViewOperationV2 {
  readonly kind: "delete_view";
  readonly databaseId: string;
  readonly viewId: string;
  readonly expectedRevision: number;
}

export interface PositionDatabaseViewPageOperation {
  readonly kind: "position_page";
  readonly viewId: string;
  readonly pageId: string;
  readonly expectedPositionRevision: number;
  readonly groupKey: string | null;
  readonly beforePageId?: string;
}

export interface PositionDatabaseViewPagesOperation {
  readonly kind: "position_pages";
  readonly viewId: string;
  /** Page IDs are in their intended visual order. */
  readonly pages: readonly {
    readonly pageId: string;
    readonly expectedPositionRevision: number;
  }[];
  readonly groupKey: string | null;
  /** The anchor must be outside the moved Page set. */
  readonly beforePageId?: string;
}

export type DatabaseApplyOperation =
  | PutDataSourcePropertyOperation
  | DeleteDataSourcePropertyOperation
  | SetDataSourcePageValueOperation
  | SetDataSourcePageValuesOperation
  | AddRemoveDataSourcePageValueOperation
  | TransferDataSourcePageOperation
  | PutDatabaseViewOperationV2
  | DeleteDatabaseViewOperationV2
  | PositionDatabaseViewPageOperation
  | PositionDatabaseViewPagesOperation;

export interface DatabaseApply {
  readonly version: typeof DATABASE_MODULE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
  readonly operations: readonly DatabaseApplyOperation[];
}

export interface DatabaseApplyReceipt {
  readonly version: typeof DATABASE_MODULE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly duplicate: boolean;
  readonly operationKinds: readonly DatabaseApplyOperation["kind"][];
  readonly affectedDatabaseIds: readonly string[];
  readonly affectedDataSourceIds: readonly string[];
  readonly affectedPageIds: readonly string[];
  readonly affectedViewIds: readonly string[];
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly commitSeq: number;
  readonly committedAt: string;
}

export type DatabaseApplyResult =
  | { readonly ok: true; readonly value: DatabaseApplyReceipt }
  | { readonly ok: false; readonly error: DatabaseModuleError };

export interface DatabaseModule {
  read(input: DatabaseModuleReadRequest): Promise<DatabaseModuleReadResult>;
  apply(input: DatabaseApply): Promise<DatabaseApplyResult>;
}
