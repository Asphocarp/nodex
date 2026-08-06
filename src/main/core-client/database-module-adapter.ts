import type {
  DatabaseApplyOperationV2,
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleErrorV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
  DatabaseReadV2,
  DatabaseContainerDescriptorV2,
  DataSourceDescriptorV2,
  DataSourcePropertyRecordV2,
  LibraryDatabaseApplyResultV2,
  LibraryDatabaseApplyV2,
  LibraryDatabaseModuleReadRequestV2,
  LibraryDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import {
  parseDatabaseApplyResultV2,
  parseDatabaseModuleReadResultV2,
  parseLibraryDatabaseApplyResultV2,
  parseLibraryDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2-transport";
import { CoreModuleResponseError } from "./core-client";
import {
  applyCanonicalDatabaseValues,
  CanonicalDatabaseValueMutationError,
  type CanonicalDatabaseValuesApplyResult,
} from "./canonical-database-values";
import type {
  CoreClientPort,
  CoreModuleError,
  BlockRecordCommittedValue,
  DatabaseCommittedValue,
  DatabaseIntent,
  DatabaseRead,
  DatabaseReadSnapshot,
} from "./types";

export interface CoreDatabaseModuleAdapterInput {
  readonly client: CoreClientPort;
  readonly projectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
}

export interface CoreDatabaseModuleAdapter {
  read(
    request: DatabaseModuleReadRequestV2,
  ): Promise<DatabaseModuleReadResultV2>;
  readCore(
    read: DatabaseRead,
    minimumCommitSeq?: number,
  ): Promise<DatabaseReadSnapshot>;
  apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
}

export interface CoreLibraryDatabaseModuleAdapterInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly storeEpoch: string;
}

export interface CoreLibraryDatabaseModuleAdapter {
  readCore(
    read: DatabaseRead,
    minimumCommitSeq?: number,
  ): Promise<DatabaseReadSnapshot>;
  read(
    request: LibraryDatabaseModuleReadRequestV2,
  ): Promise<LibraryDatabaseModuleReadResultV2>;
  apply(request: LibraryDatabaseApplyV2): Promise<LibraryDatabaseApplyResultV2>;
}

const toCoreTarget = (target: DatabaseReadV2["target"]): DatabaseRead["target"] => {
  if (target.kind === "project_default") return target;
  if (target.kind === "database") {
    return { kind: target.kind, database_id: target.databaseId };
  }
  if (target.kind === "data_source") {
    return { kind: target.kind, data_source_id: target.dataSourceId };
  }
  if (target.kind === "property") {
    return {
      kind: target.kind,
      data_source_id: target.dataSourceId,
      property_id: target.propertyId,
    };
  }
  if (target.kind === "page_property") {
    return {
      kind: target.kind,
      page_id: target.pageId,
      data_source_id: target.dataSourceId,
      property_id: target.propertyId,
    };
  }
  return { kind: target.kind, view_id: target.viewId };
};

const toCoreFilter = (read: DatabaseReadV2): DatabaseRead["filter"] => {
  if (read.mode !== "relation_candidate_window") return null;
  if (read.query === undefined) return null;
  return { query: read.query };
};

const toCoreRead = (read: DatabaseReadV2): DatabaseRead => ({
  target: toCoreTarget(read.target),
  mode: read.mode,
  filter: toCoreFilter(read),
  sort: null,
  ...(
    read.mode === "relation_target_window"
    || read.mode === "relation_candidate_window"
    || read.mode === "option_window"
    || read.mode === "catalog_window"
    ? {
        window: {
          after: read.window?.after ?? null,
          first: read.window?.first ?? 100,
        },
      }
    : {}),
});

const MINIMUM_COMMIT_READ_ATTEMPTS = 40;
const MINIMUM_COMMIT_READ_DELAY_MS = 5;

const readDatabaseSnapshotAtLeast = async (
  client: CoreClientPort,
  read: DatabaseRead,
  storeEpoch: string,
  minimumCommitSeq = 0,
): Promise<DatabaseReadSnapshot> => {
  for (let attempt = 0; attempt < MINIMUM_COMMIT_READ_ATTEMPTS; attempt += 1) {
    const snapshot = await client.databaseRead(read);
    if (snapshot.store_epoch !== storeEpoch) {
      throw new Error("Core Database read crossed its Store epoch boundary");
    }
    if (snapshot.event_head >= minimumCommitSeq) return snapshot;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, MINIMUM_COMMIT_READ_DELAY_MS);
    });
  }
  throw new Error(
    `Core Database read did not reach local commit ${minimumCommitSeq}`,
  );
};

const mapCoreError = (
  error: CoreModuleError,
  operationId?: string,
): DatabaseModuleErrorV2 => {
  const code = (() => {
    switch (error.code) {
      case "invalid_input":
        return "invalid_request";
      case "not_found":
        return "resource_not_found";
      case "unauthorized":
        return "authorization_denied";
      case "revision_conflict":
      case "generation_conflict":
      case "head_conflict":
        return "revision_conflict";
      case "idempotency_key_reused":
        return "operation_id_collision";
      case "ambiguous":
        return "identity_conflict";
      case "stale_store_epoch":
        return "store_not_initialized";
      case "store_corrupt":
      case "invalid_document_schema":
        return "state_corrupt";
      case "schema_unsupported":
        return "unsupported_operation";
      default:
        return "unknown";
    }
  })() satisfies DatabaseModuleErrorV2["code"];
  return {
    code,
    message: error.message,
    retryable: error.retryable,
    ...(operationId ? { operationId } : {}),
  };
};

const failure = (
  error: unknown,
): Extract<DatabaseModuleReadResultV2, { readonly ok: false }> => {
  if (error instanceof CoreModuleResponseError) {
    return { ok: false, error: mapCoreError(error.coreError) };
  }
  return {
    ok: false,
    error: {
      code: "unknown",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    },
  };
};

const applyFailure = (
  error: unknown,
  operationId: string,
): Extract<DatabaseApplyResultV2, { readonly ok: false }> => {
  if (error instanceof CoreModuleResponseError) {
    return {
      ok: false,
      error: mapCoreError(error.coreError, operationId),
    };
  }
  return {
    ok: false,
    error: {
      code: "unknown",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
      operationId,
    },
  };
};

const canonicalValueOperations = (
  operations: readonly DatabaseApplyOperationV2[],
): readonly Extract<DatabaseApplyOperationV2, { readonly kind: "edit_property_values" }>[] | null => {
  if (operations.length === 0 || operations.some((operation) => operation.kind !== "edit_property_values")) {
    return null;
  }
  return operations as readonly Extract<
    DatabaseApplyOperationV2,
    { readonly kind: "edit_property_values" }
  >[];
};

const actorIdentity = (
  actor: Readonly<Record<string, unknown>> | undefined,
  libraryId: string,
): string => {
  const clientId = typeof actor?.clientId === "string" ? actor.clientId : "renderer";
  return `database:${libraryId}:${clientId}`;
};

const resolveDataSourceDatabaseIds = async (
  client: CoreClientPort,
  storeEpoch: string,
  dataSourceIds: readonly string[],
): Promise<readonly string[]> => {
  const databaseIds = await Promise.all(dataSourceIds.map(async (dataSourceId) => {
    const snapshot = await readDatabaseSnapshotAtLeast(
      client,
      {
        target: { kind: "data_source", data_source_id: dataSourceId },
        mode: "data_source",
        filter: null,
        sort: null,
      },
      storeEpoch,
    );
    if (snapshot.value.kind !== "data_source") {
      throw new Error("Core returned a non-Data Source metadata value");
    }
    const descriptor = requireRecord(snapshot.value.value, "Core Data Source descriptor");
    const source = requireRecord(descriptor.dataSource, "Core Data Source record");
    return requireString(source, "homeDatabaseId", "Core Data Source record");
  }));
  return [...new Set(databaseIds)].sort((left, right) => left.localeCompare(right));
};

const committedRevisions = (
  committed: BlockRecordCommittedValue,
): Readonly<Record<string, number>> => Object.fromEntries(
  committed.effects.flatMap((effect) => {
    if (effect.kind !== "property_values") return [];
    const value = requireRecord(effect.value, "Canonical property value effect");
    if (typeof value.blockId !== "string" || typeof value.revision !== "number") return [];
    return [[`page:${value.blockId}:record`, value.revision] as const];
  }),
);

type CoreDatabaseIntent = DatabaseIntent[number];

const toCoreTransferTarget = (
  target: Extract<
    DatabaseApplyOperationV2,
    { readonly kind: "transfer_page" }
  >["target"],
): Extract<CoreDatabaseIntent, { readonly kind: "transfer_page" }>["target"] => {
  if (target.kind === "library") {
    return { kind: target.kind, library_id: target.libraryId };
  }
  if (target.kind === "page") {
    return { kind: target.kind, page_id: target.pageId };
  }
  return { kind: target.kind, data_source_id: target.dataSourceId };
};

export const toCoreDatabaseIntent = (
  operation: DatabaseApplyOperationV2,
): CoreDatabaseIntent => {
  switch (operation.kind) {
    case "put_property":
      return {
        kind: operation.kind,
        data_source_id: operation.dataSourceId,
        property_id: operation.propertyId,
        expected_data_source_revision: operation.expectedDataSourceRevision,
        expected_property_revision: operation.expectedPropertyRevision,
        name: operation.name,
        schema: operation.schema.kind === "relation"
          ? {
              kind: "relation",
              target_data_source_id: operation.schema.targetDataSourceId,
            }
          : operation.schema,
        before_property_id: operation.beforePropertyId ?? null,
      };
    case "delete_property":
      return {
        kind: operation.kind,
        data_source_id: operation.dataSourceId,
        property_id: operation.propertyId,
        expected_data_source_revision: operation.expectedDataSourceRevision,
        expected_property_revision: operation.expectedPropertyRevision,
      };
    case "put_option":
      return {
        kind: operation.kind,
        data_source_id: operation.dataSourceId,
        property_id: operation.propertyId,
        option_id: operation.optionId,
        name: operation.name,
        color: operation.color ?? null,
        expected_property_revision: operation.expectedPropertyRevision,
      };
    case "delete_option":
      return {
        kind: operation.kind,
        data_source_id: operation.dataSourceId,
        property_id: operation.propertyId,
        option_id: operation.optionId,
        expected_property_revision: operation.expectedPropertyRevision,
      };
    case "edit_property_values":
      return {
        kind: operation.kind,
        edits: operation.edits.map((mutation) => ({
          address: {
            page_id: mutation.pageId,
            data_source_id: mutation.dataSourceId,
            property_id: mutation.propertyId,
          },
          edit: mutation.edit.kind === "replace"
            ? {
                kind: "replace" as const,
                expected_value_revision: mutation.edit.expectedValueRevision,
                value: (() => {
                  const value = mutation.edit.value;
                  if (value.kind === "select") {
                    return { kind: value.kind, option_id: value.optionId };
                  }
                  if (value.kind === "multi_select") {
                    return { kind: value.kind, option_ids: value.optionIds };
                  }
                  if (value.kind === "person") {
                    return { kind: value.kind, person_id: value.personId };
                  }
                  if (value.kind === "relation") {
                    return { kind: value.kind, page_ids: value.pageIds };
                  }
                  return value;
                })(),
              }
            : {
                kind: "patch_set" as const,
                delta: mutation.edit.delta.kind === "multi_select"
                  ? {
                      kind: "multi_select" as const,
                      add_option_ids: mutation.edit.delta.addOptionIds,
                      remove_option_ids: mutation.edit.delta.removeOptionIds,
                    }
                  : {
                      kind: "relation" as const,
                      add_page_ids: mutation.edit.delta.addPageIds,
                      remove_page_ids: mutation.edit.delta.removePageIds,
                    },
              },
        })),
      };
    case "transfer_page":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        expected_parent_revision: operation.expectedParentRevision,
        expected_active_membership_revision:
          operation.expectedActiveMembershipRevision,
        target: toCoreTransferTarget(operation.target),
      };
    case "put_view":
      return {
        kind: operation.kind,
        database_id: operation.databaseId,
        data_source_id: operation.dataSourceId,
        view_id: operation.viewId,
        expected_revision: operation.expectedRevision,
        name: operation.name,
        view_kind: operation.viewKind,
        config: operation.config,
        is_default: operation.isDefault,
        before_view_id: operation.beforeViewId ?? null,
      };
    case "delete_view":
      return {
        kind: operation.kind,
        database_id: operation.databaseId,
        view_id: operation.viewId,
        expected_revision: operation.expectedRevision,
      };
    case "position_page":
      return {
        kind: operation.kind,
        view_id: operation.viewId,
        page_id: operation.pageId,
        expected_position_revision: operation.expectedPositionRevision,
        group_key: operation.groupKey,
        before_page_id: operation.beforePageId ?? null,
      };
    case "position_pages":
      return {
        kind: operation.kind,
        view_id: operation.viewId,
        pages: operation.pages.map((page) => ({
          page_id: page.pageId,
          expected_position_revision: page.expectedPositionRevision,
        })),
        group_key: operation.groupKey,
        before_page_id: operation.beforePageId ?? null,
      };
  }
};

const validateCoreCommit = (
  committed: DatabaseCommittedValue,
  request: Pick<DatabaseApplyV2, "operationId" | "operations">,
): readonly DatabaseApplyOperationV2["kind"][] => {
  if (committed.receipt.operation_id !== request.operationId) {
    throw new Error("Core Database receipt crossed its operation boundary");
  }
  const operationKinds = request.operations.map((operation) => operation.kind);
  if (
    committed.value.operation_count !== request.operations.length
    || committed.receipt.change_log_seq !== committed.event_sequence
    || committed.receipt.operation_kinds.length !== operationKinds.length
    || committed.receipt.operation_kinds.some((kind, index) =>
      kind !== operationKinds[index]
    )
  ) {
    throw new Error("Core Database receipt evidence is inconsistent");
  }
  return operationKinds;
};

const coreReceiptEvidence = (
  committed: DatabaseCommittedValue,
  operationKinds: readonly DatabaseApplyOperationV2["kind"][],
) => ({
  operationId: committed.receipt.operation_id,
  duplicate: committed.receipt.duplicate,
  operationKinds,
  affectedDatabaseIds: committed.receipt.affected_database_ids,
  affectedDataSourceIds: committed.receipt.affected_data_source_ids,
  affectedPageIds: committed.receipt.affected_page_ids,
  affectedViewIds: committed.receipt.affected_view_ids,
  committedRevisions: committed.receipt.committed_revisions,
  changeLogSeq: committed.receipt.change_log_seq,
  committedAt: committed.receipt.committed_at,
});

interface CoreWindowSlice {
  readonly items: readonly unknown[];
  readonly next_cursor?: string | null;
}

const readAllCoreWindow = async (
  client: CoreClientPort,
  maximumItems: number,
  createRead: (after: string | null) => DatabaseRead,
  selectWindow: (snapshot: DatabaseReadSnapshot) => CoreWindowSlice,
): Promise<readonly unknown[]> => {
  const items: unknown[] = [];
  let after: string | null = null;
  do {
    const snapshot = await client.databaseRead(createRead(after));
    const window = selectWindow(snapshot);
    if (window.items.length > maximumItems - items.length) {
      throw new Error("Fixed Database schema collection exceeded its Core bound");
    }
    items.push(...window.items);
    after = window.next_cursor ?? null;
  } while (after !== null);
  return items;
};

const requireRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${label} is not an object`);
};

const requireString = (
  value: Record<string, unknown>,
  key: string,
  label: string,
): string => {
  const result = value[key];
  if (typeof result === "string" && result.length > 0) return result;
  throw new Error(`${label} has no ${key}`);
};

const canonicalValueDatabaseIds = (
  operations: readonly Extract<DatabaseApplyOperationV2, { readonly kind: "edit_property_values" }>[],
): readonly string[] => [...new Set(
  operations.flatMap((operation) => operation.edits.map((edit) => edit.dataSourceId)),
)].sort((left, right) => left.localeCompare(right));

const canonicalValueReceipt = (
  committed: BlockRecordCommittedValue,
  operationKinds: readonly DatabaseApplyOperationV2["kind"][],
  databaseIds: readonly string[],
  dataSourceIds: readonly string[],
  pageIds: readonly string[],
) => ({
  operationId: committed.operation_id,
  duplicate: committed.duplicate,
  operationKinds,
  affectedDatabaseIds: databaseIds,
  affectedDataSourceIds: dataSourceIds,
  affectedPageIds: pageIds,
  affectedViewIds: [],
  committedRevisions: committedRevisions(committed),
  changeLogSeq: committed.cursor.commit_seq,
  committedAt: committed.committed_at,
});

const applyCanonicalValueOperations = async (input: {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly operationId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly operations: readonly Extract<DatabaseApplyOperationV2, { readonly kind: "edit_property_values" }>[];
}): Promise<CanonicalDatabaseValuesApplyResult> => applyCanonicalDatabaseValues(input);

export const mapCorePropertyDescriptor = (
  input: unknown,
): DataSourcePropertyRecordV2 => {
  const property = requireRecord(input, "Core Property descriptor");
  const schema = requireRecord(property.schema, "Core Property schema");
  const schemaKind = requireString(schema, "kind", "Core Property schema");
  if (![
    "text",
    "number",
    "checkbox",
    "select",
    "multi_select",
    "date",
    "datetime",
    "person",
    "relation",
  ].includes(schemaKind)) {
    throw new Error("Core Property schema is unsupported");
  }
  const capabilities = requireRecord(
    property.capabilities,
    "Core Property capabilities",
  );
  return {
    propertyId: requireString(property, "property_id", "Core Property"),
    dataSourceId: requireString(property, "data_source_id", "Core Property"),
    name: requireString(property, "name", "Core Property"),
    schema: schemaKind === "relation"
      ? {
          kind: "relation",
          targetDataSourceId: requireString(
            schema,
            "target_data_source_id",
            "Core Relation schema",
          ),
        }
      : { kind: schemaKind },
    capabilities: {
      replace: capabilities.replace === true,
      patchSetMember: capabilities.patch_set_member === "option"
          || capabilities.patch_set_member === "page"
        ? capabilities.patch_set_member
        : null,
      filterOperators: Array.isArray(capabilities.filter_operators)
        ? capabilities.filter_operators as NonNullable<DataSourcePropertyRecordV2["capabilities"]>["filterOperators"]
        : [],
      sortable: capabilities.sortable === true,
      groupable: capabilities.groupable === true,
    },
    valueType: schemaKind,
    config: {},
    optionCount: Number(property.option_count),
    rankKey: requireString(property, "rank_key", "Core Property"),
    lifecycle: requireString(property, "lifecycle", "Core Property") as DataSourcePropertyRecordV2["lifecycle"],
    revision: Number(property.revision),
    createdAt: requireString(property, "created_at", "Core Property"),
    updatedAt: requireString(property, "updated_at", "Core Property"),
  } as unknown as DataSourcePropertyRecordV2;
};

const hydrateCoreProperty = async (
  _client: CoreClientPort,
  input: unknown,
): Promise<DataSourcePropertyRecordV2> => mapCorePropertyDescriptor(input);

const hydrateCoreDataSource = async (
  client: CoreClientPort,
  compact: unknown,
): Promise<DataSourceDescriptorV2> => {
  const descriptor = requireRecord(compact, "Core Data Source descriptor");
  const dataSource = requireRecord(
    descriptor.dataSource,
    "Core Data Source record",
  );
  const dataSourceId = requireString(
    dataSource,
    "dataSourceId",
    "Core Data Source",
  );
  const compactProperties = await readAllCoreWindow(
    client,
    200,
    (after) => ({
      target: { kind: "data_source", data_source_id: dataSourceId },
      mode: "property_window",
      filter: null,
      sort: null,
      page_ids: null,
      window: { after, first: 200 },
    }),
    (snapshot) => {
      if (snapshot.value.kind !== "property_window") {
        throw new Error("Core returned a non-Property Database window");
      }
      return snapshot.value.properties;
    },
  );
  const properties: DataSourcePropertyRecordV2[] = [];
  for (const property of compactProperties) {
    properties.push(await hydrateCoreProperty(client, property));
  }
  return {
    dataSource: dataSource as unknown as DataSourceDescriptorV2["dataSource"],
    properties,
  };
};

const hydrateCoreDatabase = async (
  client: CoreClientPort,
  compact: unknown,
): Promise<DatabaseContainerDescriptorV2> => {
  const descriptor = requireRecord(compact, "Core Database descriptor");
  const database = requireRecord(descriptor.database, "Core Database record");
  const databaseId = requireString(database, "databaseId", "Core Database");
  const [dataSources, views] = await Promise.all([
    readAllCoreWindow(
      client,
      200,
      (after) => ({
        target: { kind: "database", database_id: databaseId },
        mode: "data_source_window",
        filter: null,
        sort: null,
        page_ids: null,
        window: { after, first: 200 },
      }),
      (snapshot) => {
        if (snapshot.value.kind !== "data_source_window") {
          throw new Error("Core returned a non-Data Source Database window");
        }
        return snapshot.value.data_sources;
      },
    ),
    readAllCoreWindow(
      client,
      200,
      (after) => ({
        target: { kind: "database", database_id: databaseId },
        mode: "view_descriptor_window",
        filter: null,
        sort: null,
        page_ids: null,
        window: { after, first: 200 },
      }),
      (snapshot) => {
        if (snapshot.value.kind !== "view_descriptor_window") {
          throw new Error("Core returned a non-View Database window");
        }
        return snapshot.value.views;
      },
    ),
  ]);
  return {
    database:
      database as unknown as DatabaseContainerDescriptorV2["database"],
    dataSources:
      dataSources as unknown as DatabaseContainerDescriptorV2["dataSources"],
    views: views as unknown as DatabaseContainerDescriptorV2["views"],
  };
};

const hydrateCoreReadValue = async (
  client: CoreClientPort,
  value: DatabaseReadSnapshot["value"],
): Promise<unknown> => {
  if (value.kind === "catalog_window") {
    const databases: DatabaseContainerDescriptorV2[] = [];
    for (const compact of value.databases.items) {
      databases.push(await hydrateCoreDatabase(client, compact));
    }
    return {
      kind: value.kind,
      value: {
        databases,
        nextCursor: value.databases.next_cursor ?? null,
        projectionRevision: value.databases.authority.projection_revision,
      },
    };
  }
  if (value.kind === "database") {
    return {
      kind: value.kind,
      value: await hydrateCoreDatabase(client, value.value),
    };
  }
  if (value.kind === "data_source") {
    return {
      kind: value.kind,
      value: await hydrateCoreDataSource(client, value.value),
    };
  }
  if (value.kind === "relation_target_window") {
    return {
      kind: value.kind,
      value: {
        valueRevision: value.value.value_revision,
        totalCount: value.value.total_count,
        targets: value.value.targets.items.map((target) => target.kind === "restricted"
          ? { kind: "restricted" as const }
          : {
              kind: "visible" as const,
              pageId: target.page_id,
              title: target.title,
              lifecycle: target.lifecycle,
              membershipState: target.membership_state,
            }),
        nextCursor: value.value.targets.next_cursor ?? null,
        projectionRevision: value.value.targets.authority.projection_revision,
      },
    };
  }
  if (value.kind === "option_window") {
    return {
      kind: value.kind,
      value: {
        options: value.options.items.map((candidate) => {
          const option = requireRecord(candidate, "Core Property option");
          const color = option.color;
          if (color !== undefined && color !== null && typeof color !== "string") {
            throw new Error("Core Property option color is invalid");
          }
          return {
            id: requireString(option, "id", "Core Property option"),
            name: requireString(option, "name", "Core Property option"),
            ...(typeof color === "string" ? { color } : {}),
          };
        }),
        nextCursor: value.options.next_cursor ?? null,
        projectionRevision: value.options.authority.projection_revision,
      },
    };
  }
  if (value.kind === "relation_candidate_window") {
    return {
      kind: value.kind,
      value: {
        candidates: value.candidates.items.map((candidate) => ({
          pageId: candidate.page_id,
          title: candidate.title,
        })),
        nextCursor: value.candidates.next_cursor ?? null,
        projectionRevision: value.candidates.authority.projection_revision,
      },
    };
  }
  return value;
};

export const createCoreDatabaseModuleAdapter = (
  input: CoreDatabaseModuleAdapterInput,
): CoreDatabaseModuleAdapter => {
  const assertBoundProject = (projectId: string): DatabaseModuleErrorV2 | null => {
    if (projectId === input.projectId) return null;
    return {
      code: "authorization_denied",
      message: "Database request escaped its bound Project",
      retryable: false,
    };
  };

  const readCore = async (
    read: DatabaseRead,
    minimumCommitSeq = 0,
  ): Promise<DatabaseModuleReadResultV2> => {
    try {
      const snapshot = await readDatabaseSnapshotAtLeast(
        input.client,
        read,
        input.storeEpoch,
        minimumCommitSeq,
      );
      const value = await hydrateCoreReadValue(input.client, snapshot.value);
      return parseDatabaseModuleReadResultV2({
        ok: true,
        value: {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId: input.projectId,
          libraryId: input.libraryId,
          storeEpoch: snapshot.store_epoch,
          changeLogSeq: snapshot.event_head,
          value,
        },
      });
    } catch (error) {
      return failure(error);
    }
  };

  return {
    readCore: (read, minimumCommitSeq) => readDatabaseSnapshotAtLeast(
      input.client,
      read,
      input.storeEpoch,
      minimumCommitSeq,
    ),
    read: async (request) => {
      const projectError = assertBoundProject(request.projectId);
      if (projectError) return { ok: false, error: projectError };
      return await readCore(
        toCoreRead(request.read),
        request.read.minimumCommitSeq,
      );
    },
    apply: async (request) => {
      const projectError = assertBoundProject(request.projectId);
      if (projectError) {
        return {
          ok: false,
          error: { ...projectError, operationId: request.operationId },
        };
      }
      if (request.storeEpoch !== input.storeEpoch) {
        return {
          ok: false,
          error: {
            code: "store_not_initialized",
            message: "Database apply targets a stale Store epoch",
            retryable: true,
            operationId: request.operationId,
          },
        };
      }
      const valueOperations = canonicalValueOperations(request.operations);
      if (valueOperations) {
        try {
          const dataSourceIds = canonicalValueDatabaseIds(valueOperations);
          const databaseIds = await resolveDataSourceDatabaseIds(
            input.client,
            input.storeEpoch,
            dataSourceIds,
          );
          const result = await applyCanonicalValueOperations({
            client: input.client,
            libraryId: input.libraryId,
            storeEpoch: input.storeEpoch,
            operationId: request.operationId,
            actorId: actorIdentity(request.actor, input.libraryId),
            sessionId: `project:${request.projectId}`,
            operations: valueOperations,
          });
          return parseDatabaseApplyResultV2({
            ok: true,
            value: {
              version: request.version,
              projectId: input.projectId,
              libraryId: input.libraryId,
              storeEpoch: result.committed.cursor.store_epoch,
              ...canonicalValueReceipt(
                result.committed,
                request.operations.map((operation) => operation.kind),
                databaseIds,
                result.dataSourceIds,
                result.pageIds,
              ),
            },
          });
        } catch (error) {
          if (error instanceof CanonicalDatabaseValueMutationError) {
            return {
              ok: false,
              error: {
                code: error.code,
                message: error.message,
                retryable: error.retryable,
                operationId: request.operationId,
              },
            };
          }
          return applyFailure(error, request.operationId);
        }
      }
      try {
        const committed = await input.client.databaseApply({
          operationId: request.operationId,
          intent: request.operations.map(toCoreDatabaseIntent),
        });
        if (committed.store_epoch !== input.storeEpoch) {
          throw new Error("Core Database apply crossed its Store epoch boundary");
        }
        const operationKinds = validateCoreCommit(committed, request);
        return parseDatabaseApplyResultV2({
          ok: true,
          value: {
            version: request.version,
            projectId: input.projectId,
            libraryId: input.libraryId,
            storeEpoch: committed.store_epoch,
            ...coreReceiptEvidence(committed, operationKinds),
          },
        });
      } catch (error) {
        return applyFailure(error, request.operationId);
      }
    },
  };
};

export const createCoreLibraryDatabaseModuleAdapter = (
  input: CoreLibraryDatabaseModuleAdapterInput,
): CoreLibraryDatabaseModuleAdapter => ({
  readCore: (read, minimumCommitSeq) => readDatabaseSnapshotAtLeast(
    input.client,
    read,
    input.storeEpoch,
    minimumCommitSeq,
  ),
  read: async (request) => {
    try {
      const snapshot = await readDatabaseSnapshotAtLeast(
        input.client,
        toCoreRead(request.read),
        input.storeEpoch,
        request.read.minimumCommitSeq,
      );
      return parseLibraryDatabaseModuleReadResultV2({
        ok: true,
        value: {
          version: request.version,
          accessContext: { kind: "library" },
          libraryId: input.libraryId,
          storeEpoch: snapshot.store_epoch,
          changeLogSeq: snapshot.event_head,
          value: await hydrateCoreReadValue(input.client, snapshot.value),
        },
      });
    } catch (error) {
      return failure(error);
    }
  },
  apply: async (request) => {
    if (request.storeEpoch !== input.storeEpoch) {
      return {
        ok: false,
        error: {
          code: "store_not_initialized",
          message: "Library Database apply targets a stale Store epoch",
          retryable: true,
          operationId: request.operationId,
        },
      };
    }
    const valueOperations = canonicalValueOperations(request.operations);
    if (valueOperations) {
      try {
        const dataSourceIds = canonicalValueDatabaseIds(valueOperations);
        const databaseIds = await resolveDataSourceDatabaseIds(
          input.client,
          input.storeEpoch,
          dataSourceIds,
        );
        const result = await applyCanonicalValueOperations({
          client: input.client,
          libraryId: input.libraryId,
          storeEpoch: input.storeEpoch,
          operationId: request.operationId,
          actorId: actorIdentity(undefined, input.libraryId),
          sessionId: `library:${input.libraryId}`,
          operations: valueOperations,
        });
        return parseLibraryDatabaseApplyResultV2({
          ok: true,
          value: {
            version: DATABASE_MODULE_V2_CONTRACT_VERSION,
            accessContext: { kind: "library" },
            libraryId: input.libraryId,
            storeEpoch: result.committed.cursor.store_epoch,
            ...canonicalValueReceipt(
              result.committed,
              request.operations.map((operation) => operation.kind),
              databaseIds,
              result.dataSourceIds,
              result.pageIds,
            ),
          },
        });
      } catch (error) {
        if (error instanceof CanonicalDatabaseValueMutationError) {
          return {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              operationId: request.operationId,
            },
          };
        }
        return applyFailure(error, request.operationId);
      }
    }
    try {
      const committed = await input.client.databaseApply({
        operationId: request.operationId,
        intent: request.operations.map(toCoreDatabaseIntent),
      });
      if (committed.store_epoch !== input.storeEpoch) {
        throw new Error("Core Library Database apply crossed its Store epoch boundary");
      }
      const operationKinds = validateCoreCommit(committed, request);
      return parseLibraryDatabaseApplyResultV2({
        ok: true,
        value: {
          version: request.version,
          accessContext: { kind: "library" },
          libraryId: input.libraryId,
          storeEpoch: committed.store_epoch,
          ...coreReceiptEvidence(committed, operationKinds),
        },
      });
    } catch (error) {
      return applyFailure(error, request.operationId);
    }
  },
});
