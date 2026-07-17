import type {
  DatabaseApply as DatabaseApplyV1,
  DatabaseContainerRecord as DatabaseContainerRecordV1,
  DatabaseModuleReadSnapshot as DatabaseModuleReadSnapshotV1,
  DatabaseModuleReadRequest as DatabaseModuleReadRequestV1,
  DatabaseModuleError as DatabaseModuleErrorV1,
  DatabaseViewRecord as DatabaseViewRecordV1,
  DataSourcePageRow as DataSourcePageRowV1,
  DataSourcePageValue as DataSourcePageValueV1,
  DataSourcePropertyRecord as DataSourcePropertyRecordV1,
  DataSourceRecord as DataSourceRecordV1,
} from "./database-module";
import type {
  DatabaseId,
  DatabaseViewId,
  DataSourceId,
  DataSourceOptionId,
  DataSourcePropertyId,
} from "./database-identities";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
  DatabaseViewConfigV2,
  DatabaseViewFilterNode,
  DatabaseViewKind,
  DatabaseViewSort,
} from "./database-kernel";

export const DATABASE_MODULE_V2_CONTRACT_VERSION = 2 as const;
export const MAX_DATABASE_MODULE_V2_OPERATIONS = 64 as const;
export const MAX_DATABASE_MODULE_V2_BULK_ENTRIES = 100 as const;

export interface DatabaseContainerRecordV2
  extends Omit<DatabaseContainerRecordV1, "databaseId" | "defaultViewId"> {
  readonly databaseId: DatabaseId;
  readonly defaultViewId: DatabaseViewId | null;
}

export interface DataSourceRecordV2
  extends Omit<DataSourceRecordV1, "dataSourceId" | "homeDatabaseId"> {
  readonly dataSourceId: DataSourceId;
  readonly homeDatabaseId: DatabaseId;
}

export interface DataSourcePropertyRecordV2
  extends Omit<
    DataSourcePropertyRecordV1,
    "propertyId" | "dataSourceId" | "key"
  > {
  readonly propertyId: DataSourcePropertyId;
  readonly dataSourceId: DataSourceId;
}

export interface DatabaseViewRecordV2
  extends Omit<
    DatabaseViewRecordV1,
    "viewId" | "databaseId" | "dataSourceId" | "config"
  > {
  readonly viewId: DatabaseViewId;
  readonly databaseId: DatabaseId;
  readonly dataSourceId: DataSourceId;
  readonly config: DatabaseViewConfigV2;
}

export interface DatabaseContainerDescriptorV2 {
  readonly database: DatabaseContainerRecordV2;
  readonly dataSources: readonly DataSourceRecordV2[];
  readonly views: readonly DatabaseViewRecordV2[];
}

export interface DataSourceDescriptorV2 {
  readonly dataSource: DataSourceRecordV2;
  readonly properties: readonly DataSourcePropertyRecordV2[];
}

export interface DataSourcePageValueV2
  extends Omit<DataSourcePageValueV1, "propertyId"> {
  readonly propertyId: DataSourcePropertyId;
}

export interface DataSourcePageRowV2
  extends Omit<DataSourcePageRowV1, "membership" | "values"> {
  readonly membership: Omit<
    DataSourcePageRowV1["membership"],
    "dataSourceId"
  > & {
    readonly dataSourceId: DataSourceId;
  };
  readonly values: Readonly<Record<string, DataSourcePageValueV2>>;
}

export interface DatabaseViewQueryResultV2 {
  readonly database: DatabaseContainerRecordV2;
  readonly dataSource: DataSourceRecordV2;
  readonly view: DatabaseViewRecordV2;
  readonly properties: readonly DataSourcePropertyRecordV2[];
  readonly rows: readonly DataSourcePageRowV2[];
}

export interface DataSourceQueryResultV2 {
  readonly database: DatabaseContainerRecordV2;
  readonly dataSource: DataSourceRecordV2;
  readonly properties: readonly DataSourcePropertyRecordV2[];
  readonly rows: readonly DataSourcePageRowV2[];
}

export type DatabaseReadV2 =
  | {
      readonly target: { readonly kind: "project_default" };
      readonly mode: "catalog" | "database" | "query";
    }
  | {
      readonly target: {
        readonly kind: "database";
        readonly databaseId: DatabaseId;
      };
      readonly mode: "database";
    }
  | {
      readonly target: {
        readonly kind: "data_source";
        readonly dataSourceId: DataSourceId;
      };
      readonly mode: "data_source";
    }
  | {
      readonly target: {
        readonly kind: "data_source";
        readonly dataSourceId: DataSourceId;
      };
      readonly mode: "query";
      readonly filter?: DatabaseViewFilterNode;
      readonly sort?: readonly DatabaseViewSort[];
    }
  | {
      readonly target: {
        readonly kind: "view";
        readonly viewId: DatabaseViewId;
      };
      readonly mode: "view" | "query";
    };

export type DatabaseReadValueV2 =
  | {
      readonly kind: "catalog";
      readonly databases: readonly DatabaseContainerDescriptorV2[];
    }
  | {
      readonly kind: "database";
      readonly value: DatabaseContainerDescriptorV2;
    }
  | { readonly kind: "data_source"; readonly value: DataSourceDescriptorV2 }
  | { readonly kind: "view"; readonly value: DatabaseViewRecordV2 }
  | { readonly kind: "query"; readonly value: DatabaseViewQueryResultV2 }
  | {
      readonly kind: "data_source_query";
      readonly value: DataSourceQueryResultV2;
    };

export interface DatabaseModuleReadRequestV2
  extends Omit<DatabaseModuleReadRequestV1, "version" | "read"> {
  readonly version: typeof DATABASE_MODULE_V2_CONTRACT_VERSION;
  readonly read: DatabaseReadV2;
}

export interface DatabaseModuleReadSnapshotV2
  extends Omit<DatabaseModuleReadSnapshotV1, "version" | "value"> {
  readonly version: typeof DATABASE_MODULE_V2_CONTRACT_VERSION;
  readonly value: DatabaseReadValueV2;
}

export type DatabaseModuleErrorCodeV2 =
  | DatabaseModuleErrorV1["code"]
  | "identity_conflict";

export interface DatabaseModuleErrorV2
  extends Omit<DatabaseModuleErrorV1, "code"> {
  readonly code: DatabaseModuleErrorCodeV2;
}

export type DatabaseModuleReadResultV2 =
  | { readonly ok: true; readonly value: DatabaseModuleReadSnapshotV2 }
  | { readonly ok: false; readonly error: DatabaseModuleErrorV2 };

/**
 * Property metadata is intentionally separate from a select-like Property's
 * option registry. The current Property schemas have no mutable config outside
 * that registry, so v2 accepts only an empty object here.
 */
export type DataSourcePropertyMutationConfigV2 = Readonly<
  Record<string, never>
>;

export interface PutDataSourcePropertyOperationV2 {
  readonly kind: "put_property";
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly expectedDataSourceRevision: number;
  readonly expectedPropertyRevision: number;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  /**
   * Updates preserve the existing option registry. Create, rename, and schema
   * updates use an empty object; option membership changes only through the
   * explicit option operations in the same ordered apply request.
   */
  readonly config: DataSourcePropertyMutationConfigV2;
  readonly beforePropertyId?: DataSourcePropertyId;
}

export interface DeleteDataSourcePropertyOperationV2 {
  readonly kind: "delete_property";
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly expectedDataSourceRevision: number;
  readonly expectedPropertyRevision: number;
}

export interface PutDataSourceOptionOperationV2 {
  readonly kind: "put_option";
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly optionId: DataSourceOptionId;
  readonly name: string;
  readonly color?: string;
  readonly expectedPropertyRevision: number;
}

export interface DeleteDataSourceOptionOperationV2 {
  readonly kind: "delete_option";
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly optionId: DataSourceOptionId;
  readonly expectedPropertyRevision: number;
}

export interface SetDataSourcePageValueOperationV2 {
  readonly kind: "set_value";
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly expectedValueRevision: number;
  readonly value: DatabaseJsonValue;
}

export interface SetDataSourcePageValuesOperationV2 {
  readonly kind: "set_values";
  readonly values: readonly Omit<SetDataSourcePageValueOperationV2, "kind">[];
}

export interface AddRemoveDataSourcePageValueOperationV2 {
  readonly kind: "add_remove_value";
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly add: readonly DataSourceOptionId[];
  readonly remove: readonly DataSourceOptionId[];
}

export interface TransferDataSourcePageOperationV2 {
  readonly kind: "transfer_page";
  readonly pageId: string;
  readonly expectedParentRevision: number;
  readonly expectedActiveMembershipRevision: number;
  readonly target:
    | { readonly kind: "library"; readonly libraryId: string }
    | { readonly kind: "page"; readonly pageId: string }
    | { readonly kind: "data_source"; readonly dataSourceId: DataSourceId };
}

export interface PutDatabaseViewOperationV2 {
  readonly kind: "put_view";
  readonly databaseId: DatabaseId;
  readonly dataSourceId: DataSourceId;
  readonly viewId: DatabaseViewId;
  readonly expectedRevision: number;
  readonly name: string;
  readonly viewKind: DatabaseViewKind;
  readonly config: DatabaseViewConfigV2;
  readonly isDefault: boolean;
  readonly beforeViewId?: DatabaseViewId | null;
}

export interface DeleteDatabaseViewOperationV2 {
  readonly kind: "delete_view";
  readonly databaseId: DatabaseId;
  readonly viewId: DatabaseViewId;
  readonly expectedRevision: number;
}

export interface PositionDatabaseViewPageOperationV2 {
  readonly kind: "position_page";
  readonly viewId: DatabaseViewId;
  readonly pageId: string;
  readonly expectedPositionRevision: number;
  readonly groupKey: string | null;
  readonly beforePageId?: string;
}

export interface PositionDatabaseViewPagesOperationV2 {
  readonly kind: "position_pages";
  readonly viewId: DatabaseViewId;
  readonly pages: readonly {
    readonly pageId: string;
    readonly expectedPositionRevision: number;
  }[];
  readonly groupKey: string | null;
  readonly beforePageId?: string;
}

export type DatabaseApplyOperationV2 =
  | PutDataSourcePropertyOperationV2
  | DeleteDataSourcePropertyOperationV2
  | PutDataSourceOptionOperationV2
  | DeleteDataSourceOptionOperationV2
  | SetDataSourcePageValueOperationV2
  | SetDataSourcePageValuesOperationV2
  | AddRemoveDataSourcePageValueOperationV2
  | TransferDataSourcePageOperationV2
  | PutDatabaseViewOperationV2
  | DeleteDatabaseViewOperationV2
  | PositionDatabaseViewPageOperationV2
  | PositionDatabaseViewPagesOperationV2;

export interface DatabaseApplyV2
  extends Omit<DatabaseApplyV1, "version" | "operations"> {
  readonly version: typeof DATABASE_MODULE_V2_CONTRACT_VERSION;
  readonly operations: readonly DatabaseApplyOperationV2[];
}

export interface DatabaseApplyReceiptV2 {
  readonly version: typeof DATABASE_MODULE_V2_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly duplicate: boolean;
  readonly operationKinds: readonly DatabaseApplyOperationV2["kind"][];
  readonly affectedDatabaseIds: readonly DatabaseId[];
  readonly affectedDataSourceIds: readonly DataSourceId[];
  readonly affectedPageIds: readonly string[];
  readonly affectedViewIds: readonly DatabaseViewId[];
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type DatabaseApplyResultV2 =
  | { readonly ok: true; readonly value: DatabaseApplyReceiptV2 }
  | { readonly ok: false; readonly error: DatabaseModuleErrorV2 };

export interface DatabaseModuleV2 {
  read(input: DatabaseModuleReadRequestV2): Promise<DatabaseModuleReadResultV2>;
  apply(input: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
}
