import type {
  DatabaseApplyOperationV2,
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleErrorV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
  DatabaseReadV2,
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
import type {
  CoreClientPort,
  CoreModuleError,
  DatabaseCommittedValue,
  DatabaseIntent,
  DatabaseRead,
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
  readPage(pageId: string): Promise<DatabaseModuleReadResultV2>;
  apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
}

export interface CoreLibraryDatabaseModuleAdapterInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly storeEpoch: string;
}

export interface CoreLibraryDatabaseModuleAdapter {
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
  return { kind: target.kind, view_id: target.viewId };
};

const toCoreRead = (read: DatabaseReadV2): DatabaseRead => ({
  target: toCoreTarget(read.target),
  mode: read.mode,
  filter: "filter" in read ? read.filter : undefined,
  sort: "sort" in read ? read.sort ?? null : null,
});

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

const toCoreIntent = (
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
        value_type: operation.valueType,
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
    case "set_value":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        data_source_id: operation.dataSourceId,
        property_id: operation.propertyId,
        expected_value_revision: operation.expectedValueRevision,
        value: operation.value,
      };
    case "set_values":
      return {
        kind: operation.kind,
        values: operation.values.map((value) => ({
          page_id: value.pageId,
          data_source_id: value.dataSourceId,
          property_id: value.propertyId,
          expected_value_revision: value.expectedValueRevision,
          value: value.value,
        })),
      };
    case "add_remove_value":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        data_source_id: operation.dataSourceId,
        property_id: operation.propertyId,
        add: operation.add,
        remove: operation.remove,
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
  ): Promise<DatabaseModuleReadResultV2> => {
    try {
      const snapshot = await input.client.databaseRead(read);
      if (snapshot.store_epoch !== input.storeEpoch) {
        throw new Error("Core Database read crossed its Store epoch boundary");
      }
      return parseDatabaseModuleReadResultV2({
        ok: true,
        value: {
          version: DATABASE_MODULE_V2_CONTRACT_VERSION,
          projectId: input.projectId,
          libraryId: input.libraryId,
          storeEpoch: snapshot.store_epoch,
          changeLogSeq: snapshot.event_head,
          value: snapshot.value,
        },
      });
    } catch (error) {
      return failure(error);
    }
  };

  return {
    read: async (request) => {
      const projectError = assertBoundProject(request.projectId);
      if (projectError) return { ok: false, error: projectError };
      return await readCore(toCoreRead(request.read));
    },
    readPage: async (pageId) => await readCore({
      target: { kind: "page", page_id: pageId },
      mode: "query",
      filter: undefined,
      sort: null,
    }),
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
      try {
        const committed = await input.client.databaseApply({
          operationId: request.operationId,
          intent: request.operations.map(toCoreIntent),
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
  read: async (request) => {
    try {
      const snapshot = await input.client.databaseRead(toCoreRead(request.read));
      if (snapshot.store_epoch !== input.storeEpoch) {
        throw new Error("Core Library Database read crossed its Store epoch boundary");
      }
      return parseLibraryDatabaseModuleReadResultV2({
        ok: true,
        value: {
          version: request.version,
          accessContext: { kind: "library" },
          libraryId: input.libraryId,
          storeEpoch: snapshot.store_epoch,
          changeLogSeq: snapshot.event_head,
          value: snapshot.value,
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
    try {
      const committed = await input.client.databaseApply({
        operationId: request.operationId,
        intent: request.operations.map(toCoreIntent),
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
