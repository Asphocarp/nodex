import type {
  DatabaseApplyOperationV2,
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseListMoveUndoRecipeV2,
  DatabaseModuleErrorV2,
  DatabaseOperationOutcomeV2,
  DatabasePropertyValueInputV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
  DatabaseReadV2,
  DatabaseReadValueV2,
  DatabaseContainerDescriptorV2,
  DataSourceDescriptorV2,
  DataSourcePropertyRecordV2,
  LibraryDatabaseApplyResultV2,
  LibraryDatabaseApplyV2,
  LibraryDatabaseModuleReadRequestV2,
  LibraryDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import type { DatabaseViewConfigV4 } from "../../shared/database-kernel";
import {
  parseDatabaseApplyResultV2,
  parseDatabaseModuleReadResultV2,
  parseDataSourcePropertyRecordV2,
  parseLibraryDatabaseApplyResultV2,
  parseLibraryDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2-transport";
import { CoreModuleResponseError } from "./core-client";
import {
  applyResultCursor,
  applyResultDelivery,
  applyResultStoreEpoch,
  rendererLocalCommitApply,
} from "./types";
import {
  fromCoreDatabaseViewPresentationOverride,
  toCoreDatabaseViewPresentationOverride,
} from "./database-presentation-adapter";
import type {
  CoreClientPort,
  CoreModuleError,
  DatabaseApplyResult,
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
  read(request: DatabaseModuleReadRequestV2): Promise<DatabaseModuleReadResultV2>;
  readCore(read: DatabaseRead, minimumCommitSeq?: number): Promise<DatabaseReadSnapshot>;
  apply(request: DatabaseApplyV2): Promise<DatabaseApplyResultV2>;
}

export interface CoreLibraryDatabaseModuleAdapterInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly storeEpoch: string;
}

export interface CoreLibraryDatabaseModuleAdapter {
  readCore(read: DatabaseRead, minimumCommitSeq?: number): Promise<DatabaseReadSnapshot>;
  read(request: LibraryDatabaseModuleReadRequestV2): Promise<LibraryDatabaseModuleReadResultV2>;
  apply(request: LibraryDatabaseApplyV2): Promise<LibraryDatabaseApplyResultV2>;
}

const coreWindow = (
  window: { readonly after?: string | null; readonly first?: number } | undefined,
) => ({
  after: window?.after ?? null,
  first: window?.first ?? 100,
});

const toCoreRead = (read: DatabaseReadV2): DatabaseRead => {
  switch (read.mode) {
    case "catalog_window":
      return { kind: "catalog_window", window: coreWindow(read.window) };
    case "database":
      return {
        kind: "database",
        target:
          read.target.kind === "project_default"
            ? { kind: "project_default" }
            : { kind: "database", database_id: read.target.databaseId },
      };
    case "page_key_prefix_preview":
      return {
        kind: "page_key_prefix_preview",
        database_id: read.target.databaseId ?? null,
        name_hint: read.nameHint,
        requested_prefix: read.requestedPrefix ?? null,
      };
    case "page_key_namespace":
      return {
        kind: "page_key_namespace",
        database_id: read.target.databaseId,
      };
    case "data_source":
      return {
        kind: "data_source",
        data_source_id: read.target.dataSourceId,
      };
    case "relation_candidate_window":
      return {
        kind: "relation_candidate_window",
        data_source_id: read.target.dataSourceId,
        query: read.query ?? null,
        window: coreWindow(read.window),
      };
    case "view":
      return { kind: "view", view_id: read.target.viewId };
    case "view_personal_presentation":
      return {
        kind: "view_personal_presentation",
        view_id: read.target.viewId,
      };
    case "view_collapsed_occurrences":
      return {
        kind: "view_collapsed_occurrences",
        view_id: read.target.viewId,
      };
    case "relation_target_window":
      return {
        kind: "relation_target_window",
        address: {
          page_id: read.target.pageId,
          data_source_id: read.target.dataSourceId,
          property_id: read.target.propertyId,
        },
        window: coreWindow(read.window),
      };
    case "option_window":
      return {
        kind: "option_window",
        data_source_id: read.target.dataSourceId,
        property_id: read.target.propertyId,
        window: coreWindow(read.window),
      };
  }
};

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
    if (snapshot.commit_head >= minimumCommitSeq) return snapshot;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, MINIMUM_COMMIT_READ_DELAY_MS);
    });
  }
  throw new Error(`Core Database read did not reach local commit ${minimumCommitSeq}`);
};

export const mapCoreDatabaseModuleError = (
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
      case "resource_exhausted":
        return "resource_exhausted";
      case "conflict":
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

const failure = (error: unknown): Extract<DatabaseModuleReadResultV2, { readonly ok: false }> => {
  if (error instanceof CoreModuleResponseError) {
    return { ok: false, error: mapCoreDatabaseModuleError(error.coreError) };
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
      error: mapCoreDatabaseModuleError(error.coreError, operationId),
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
  target: Extract<DatabaseApplyOperationV2, { readonly kind: "transfer_page" }>["target"],
): Extract<CoreDatabaseIntent, { readonly kind: "transfer_page" }>["target"] => {
  if (target.kind === "library") {
    return { kind: target.kind, library_id: target.libraryId };
  }
  if (target.kind === "page") {
    return { kind: target.kind, page_id: target.pageId };
  }
  return { kind: target.kind, data_source_id: target.dataSourceId };
};

const toCorePropertyValueInput = (
  value: DatabasePropertyValueInputV2,
): Extract<
  CoreDatabaseIntent,
  { readonly kind: "edit_property_values" }
>["edits"][number]["edit"] extends infer Edit
  ? Edit extends { readonly kind: "replace"; readonly value: infer Input }
    ? Input
    : never
  : never => {
  if (value.kind === "select") {
    return { kind: value.kind, option_id: value.optionId };
  }
  if (value.kind === "multi_select") {
    return { kind: value.kind, option_ids: value.optionIds };
  }
  return value;
};

const toCoreDatabaseListMoveUndoRecipe = (
  recipe: DatabaseListMoveUndoRecipeV2,
): Extract<CoreDatabaseIntent, { readonly kind: "undo_list_occurrence_move" }>["recipe"] => ({
  view_id: recipe.viewId,
  data_source_id: recipe.dataSourceId,
  property_states: recipe.propertyStates.map((state) => ({
    page_id: state.pageId,
    property_id: state.propertyId,
    before_value: toCorePropertyValueInput(state.beforeValue),
    after_value: toCorePropertyValueInput(state.afterValue),
  })),
  post_parent_guards: recipe.postParentGuards.map((guard) => ({
    page_id: guard.pageId,
    parent_page_id: guard.parentPageId,
  })),
  post_before_page_id: recipe.postBeforePageId,
  post_order_guard: recipe.postOrderGuard,
  restore_runs: recipe.restoreRuns.map((run) => ({
    page_ids: run.pageIds,
    parent_page_id: run.parentPageId,
    before_page_id: run.beforePageId,
  })),
});

export const toCoreDatabaseIntent = (operation: DatabaseApplyOperationV2): CoreDatabaseIntent => {
  switch (operation.kind) {
    case "rename_page_key_prefix":
      return {
        kind: operation.kind,
        database_id: operation.databaseId,
        expected_revision: operation.expectedRevision,
        prefix: operation.prefix,
      };
    case "put_property":
      return {
        kind: operation.kind,
        data_source_id: operation.dataSourceId,
        property_id: operation.propertyId,
        expected_data_source_revision: operation.expectedDataSourceRevision,
        expected_property_revision: operation.expectedPropertyRevision,
        name: operation.name,
        schema:
          operation.schema.kind === "relation"
            ? {
                kind: "relation",
                target_data_source_id: operation.schema.targetDataSourceId,
                cardinality: operation.schema.cardinality,
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
          edit:
            mutation.edit.kind === "replace"
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
                    return value;
                  })(),
                }
              : mutation.edit.kind === "replace_one_relation"
                ? {
                    kind: "replace_one_relation" as const,
                    expected_value_revision: mutation.edit.expectedValueRevision,
                    target_page_id: mutation.edit.targetPageId ?? null,
                  }
                : mutation.edit.kind === "clear_many_relation"
                  ? {
                      kind: "clear_many_relation" as const,
                      expected_value_revision: mutation.edit.expectedValueRevision,
                    }
                  : {
                      kind: "patch_set" as const,
                      delta:
                        mutation.edit.delta.kind === "multi_select"
                          ? {
                              kind: "multi_select" as const,
                              add_option_ids: mutation.edit.delta.addOptionIds,
                              remove_option_ids: mutation.edit.delta.removeOptionIds,
                            }
                          : {
                              kind: "relation" as const,
                              add_page_ids: mutation.edit.delta.addPageIds,
                              remove_edge_ids: mutation.edit.delta.removeEdgeIds,
                            },
                    },
        })),
      };
    case "transfer_page":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        expected_parent_revision: operation.expectedParentRevision,
        expected_active_membership_revision: operation.expectedActiveMembershipRevision,
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
        layout: operation.defaultLayout,
        definition: {
          filter: operation.config.filter,
          presentation: operation.config.presentation,
        },
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
        before_page_id: operation.beforePageId ?? null,
      };
    case "set_task_parent":
      return {
        kind: operation.kind,
        data_source_id: operation.dataSourceId,
        pages: operation.pages.map((page) => ({
          page_id: page.pageId,
          expected_value_revision: page.expectedValueRevision,
        })),
        parent_page_id: operation.parentPageId ?? null,
        before_page_id: operation.beforePageId ?? null,
      };
    case "move_list_occurrences":
      return {
        kind: operation.kind,
        view_id: operation.viewId,
        presentation_override: toCoreDatabaseViewPresentationOverride(
          operation.presentationOverride,
        ),
        expected_projection: {
          scope_key: operation.expectedProjection.scopeKey,
          schema_version: operation.expectedProjection.schemaVersion,
          revision: operation.expectedProjection.revision,
          covered_commit_seq: operation.expectedProjection.coveredCommitSeq,
          effect_hash: operation.expectedProjection.effectHash,
        },
        initiator_occurrence_key: operation.initiatorOccurrenceKey,
        selection:
          operation.selection.kind === "explicit"
            ? {
                kind: operation.selection.kind,
                occurrence_keys: operation.selection.occurrenceKeys,
              }
            : {
                kind: operation.selection.kind,
                excluded_occurrence_keys: operation.selection.excludedOccurrenceKeys,
              },
        target:
          operation.target.kind === "page"
            ? {
                kind: operation.target.kind,
                occurrence_key: operation.target.occurrenceKey,
                edge: operation.target.edge,
              }
            : operation.target.kind === "group"
              ? {
                  kind: operation.target.kind,
                  occurrence_key: operation.target.occurrenceKey,
                }
              : { kind: operation.target.kind },
      };
    case "undo_list_occurrence_move":
      return {
        kind: operation.kind,
        recipe: toCoreDatabaseListMoveUndoRecipe(operation.recipe),
      };
    case "put_view_personal_presentation":
      return {
        kind: operation.kind,
        view_id: operation.viewId,
        expected_revision: operation.expectedRevision,
        presentation_override: toCoreDatabaseViewPresentationOverride(
          operation.presentationOverride,
        ),
      };
    case "set_view_occurrence_disclosure":
      return {
        kind: operation.kind,
        view_id: operation.viewId,
        target: {
          kind: operation.target.kind,
          occurrence_key: operation.target.occurrenceKey,
        },
        collapsed: operation.collapsed,
      };
  }
};

const validateCoreCommit = (
  committed: DatabaseApplyResult,
  request: Pick<DatabaseApplyV2, "operationId" | "operations">,
): readonly DatabaseApplyOperationV2["kind"][] => {
  if (committed.receipt.operation_id !== request.operationId) {
    throw new Error("Core Database receipt crossed its operation boundary");
  }
  const operationKinds = request.operations.map((operation) => operation.kind);
  const semanticCommitSeq = applyResultCursor(committed);
  const delivery = applyResultDelivery(committed);
  if (
    committed.outcome.operation_count !== request.operations.length ||
    committed.receipt.commit_seq !== semanticCommitSeq ||
    (delivery !== undefined && delivery.manifest.identity.commit_seq !== semanticCommitSeq) ||
    committed.receipt.operation_kinds.length !== operationKinds.length ||
    committed.receipt.operation_kinds.some((kind, index) => kind !== operationKinds[index])
  ) {
    throw new Error("Core Database receipt evidence is inconsistent");
  }
  return operationKinds;
};

type CoreDatabaseOperationOutcome = NonNullable<
  DatabaseApplyResult["receipt"]["operation_outcomes"]
>[number];
type CoreDatabaseListMoveUndoRecipe = Extract<
  CoreDatabaseOperationOutcome,
  { readonly kind: "list_occurrence_move" }
>["undo_recipe"];

const fromCorePropertyValueInput = (
  value: CoreDatabaseListMoveUndoRecipe["property_states"][number]["before_value"],
  propertyId: ReturnType<typeof parseDataSourcePropertyId>,
): DatabasePropertyValueInputV2 => {
  if (value.kind === "select") {
    return {
      kind: value.kind,
      optionId: parseDataSourceOptionId({
        propertyId,
        value: value.option_id,
      }),
    };
  }
  if (value.kind === "multi_select") {
    return {
      kind: value.kind,
      optionIds: value.option_ids.map((optionId) =>
        parseDataSourceOptionId({ propertyId, value: optionId }),
      ),
    };
  }
  return value;
};

const fromCoreDatabaseListMoveUndoRecipe = (
  recipe: CoreDatabaseListMoveUndoRecipe,
): DatabaseListMoveUndoRecipeV2 => ({
  viewId: parseDatabaseViewId(recipe.view_id),
  dataSourceId: parseDataSourceId(recipe.data_source_id),
  propertyStates: recipe.property_states.map((state) => {
    const propertyId = parseDataSourcePropertyId(state.property_id);
    return {
      pageId: state.page_id,
      propertyId,
      beforeValue: fromCorePropertyValueInput(state.before_value, propertyId),
      afterValue: fromCorePropertyValueInput(state.after_value, propertyId),
    };
  }),
  postParentGuards: recipe.post_parent_guards.map((guard) => ({
    pageId: guard.page_id,
    parentPageId: guard.parent_page_id ?? null,
  })),
  postBeforePageId: recipe.post_before_page_id ?? null,
  postOrderGuard: recipe.post_order_guard,
  restoreRuns: recipe.restore_runs.map((run) => ({
    pageIds: run.page_ids,
    parentPageId: run.parent_page_id ?? null,
    beforePageId: run.before_page_id ?? null,
  })),
});

const fromCoreDatabaseOperationOutcome = (
  outcome: CoreDatabaseOperationOutcome,
): DatabaseOperationOutcomeV2 => {
  if (outcome.kind === "list_occurrence_move_undo") {
    return {
      kind: outcome.kind,
      operationIndex: outcome.operation_index,
      restoredPageIds: outcome.restored_page_ids,
    };
  }
  return {
    kind: outcome.kind,
    operationIndex: outcome.operation_index,
    movedPageIds: outcome.moved_page_ids,
    moveRootPageIds: outcome.move_root_page_ids,
    normalizedTarget: {
      targetOccurrenceKey: outcome.normalized_target.target_occurrence_key ?? null,
      targetPageId: outcome.normalized_target.target_page_id ?? null,
      parentPageId: outcome.normalized_target.parent_page_id ?? null,
      beforePageId: outcome.normalized_target.before_page_id ?? null,
      groupKey: outcome.normalized_target.group_key ?? null,
      subgroupKey: outcome.normalized_target.subgroup_key ?? null,
      depth: outcome.normalized_target.depth,
      edge: outcome.normalized_target.edge,
    },
    undoRecipe: fromCoreDatabaseListMoveUndoRecipe(outcome.undo_recipe),
  };
};

const coreReceiptEvidence = (
  committed: DatabaseApplyResult,
  operationKinds: readonly DatabaseApplyOperationV2["kind"][],
) => ({
  operationId: committed.receipt.operation_id,
  duplicate: committed.receipt.duplicate,
  operationKinds,
  operationOutcomes: (committed.receipt.operation_outcomes ?? []).map(
    fromCoreDatabaseOperationOutcome,
  ),
  affectedDatabaseIds: committed.receipt.affected_database_ids,
  affectedDataSourceIds: committed.receipt.affected_data_source_ids,
  affectedPageIds: committed.receipt.affected_page_ids,
  affectedViewIds: committed.receipt.affected_view_ids,
  committedRevisions: committed.receipt.committed_revisions,
  commitSeq: applyResultCursor(committed),
  committedAt: committed.receipt.committed_at,
});

interface CoreWindowSlice<Item> {
  readonly items: readonly Item[];
  readonly next_cursor?: string | null;
}

const readAllCoreWindow = async <Item>(
  client: CoreClientPort,
  maximumItems: number,
  createRead: (after: string | null) => DatabaseRead,
  selectWindow: (snapshot: DatabaseReadSnapshot) => CoreWindowSlice<Item>,
): Promise<readonly Item[]> => {
  const items: Item[] = [];
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

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${label} is not an object`);
};

const requireString = (value: Record<string, unknown>, key: string, label: string): string => {
  const result = value[key];
  if (typeof result === "string" && result.length > 0) return result;
  throw new Error(`${label} has no ${key}`);
};

const requireRelationCardinality = (value: Readonly<Record<string, unknown>>): "one" | "many" => {
  const cardinality = requireString(value, "cardinality", "Core Relation schema");
  if (cardinality === "one" || cardinality === "many") return cardinality;
  throw new Error("Core Relation schema has invalid cardinality");
};

type CoreDatabaseReadValue = DatabaseReadSnapshot["value"];
type CoreDatabaseDescriptor = Extract<
  CoreDatabaseReadValue,
  { readonly kind: "database" }
>["value"];
type CoreDatabaseRecord = CoreDatabaseDescriptor["database"];
type CoreDataSourceDescriptor = Extract<
  CoreDatabaseReadValue,
  { readonly kind: "data_source" }
>["value"];
type CoreDataSourceRecord = CoreDataSourceDescriptor["data_source"];
type CoreViewRecord = Extract<CoreDatabaseReadValue, { readonly kind: "view" }>["value"];

const databaseLifecycle = (lifecycle: string): "active" | "archived" | "deleted" => {
  if (lifecycle === "active" || lifecycle === "archived" || lifecycle === "deleted")
    return lifecycle;
  throw new Error(`Core Database lifecycle is invalid: ${lifecycle}`);
};

const viewLifecycle = (lifecycle: string): "active" | "deleted" => {
  if (lifecycle === "active" || lifecycle === "deleted") return lifecycle;
  throw new Error(`Core Database View lifecycle is invalid: ${lifecycle}`);
};

const mapCoreDatabaseRecord = (
  record: CoreDatabaseRecord,
): DatabaseContainerDescriptorV2["database"] => ({
  databaseId: parseDatabaseId(record.database_id),
  libraryId: record.library_id,
  name: record.name,
  lifecycle: databaseLifecycle(record.lifecycle),
  defaultViewId:
    record.default_view_id == null ? null : parseDatabaseViewId(record.default_view_id),
  accessRevision: record.access_revision,
  metadataRevision: record.metadata_revision,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

const mapCoreDataSourceRecord = (
  record: CoreDataSourceRecord,
): DataSourceDescriptorV2["dataSource"] => ({
  dataSourceId: parseDataSourceId(record.data_source_id),
  libraryId: record.library_id,
  homeDatabaseId: parseDatabaseId(record.home_database_id),
  name: record.name,
  schemaKey: record.schema_key,
  schemaRevision: record.schema_revision,
  lifecycle: databaseLifecycle(record.lifecycle),
  rankKey: record.rank_key,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

const mapCoreViewRecord = (
  record: CoreViewRecord,
): DatabaseContainerDescriptorV2["views"][number] => ({
  viewId: parseDatabaseViewId(record.view_id),
  databaseId: parseDatabaseId(record.database_id),
  dataSourceId: parseDataSourceId(record.data_source_id),
  name: record.name,
  defaultLayout: record.layout,
  config: {
    schemaKey: "nodex.database-view",
    schemaVersion: 4,
    filter: record.definition.filter,
    presentation: record.definition.presentation,
  } as DatabaseViewConfigV4,
  isDefault: record.is_default,
  revision: record.revision,
  rankKey: record.rank_key,
  lifecycle: viewLifecycle(record.lifecycle),
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

export const mapCorePropertyDescriptor = (input: unknown): DataSourcePropertyRecordV2 => {
  const property = requireRecord(input, "Core Property descriptor");
  const schema = requireRecord(property.schema, "Core Property schema");
  const schemaKind = requireString(schema, "kind", "Core Property schema");
  if (
    ![
      "text",
      "number",
      "checkbox",
      "select",
      "multi_select",
      "date",
      "datetime",
      "relation",
    ].includes(schemaKind)
  ) {
    throw new Error("Core Property schema is unsupported");
  }
  const capabilities = requireRecord(property.capabilities, "Core Property capabilities");
  return parseDataSourcePropertyRecordV2({
    propertyId: requireString(property, "property_id", "Core Property"),
    dataSourceId: requireString(property, "data_source_id", "Core Property"),
    name: requireString(property, "name", "Core Property"),
    schema:
      schemaKind === "relation"
        ? {
            kind: "relation",
            targetDataSourceId: requireString(
              schema,
              "target_data_source_id",
              "Core Relation schema",
            ),
            cardinality: requireRelationCardinality(schema),
          }
        : { kind: schemaKind },
    capabilities: {
      filterOperators: Array.isArray(capabilities.filter_operators)
        ? (capabilities.filter_operators as NonNullable<
            DataSourcePropertyRecordV2["capabilities"]
          >["filterOperators"])
        : [],
      sortable: capabilities.sortable === true,
      groupable: capabilities.groupable === true,
    },
    valueType: schemaKind,
    config: {},
    optionCount: Number(property.option_count),
    rankKey: requireString(property, "rank_key", "Core Property"),
    lifecycle: requireString(
      property,
      "lifecycle",
      "Core Property",
    ) as DataSourcePropertyRecordV2["lifecycle"],
    revision: Number(property.revision),
    createdAt: requireString(property, "created_at", "Core Property"),
    updatedAt: requireString(property, "updated_at", "Core Property"),
  });
};

const hydrateCoreProperty = async (
  _client: CoreClientPort,
  input: unknown,
): Promise<DataSourcePropertyRecordV2> => mapCorePropertyDescriptor(input);

const hydrateCoreDataSource = async (
  client: CoreClientPort,
  descriptor: CoreDataSourceDescriptor,
): Promise<DataSourceDescriptorV2> => {
  const dataSource = descriptor.data_source;
  const dataSourceId = dataSource.data_source_id;
  const compactProperties = await readAllCoreWindow(
    client,
    200,
    (after) => ({
      kind: "property_window",
      data_source_id: dataSourceId,
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
    dataSource: mapCoreDataSourceRecord(dataSource),
    properties,
  };
};

const hydrateCoreDatabase = async (
  client: CoreClientPort,
  descriptor: CoreDatabaseDescriptor,
): Promise<DatabaseContainerDescriptorV2> => {
  const database = descriptor.database;
  const databaseId = database.database_id;
  const [dataSources, views] = await Promise.all([
    readAllCoreWindow(
      client,
      200,
      (after) => ({
        kind: "data_source_window",
        database_id: databaseId,
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
        kind: "view_descriptor_window",
        database_id: databaseId,
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
    database: mapCoreDatabaseRecord(database),
    dataSources: dataSources.map(mapCoreDataSourceRecord),
    views: views.map(mapCoreViewRecord),
  };
};

const hydrateCoreReadValue = async (
  client: CoreClientPort,
  value: DatabaseReadSnapshot["value"],
): Promise<DatabaseReadValueV2> => {
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
  if (value.kind === "page_key_prefix_preview") {
    return {
      kind: value.kind,
      value: {
        prefix: value.value.prefix,
        availability: value.value.availability,
        alternativePrefix: value.value.alternative_prefix ?? null,
        nextNumber: value.value.next_number,
        exampleKeys: value.value.example_keys,
      },
    };
  }
  if (value.kind === "page_key_namespace") {
    return {
      kind: value.kind,
      value: {
        databaseId: parseDatabaseId(value.value.database_id),
        currentPrefix: value.value.current_prefix,
        nextNumber: value.value.next_number,
        assignedPageCount: value.value.assigned_page_count,
        revision: value.value.revision,
        retiredPrefixes: value.value.retired_prefixes.map((prefix) => ({
          prefix: prefix.prefix,
          lastNumber: prefix.last_number,
        })),
      },
    };
  }
  if (value.kind === "data_source") {
    return {
      kind: value.kind,
      value: await hydrateCoreDataSource(client, value.value),
    };
  }
  if (value.kind === "view") {
    return {
      kind: value.kind,
      value: mapCoreViewRecord(value.value),
    };
  }
  if (value.kind === "view_personal_presentation") {
    return {
      kind: value.kind,
      value: {
        presentationOverride: fromCoreDatabaseViewPresentationOverride(
          value.value.presentation_override,
        ),
        revision: value.value.revision,
      },
    };
  }
  if (value.kind === "view_collapsed_occurrences") {
    return {
      kind: value.kind,
      value: {
        targets: value.value.targets.map((target) => ({
          kind: target.kind,
          occurrenceKey: target.occurrence_key,
        })),
      },
    };
  }
  if (value.kind === "relation_target_window") {
    return {
      kind: value.kind,
      value: {
        valueRevision: value.value.value_revision,
        totalCount: value.value.total_count,
        targets: value.value.targets.items.map((target) =>
          target.kind === "restricted"
            ? { kind: "restricted" as const, edgeId: target.edge_id }
            : {
                kind: "visible" as const,
                edgeId: target.edge_id,
                pageId: target.page_id,
                title: target.title,
                lifecycle: target.lifecycle,
                membershipState: target.membership_state,
              },
        ),
        nextCursor: value.value.targets.next_cursor ?? null,
        projectionRevision: value.value.targets.authority.projection_revision,
      },
    };
  }
  if (value.kind === "option_window") {
    return {
      kind: value.kind,
      value: {
        options: value.options.items.map((option) => ({
          id: option.id,
          name: option.name,
          ...(option.color == null ? {} : { color: option.color }),
        })),
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
  throw new Error(`Core returned unsupported Database read kind ${value.kind}`);
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
          projectId: input.projectId,
          libraryId: input.libraryId,
          storeEpoch: snapshot.store_epoch,
          commitSeq: snapshot.commit_head,
          authorization: snapshot.authorization ?? null,
          value,
        },
      });
    } catch (error) {
      return failure(error);
    }
  };

  return {
    readCore: (read, minimumCommitSeq) =>
      readDatabaseSnapshotAtLeast(input.client, read, input.storeEpoch, minimumCommitSeq),
    read: async (request) => {
      const projectError = assertBoundProject(request.projectId);
      if (projectError) return { ok: false, error: projectError };
      return await readCore(toCoreRead(request.read), request.read.minimumCommitSeq);
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
      try {
        const committed = await input.client.databaseApply({
          operationId: request.operationId,
          intent: request.operations.map(toCoreDatabaseIntent),
        });
        const storeEpoch = applyResultStoreEpoch(committed);
        if (storeEpoch !== input.storeEpoch) {
          throw new Error("Core Database apply crossed its Store epoch boundary");
        }
        const operationKinds = validateCoreCommit(committed, request);
        return parseDatabaseApplyResultV2({
          ok: true,
          localCommit: rendererLocalCommitApply(committed),
          value: {
            projectId: input.projectId,
            libraryId: input.libraryId,
            storeEpoch,
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
  readCore: (read, minimumCommitSeq) =>
    readDatabaseSnapshotAtLeast(input.client, read, input.storeEpoch, minimumCommitSeq),
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
          accessContext: { kind: "library" },
          libraryId: input.libraryId,
          storeEpoch: snapshot.store_epoch,
          commitSeq: snapshot.commit_head,
          authorization: snapshot.authorization ?? null,
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
    try {
      const committed = await input.client.databaseApply({
        operationId: request.operationId,
        intent: request.operations.map(toCoreDatabaseIntent),
      });
      const storeEpoch = applyResultStoreEpoch(committed);
      if (storeEpoch !== input.storeEpoch) {
        throw new Error("Core Library Database apply crossed its Store epoch boundary");
      }
      const operationKinds = validateCoreCommit(committed, request);
      return parseLibraryDatabaseApplyResultV2({
        ok: true,
        localCommit: rendererLocalCommitApply(committed),
        value: {
          accessContext: { kind: "library" },
          libraryId: input.libraryId,
          storeEpoch,
          ...coreReceiptEvidence(committed, operationKinds),
        },
      });
    } catch (error) {
      return applyFailure(error, request.operationId);
    }
  },
});
