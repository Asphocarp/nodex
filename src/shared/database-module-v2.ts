import type {
  DatabaseApply as DatabaseApplyV1,
  DatabaseContainerRecord as DatabaseContainerRecordV1,
  DatabaseModuleReadSnapshot as DatabaseModuleReadSnapshotV1,
  DatabaseModuleReadRequest as DatabaseModuleReadRequestV1,
  DatabaseModuleError as DatabaseModuleErrorV1,
  DatabaseViewRecord as DatabaseViewRecordV1,
  DataSourcePageRow as DataSourcePageRowV1,
  DataSourcePageValue as DataSourcePageValueV1,
  DataSourceRecord as DataSourceRecordV1,
} from "./database-module";
import type {
  DatabaseId,
  DatabaseViewId,
  DataSourceId,
  DataSourceOptionId,
  DataSourcePropertyId,
} from "./database-identities";
import type { LocalCommitCommandSuccess } from "./local-commit-delivery";
import type {
  DatabaseJsonValue,
  DatabasePropertyOption,
  DatabasePropertyValueType,
  DatabaseViewConfigV4,
  DatabaseViewLayout,
  DatabaseViewPresentationOverride,
} from "./database-kernel";

export const DATABASE_MODULE_V2_CONTRACT_VERSION = 10 as const;
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

export type DatabasePropertySchemaV2 =
  | { readonly kind: "text" }
  | { readonly kind: "number" }
  | { readonly kind: "checkbox" }
  | { readonly kind: "select" }
  | { readonly kind: "multi_select" }
  | { readonly kind: "date" }
  | { readonly kind: "datetime" }
  | {
      readonly kind: "relation";
      readonly targetDataSourceId: DataSourceId;
      readonly cardinality: "one" | "many";
    };

export interface DatabasePropertyCapabilitiesV2 {
  readonly filterOperators: readonly (
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "is_empty"
    | "is_not_empty"
  )[];
  readonly sortable: boolean;
  readonly groupable: boolean;
}

export interface DataSourcePropertyRecordV2 {
  readonly propertyId: DataSourcePropertyId;
  readonly dataSourceId: DataSourceId;
  readonly name: string;
  readonly schema: DatabasePropertySchemaV2;
  readonly capabilities: DatabasePropertyCapabilitiesV2;
  /** Derived presentation discriminator; schema is the authority. */
  readonly valueType: DatabasePropertyValueType;
  /** Option registries are fetched through OptionWindow when an editor opens. */
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  readonly optionCount: number;
  readonly rankKey: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabaseViewRecordV2
  extends Omit<
    DatabaseViewRecordV1,
    "viewId" | "databaseId" | "dataSourceId" | "config"
  > {
  readonly viewId: DatabaseViewId;
  readonly databaseId: DatabaseId;
  readonly dataSourceId: DataSourceId;
  readonly config: DatabaseViewConfigV4;
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

export interface PageIntrinsicPropertyValueV2 {
  readonly key: string;
  readonly valueType: string;
  readonly value: DatabaseJsonValue;
  readonly revision: number;
}

export interface DataSourcePageRowV2
  extends Omit<DataSourcePageRowV1, "membership" | "values" | "position"> {
  readonly membership: Omit<
    DataSourcePageRowV1["membership"],
    "dataSourceId"
  > & {
    readonly dataSourceId: DataSourceId;
  };
  readonly values: Readonly<Record<string, DataSourcePageValueV2>>;
  readonly position: null | (NonNullable<DataSourcePageRowV1["position"]> & {
    /** Zero-based order inside this View group when supplied by native Core. */
    readonly order?: number;
  });
  /** Exact-head Page body projection supplied by native Database authority. */
  readonly bodyNfm?: string;
  /** Page-intrinsic properties needed by compatibility row projections. */
  readonly intrinsicProperties?: readonly PageIntrinsicPropertyValueV2[];
  /** Projection of the standard Parent Relation, independent from structural ownership. */
  readonly taskParent: {
    readonly parentPageId: string | null;
    readonly siblingRank: string | null;
    readonly valueRevision: number;
  };
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

export type DatabaseRelationTargetV2 =
  | {
      readonly kind: "visible";
      readonly edgeId: string;
      readonly pageId: string;
      readonly title: string;
      readonly lifecycle: string;
      readonly membershipState: string;
    }
  | { readonly kind: "restricted"; readonly edgeId: string };

export interface DatabaseRelationTargetWindowV2 {
  readonly valueRevision: number;
  readonly totalCount: number;
  readonly targets: readonly DatabaseRelationTargetV2[];
  readonly nextCursor: string | null;
  readonly projectionRevision: number;
}

export interface DatabasePropertyOptionWindowV2 {
  readonly options: readonly DatabasePropertyOption[];
  readonly nextCursor: string | null;
  readonly projectionRevision: number;
}

export interface DatabaseCatalogWindowV2 {
  readonly databases: readonly DatabaseContainerDescriptorV2[];
  readonly nextCursor: string | null;
  readonly projectionRevision: number;
}

export interface DatabaseRelationCandidateWindowV2 {
  readonly candidates: readonly {
    readonly pageId: string;
    readonly title: string;
  }[];
  readonly nextCursor: string | null;
  readonly projectionRevision: number;
}

export interface DatabaseViewPersonalPreferencesV2 {
  readonly presentationOverride: DatabaseViewPresentationOverride;
  readonly collapsedGroupKeys: readonly string[];
  /** Zero means that this Profile has no durable preference row yet. */
  readonly revision: number;
}

export type DatabaseReadV2 = (
  | {
      readonly target: { readonly kind: "project_default" };
      readonly mode: "database";
    }
  | {
      readonly target: { readonly kind: "project_default" };
      readonly mode: "catalog_window";
      readonly window?: { readonly after?: string | null; readonly first?: number };
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
      readonly mode: "relation_candidate_window";
      readonly query?: string;
      readonly window?: { readonly after?: string | null; readonly first?: number };
    }
  | {
      readonly target: {
        readonly kind: "view";
        readonly viewId: DatabaseViewId;
      };
      readonly mode: "view";
    }
  | {
      readonly target: {
        readonly kind: "view";
        readonly viewId: DatabaseViewId;
      };
      readonly mode: "view_personal_preferences";
    }
  | {
      readonly target: {
        readonly kind: "page_property";
        readonly pageId: string;
        readonly dataSourceId: DataSourceId;
        readonly propertyId: DataSourcePropertyId;
      };
      readonly mode: "relation_target_window";
      readonly window?: { readonly after?: string | null; readonly first?: number };
    }
  | {
      readonly target: {
        readonly kind: "property";
        readonly dataSourceId: DataSourceId;
        readonly propertyId: DataSourcePropertyId;
      };
      readonly mode: "option_window";
      readonly window?: { readonly after?: string | null; readonly first?: number };
    }
  ) & {
    /** Main/Core adapter read barrier for a previously returned local commit. */
    readonly minimumCommitSeq?: number;
  };

export type DatabaseReadValueV2 =
  | {
      readonly kind: "catalog_window";
      readonly value: DatabaseCatalogWindowV2;
    }
  | {
      readonly kind: "database";
      readonly value: DatabaseContainerDescriptorV2;
    }
  | { readonly kind: "data_source"; readonly value: DataSourceDescriptorV2 }
  | { readonly kind: "view"; readonly value: DatabaseViewRecordV2 }
  | {
      readonly kind: "view_personal_preferences";
      readonly value: DatabaseViewPersonalPreferencesV2;
    }
  | { readonly kind: "query"; readonly value: DatabaseViewQueryResultV2 }
  | {
      readonly kind: "data_source_query";
      readonly value: DataSourceQueryResultV2;
    }
  | {
      readonly kind: "relation_target_window";
      readonly value: DatabaseRelationTargetWindowV2;
    }
  | {
      readonly kind: "option_window";
      readonly value: DatabasePropertyOptionWindowV2;
    }
  | {
      readonly kind: "relation_candidate_window";
      readonly value: DatabaseRelationCandidateWindowV2;
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
 * Local Library reads always name a concrete Database, Data Source, or View.
 * `project_default` remains an execution-context concept and is excluded.
 */
export type LibraryDatabaseReadV2 = Exclude<
  DatabaseReadV2,
  { readonly target: { readonly kind: "project_default" } }
>;

export interface LibraryDatabaseModuleReadRequestV2 {
  readonly version: typeof DATABASE_MODULE_V2_CONTRACT_VERSION;
  readonly read: LibraryDatabaseReadV2;
}

export interface LibraryDatabaseModuleReadSnapshotV2
  extends Omit<DatabaseModuleReadSnapshotV2, "projectId"> {
  readonly accessContext: { readonly kind: "library" };
}

export type LibraryDatabaseModuleReadResultV2 =
  | { readonly ok: true; readonly value: LibraryDatabaseModuleReadSnapshotV2 }
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
  readonly schema: DatabasePropertySchemaV2;
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

export type DatabasePropertyValueInputV2 =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "checkbox"; readonly value: boolean }
  | { readonly kind: "select"; readonly optionId: DataSourceOptionId }
  | {
      readonly kind: "multi_select";
      readonly optionIds: readonly DataSourceOptionId[];
    }
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "datetime"; readonly value: string };

export type DatabasePropertySetDeltaV2 =
  | {
      readonly kind: "multi_select";
      readonly addOptionIds: readonly DataSourceOptionId[];
      readonly removeOptionIds: readonly DataSourceOptionId[];
    }
  | {
      readonly kind: "relation";
      readonly addPageIds: readonly string[];
      readonly removeEdgeIds: readonly string[];
    };

export interface DatabasePropertyValueMutationV2 {
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly edit:
    | {
        readonly kind: "replace";
        readonly expectedValueRevision: number;
        readonly value: DatabasePropertyValueInputV2;
      }
    | { readonly kind: "patch_set"; readonly delta: DatabasePropertySetDeltaV2 }
    | {
        readonly kind: "replace_one_relation";
        readonly expectedValueRevision: number;
        readonly targetPageId?: string;
      }
    | {
        readonly kind: "clear_many_relation";
        readonly expectedValueRevision: number;
      };
}

export interface EditDataSourcePageValuesOperationV2 {
  readonly kind: "edit_property_values";
  readonly edits: readonly DatabasePropertyValueMutationV2[];
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
  readonly defaultLayout: DatabaseViewLayout;
  readonly config: DatabaseViewConfigV4;
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
  readonly beforePageId?: string;
}

export interface PositionDatabaseViewPagesOperationV2 {
  readonly kind: "position_pages";
  readonly viewId: DatabaseViewId;
  readonly pages: readonly {
    readonly pageId: string;
    readonly expectedPositionRevision: number;
  }[];
  readonly beforePageId?: string;
}

export interface SetDatabaseTaskParentOperationV2 {
  readonly kind: "set_task_parent";
  readonly dataSourceId: DataSourceId;
  readonly pages: readonly {
    readonly pageId: string;
    /** Standard `task_parent` Relation value revision, including for roots. */
    readonly expectedValueRevision: number;
  }[];
  /** Missing means promote the ordered Page run to the root level. */
  readonly parentPageId?: string;
  /** Missing appends the run to the target parent's child order. */
  readonly beforePageId?: string;
}

export interface PutDatabaseViewPersonalPreferencesOperationV2 {
  readonly kind: "put_view_personal_preferences";
  readonly viewId: DatabaseViewId;
  readonly expectedRevision: number;
  readonly presentationOverride: DatabaseViewPresentationOverride;
  readonly collapsedGroupKeys: readonly string[];
}

export type DatabaseApplyOperationV2 =
  | PutDataSourcePropertyOperationV2
  | DeleteDataSourcePropertyOperationV2
  | PutDataSourceOptionOperationV2
  | DeleteDataSourceOptionOperationV2
  | EditDataSourcePageValuesOperationV2
  | TransferDataSourcePageOperationV2
  | PutDatabaseViewOperationV2
  | DeleteDatabaseViewOperationV2
  | PositionDatabaseViewPageOperationV2
  | PositionDatabaseViewPagesOperationV2
  | SetDatabaseTaskParentOperationV2
  | PutDatabaseViewPersonalPreferencesOperationV2;

export interface DatabaseApplyV2
  extends Omit<DatabaseApplyV1, "version" | "operations"> {
  readonly version: typeof DATABASE_MODULE_V2_CONTRACT_VERSION;
  readonly operations: readonly DatabaseApplyOperationV2[];
}

export type LibraryDatabaseApplyV2 = Omit<
  DatabaseApplyV2,
  "projectId" | "actor"
>;

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
  readonly commitSeq: number;
  readonly committedAt: string;
}

export interface LibraryDatabaseApplyReceiptV2
  extends Omit<DatabaseApplyReceiptV2, "projectId"> {
  readonly accessContext: { readonly kind: "library" };
}

export type LibraryDatabaseApplyResultV2 =
  | LocalCommitCommandSuccess<LibraryDatabaseApplyReceiptV2>
  | { readonly ok: false; readonly error: DatabaseModuleErrorV2 };

export type DatabaseApplyResultV2 =
  | LocalCommitCommandSuccess<DatabaseApplyReceiptV2>
  | { readonly ok: false; readonly error: DatabaseModuleErrorV2 };

export interface DatabaseModuleV2 {
  read(input: DatabaseModuleReadRequestV2): Promise<DatabaseModuleReadResultV2>;
  apply(input: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
}
