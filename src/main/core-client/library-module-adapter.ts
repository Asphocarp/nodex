import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import type { DatabaseViewKind } from "../../shared/database-kernel";
import type {
  LibraryApplyOperation,
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleError,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
  LibraryNavigationNode,
  LibraryNavigationParent,
  LibraryReadValue,
  LibraryRouteTarget,
  LibraryWriteParent,
} from "../../shared/library-module";
import {
  parseLibraryPageDetailResult,
  parsePageDetailResult,
  type LibraryPageDetailResult,
  type PageDetailError,
  type PageDetailResult,
} from "../../shared/page-detail";
import type { ListPageHistoryRequest } from "../../shared/page-history";
import {
  pageHistoryFailure,
  parsePageHistoryCommandResult,
  type PageHistoryCommandError,
  type PageHistoryCommandResult,
} from "../../shared/page-history-transport";
import type { PageSearchInput, PageSearchResult } from "../../shared/types";
import { isWorkflowStatus } from "../../shared/workflow-status";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  CoreModuleError,
  LibraryIntent,
  LibraryRead,
  LibraryReadSnapshot,
} from "./types";

export interface CoreLibraryModuleAdapterInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly profileId: string;
  readonly storeEpoch: string;
}

export interface CoreLibraryModuleAdapter {
  read(request: LibraryModuleReadRequest): Promise<LibraryModuleReadResult>;
  apply(request: LibraryModuleApplyRequest): Promise<LibraryModuleApplyResult>;
  readProjectPageDetail(
    projectId: string,
    pageId: string,
  ): Promise<PageDetailResult>;
  readLibraryPageDetail(pageId: string): Promise<LibraryPageDetailResult>;
  listPageHistory(
    request: ListPageHistoryRequest,
  ): Promise<PageHistoryCommandResult>;
  searchPages(input: PageSearchInput): Promise<PageSearchResult[]>;
}

const toCoreRouteTarget = (target: LibraryRouteTarget) => {
  if (target.kind === "page") return { kind: target.kind, page_id: target.pageId } as const;
  if (target.kind === "database") {
    return { kind: target.kind, database_id: target.databaseId } as const;
  }
  return { kind: target.kind, view_id: target.viewId } as const;
};

const toCoreParent = (parent: LibraryNavigationParent) => {
  if (parent.kind === "library") return parent;
  if (parent.kind === "page") return { kind: parent.kind, page_id: parent.pageId } as const;
  return { kind: parent.kind, database_id: parent.databaseId } as const;
};

const toCoreWriteParent = (parent: LibraryWriteParent) => {
  const before = parent.before
    ? {
        block_id: parent.before.blockId,
        expected_location_revision: parent.before.expectedLocationRevision,
      }
    : null;
  if (parent.kind === "library") return { kind: parent.kind, before } as const;
  return {
    kind: parent.kind,
    page_id: parent.pageId,
    expected_document_generation: parent.expectedDocumentGeneration,
    expected_document_head_seq: parent.expectedDocumentHeadSeq,
    before,
  } as const;
};

const toCoreRead = (request: LibraryModuleReadRequest): LibraryRead => {
  const read = request.read;
  switch (read.mode) {
    case "metadata":
      return { kind: "metadata" };
    case "children":
      return {
        kind: "children",
        parent: toCoreParent(read.parent),
        cursor: read.cursor ?? null,
        limit: read.limit,
        force_include_target: read.forceIncludeTarget
          ? toCoreRouteTarget(read.forceIncludeTarget)
          : null,
      };
    case "path":
      return { kind: "path", target: toCoreRouteTarget(read.target) };
    case "catalog":
      return {
        kind: "catalog",
        query: read.query ?? null,
        kinds: read.kinds ?? null,
        lifecycle: read.lifecycle ?? null,
        cursor: read.cursor ?? null,
        limit: read.limit,
      };
  }
};

const toCoreIntent = (operation: LibraryApplyOperation): LibraryIntent => {
  switch (operation.kind) {
    case "create_page":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        document_id: operation.documentId,
        title: operation.title,
        parent: toCoreWriteParent(operation.parent),
      };
    case "create_database":
      return {
        kind: operation.kind,
        database_id: operation.databaseId,
        data_source_id: operation.dataSourceId,
        view_id: operation.viewId,
        name: operation.name,
        parent: toCoreWriteParent(operation.parent),
      };
    case "move_block":
      return {
        kind: operation.kind,
        target:
          operation.target.kind === "page"
            ? { kind: "page", page_id: operation.target.pageId }
            : { kind: "database", database_id: operation.target.databaseId },
        expected_location_revision: operation.target.expectedLocationRevision,
        parent: toCoreWriteParent(operation.parent),
      };
    case "archive_resource":
    case "restore_resource":
      return {
        kind: operation.kind,
        target:
          operation.target.kind === "page"
            ? { kind: "page", page_id: operation.target.pageId }
            : { kind: "database", database_id: operation.target.databaseId },
        expected_metadata_revision: operation.target.expectedMetadataRevision,
      };
    case "grant_project_access":
      return {
        kind: operation.kind,
        project_id: operation.projectId,
        target:
          operation.target.kind === "page"
            ? { kind: "page", page_id: operation.target.pageId }
            : { kind: "database", database_id: operation.target.databaseId },
        access: operation.access,
      };
  }
};

type CoreRouteTarget = Extract<
  LibraryReadSnapshot["value"],
  { kind: "path" }
>["target"];
type CoreNavigationParent = Extract<
  LibraryReadSnapshot["value"],
  { kind: "children" }
>["parent"];
type CorePageDetail = Extract<
  LibraryReadSnapshot["value"],
  { kind: "page_detail" }
>["value"];
type CorePageHistory = Extract<
  LibraryReadSnapshot["value"],
  { kind: "page_history" }
>["value"];
type CorePageHistoryCursor = NonNullable<CorePageHistory["next_cursor"]>;
type CorePageHistoryEntry = CorePageHistory["entries"][number];

const fromCoreRouteTarget = (
  target: CoreRouteTarget,
): LibraryRouteTarget => {
  if (target.kind === "page") return { kind: target.kind, pageId: target.page_id };
  if (target.kind === "database") {
    return { kind: target.kind, databaseId: parseDatabaseId(target.database_id) };
  }
  return { kind: target.kind, viewId: parseDatabaseViewId(target.view_id) };
};

const fromCoreParent = (
  parent: CoreNavigationParent,
): LibraryNavigationParent => {
  if (parent.kind === "library") return parent;
  if (parent.kind === "page") return { kind: parent.kind, pageId: parent.page_id };
  return { kind: parent.kind, databaseId: parseDatabaseId(parent.database_id) };
};

const parseViewKind = (value: string): DatabaseViewKind => {
  if (value === "kanban" || value === "list" || value === "calendar" || value === "canvas") {
    return value;
  }
  throw new Error(`Core returned unsupported Database View kind ${value}`);
};

const fromCoreNode = (
  node: Extract<LibraryReadSnapshot["value"], { kind: "children" }>["items"][number],
): LibraryNavigationNode => {
  if (node.kind === "page") {
    return {
      kind: node.kind,
      pageId: node.page_id,
      title: node.title,
      hasChildren: node.has_children,
      parentRevision: node.parent_revision,
      metadataRevision: node.metadata_revision,
      documentGeneration: node.document_generation,
      documentHeadSeq: node.document_head_seq,
      updatedAt: node.updated_at,
    };
  }
  if (node.kind === "database") {
    return {
      kind: node.kind,
      databaseId: parseDatabaseId(node.database_id),
      title: node.title,
      defaultViewId: parseDatabaseViewId(node.default_view_id),
      hasMultipleViews: node.has_multiple_views,
      metadataRevision: node.metadata_revision,
      locationRevision: node.location_revision,
      updatedAt: node.updated_at,
    };
  }
  return {
    kind: node.kind,
    viewId: parseDatabaseViewId(node.view_id),
    databaseId: parseDatabaseId(node.database_id),
    dataSourceId: parseDataSourceId(node.data_source_id),
    title: node.title,
    viewKind: parseViewKind(node.view_kind),
    isDefault: node.is_default,
    revision: node.revision,
  };
};

const mapReadValue = (snapshot: LibraryReadSnapshot): LibraryReadValue => {
  const value = snapshot.value;
  switch (value.kind) {
    case "metadata":
      return { kind: value.kind } as const;
    case "children":
      return {
        kind: value.kind,
        parent: fromCoreParent(value.parent),
        items: value.items.map(fromCoreNode),
        nextCursor: value.next_cursor ?? null,
        hasMore: value.has_more,
        total: value.total,
      } as const;
    case "path":
      return {
        kind: value.kind,
        target: fromCoreRouteTarget(value.target),
        nodes: value.nodes.map(fromCoreNode),
      } as const;
    case "catalog":
      return {
        kind: value.kind,
        items: value.items.map((item) => ({
          target:
            item.target.kind === "page"
              ? { kind: "page" as const, pageId: item.target.page_id }
              : {
                  kind: "database" as const,
                  databaseId: parseDatabaseId(item.target.database_id),
                },
          title: item.title,
          kind: item.kind,
          lifecycle: item.lifecycle,
          locationLabel: item.location_label,
          updatedAt: item.updated_at,
          locationRevision: item.location_revision,
          metadataRevision: item.metadata_revision,
        })),
        nextCursor: value.next_cursor ?? null,
        hasMore: value.has_more,
        total: value.total,
      } as const;
    default:
      throw new Error(`Core Library read ${value.kind} cannot satisfy the catalog Adapter`);
  }
};

const mapPageDataSourceContext = (
  context: CorePageDetail["data_source_context"],
): unknown => {
  if (context.kind === "standalone") return { kind: "standalone" };
  return {
    kind: "member",
    membership: {
      membershipId: context.membership.membership_id,
      dataSourceId: context.membership.data_source_id,
      revision: context.membership.revision,
      createdAt: context.membership.created_at,
    },
    database: context.database,
    dataSource: context.data_source,
    properties: context.properties,
    values: context.values,
  };
};

const mapPageDetail = (detail: CorePageDetail): Readonly<Record<string, unknown>> => ({
  version: detail.version,
  libraryId: detail.library_id,
  storeEpoch: detail.store_epoch,
  changeLogSeq: detail.change_log_seq,
  page: detail.page,
  document: {
    readiness: detail.document.readiness,
    schemaKey: detail.document.schema_key,
    schemaVersion: detail.document.schema_version,
  },
  intrinsicProperties: detail.intrinsic_properties.map((property) => ({
    key: property.key,
    valueType: property.value_type,
    value: property.value,
    revision: property.revision,
  })),
  dataSourceContext: mapPageDataSourceContext(detail.data_source_context),
});

const mapPageHistoryCursor = (
  cursor: CorePageHistoryCursor,
): Readonly<Record<string, unknown>> => {
  if (cursor.source === "document_version") {
    return {
      occurredAt: cursor.occurred_at,
      source: cursor.source,
      versionId: cursor.version_id,
    };
  }
  return {
    occurredAt: cursor.occurred_at,
    source: cursor.source,
    changeSeq: cursor.change_seq,
  };
};

const mapPageHistoryEntryBase = (
  entry: CorePageHistoryEntry,
): Readonly<Record<string, unknown>> => ({
  id: entry.id,
  libraryId: entry.library_id,
  pageId: entry.page_id,
  documentId: entry.document_id,
  occurredAt: entry.occurred_at,
  display: {
    category: entry.display.category,
    title: entry.display.title,
    detail: entry.display.detail ?? null,
    actorLabel: entry.display.actor_label ?? null,
  },
  evidence: entry.evidence,
  recovery: entry.recovery.kind === "restore_document_version"
    ? {
        kind: entry.recovery.kind,
        documentId: entry.recovery.document_id,
        versionId: entry.recovery.version_id,
      }
    : entry.recovery,
});

const mapPageHistoryEntry = (
  entry: CorePageHistoryEntry,
): Readonly<Record<string, unknown>> => {
  const base = mapPageHistoryEntryBase(entry);
  if (entry.kind === "document_version") {
    return {
      ...base,
      kind: entry.kind,
      versionMetadata: {
        versionId: entry.version_metadata.version_id,
        generation: entry.version_metadata.generation,
        baseHeadSeq: entry.version_metadata.base_head_seq,
        schemaKey: entry.version_metadata.schema_key,
        schemaVersion: entry.version_metadata.schema_version,
        cause: entry.version_metadata.cause,
        label: entry.version_metadata.label ?? null,
        revisionKind: entry.version_metadata.revision_kind,
        sourceMutationId: entry.version_metadata.source_mutation_id ?? null,
        sourceChangeSeq: entry.version_metadata.source_change_seq ?? null,
        pinned: entry.version_metadata.pinned,
        checkpointHash: entry.version_metadata.checkpoint_hash,
        byteLength: entry.version_metadata.byte_length,
      },
    };
  }
  if (entry.kind === "block_mutation") {
    return {
      ...base,
      kind: entry.kind,
      changeSeq: entry.change_seq,
      mutationId: entry.mutation_id ?? null,
      mutationKind: entry.mutation_kind ?? null,
      affectedBlockCount: entry.affected_block_count ?? null,
      fieldIntentCount: entry.field_intent_count ?? null,
    };
  }
  return {
    ...base,
    kind: entry.kind,
    changeSeq: entry.change_seq,
    relocationId: entry.relocation_id ?? null,
    direction: entry.direction,
    movedBlockCount: entry.moved_block_count ?? null,
  };
};

const mapPageHistory = (
  page: CorePageHistory,
): Readonly<Record<string, unknown>> => ({
  version: page.version,
  libraryId: page.library_id,
  pageId: page.page_id,
  documentId: page.document_id,
  entries: page.entries.map(mapPageHistoryEntry),
  nextCursor: page.next_cursor ? mapPageHistoryCursor(page.next_cursor) : null,
});

const mapCoreError = (error: CoreModuleError): LibraryModuleError => {
  const code = (() => {
    switch (error.code) {
      case "invalid_input":
        return "invalid_request";
      case "stale_store_epoch":
        return "store_epoch_mismatch";
      case "idempotency_key_reused":
        return "identity_conflict";
      case "not_found":
        return "resource_not_found";
      case "revision_conflict":
        return "revision_conflict";
      case "generation_conflict":
      case "head_conflict":
        return "document_conflict";
      case "store_corrupt":
        return "state_corrupt";
      default:
        return "unknown";
    }
  })() satisfies LibraryModuleError["code"];
  return { code, message: error.message, retryable: error.retryable };
};

const failure = (error: unknown): { readonly ok: false; readonly error: LibraryModuleError } => {
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

const pageDetailError = (error: unknown): PageDetailError => {
  if (error instanceof CoreModuleResponseError) {
    const code = (() => {
      switch (error.coreError.code) {
        case "invalid_input":
          return "invalid_request";
        case "not_found":
          return "page_not_found";
        case "unauthorized":
          return "authorization_denied";
        case "store_corrupt":
        case "invalid_document_schema":
          return "page_detail_corrupt";
        default:
          return "unknown";
      }
    })() satisfies PageDetailError["code"];
    return {
      code,
      message: error.message,
      retryable: error.coreError.retryable,
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
};

const pageHistoryError = (error: unknown): PageHistoryCommandError => {
  if (error instanceof CoreModuleResponseError) {
    const code = (() => {
      switch (error.coreError.code) {
        case "invalid_input":
          return "invalid_page_history_request";
        case "not_found":
        case "unauthorized":
          return "page_not_found";
        case "store_corrupt":
        case "invalid_document_schema":
          return "page_history_corrupt";
        default:
          return "unknown";
      }
    })() satisfies PageHistoryCommandError["code"];
    return pageHistoryFailure(
      code,
      error.message,
      error.coreError.retryable,
    );
  }
  return pageHistoryFailure(
    "unknown",
    error instanceof Error ? error.message : String(error),
    true,
  );
};

const fromCoreCreatedTarget = (
  target: NonNullable<
    Extract<LibraryIntent, { kind: "archive_resource" }>["target"]
  >,
): Exclude<LibraryRouteTarget, { kind: "view" }> => {
  if (target.kind === "page") return { kind: target.kind, pageId: target.page_id };
  return { kind: target.kind, databaseId: parseDatabaseId(target.database_id) };
};

export const createCoreLibraryModuleAdapter = (
  input: CoreLibraryModuleAdapterInput,
): CoreLibraryModuleAdapter => {
  const readPageDetail = async (pageId: string): Promise<CorePageDetail> => {
    const snapshot = await input.client.libraryRead({
      kind: "page_detail",
      page_id: pageId,
    });
    if (snapshot.value.kind !== "page_detail") {
      throw new Error("Core returned a non-Page-detail Library read value");
    }
    const detail = snapshot.value.value;
    if (
      detail.library_id !== input.libraryId
      || detail.store_epoch !== snapshot.store_epoch
      || detail.change_log_seq !== snapshot.event_head
    ) {
      throw new Error("Core Page Detail escaped its Library snapshot boundary");
    }
    return detail;
  };

  return {
    read: async (request) => {
      try {
        const snapshot = await input.client.libraryRead(toCoreRead(request));
        return {
          ok: true,
          value: {
            version: request.version,
            profileId: input.profileId,
            libraryId: input.libraryId,
            storeEpoch: snapshot.store_epoch,
            changeLogSeq: snapshot.event_head,
            value: mapReadValue(snapshot),
          },
        };
      } catch (error) {
        return failure(error);
      }
    },
    apply: async (request) => {
      if (request.storeEpoch !== input.storeEpoch) {
        return {
          ok: false,
          error: {
            code: "store_epoch_mismatch",
            message: "Library operation targets a stale Store epoch",
            retryable: false,
          },
        };
      }
      try {
        const committed = await input.client.libraryApply({
          operationId: request.operationId,
          intent: toCoreIntent(request.operation),
        });
        const receipt = committed.receipt;
        return {
          ok: true,
          value: {
            version: request.version,
            operationId: receipt.operation_id,
            storeEpoch: committed.store_epoch,
            libraryId: input.libraryId,
            operationKind: request.operation.kind,
            duplicate: receipt.duplicate,
            didMutate: receipt.did_mutate,
            createdTarget: receipt.created_target
              ? fromCoreCreatedTarget(receipt.created_target)
              : null,
            affectedParentKeys: receipt.affected_parent_keys,
            affectedPageIds: receipt.affected_page_ids,
            affectedDatabaseIds: receipt.affected_database_ids.map(
              parseDatabaseId,
            ),
            affectedViewIds: receipt.affected_view_ids.map(parseDatabaseViewId),
            committedRevisions: receipt.committed_revisions,
            changeLogSeq: receipt.change_log_seq,
            committedAt: receipt.committed_at,
          },
        };
      } catch (error) {
        return failure(error);
      }
    },
    readProjectPageDetail: async (projectId, pageId) => {
      try {
        return parsePageDetailResult({
          ok: true,
          value: { ...mapPageDetail(await readPageDetail(pageId)), projectId },
        });
      } catch (error) {
        return { ok: false, error: pageDetailError(error) };
      }
    },
    readLibraryPageDetail: async (pageId) => {
      try {
        return parseLibraryPageDetailResult({
          ok: true,
          value: {
            ...mapPageDetail(await readPageDetail(pageId)),
            accessContext: { kind: "library" },
          },
        });
      } catch (error) {
        return { ok: false, error: pageDetailError(error) };
      }
    },
    listPageHistory: async (request) => {
      try {
        const snapshot = await input.client.libraryRead({
          kind: "page_history",
          page_id: request.pageId,
          before: request.before
            ? request.before.source === "document_version"
              ? {
                  occurred_at: request.before.occurredAt,
                  source: request.before.source,
                  version_id: request.before.versionId,
                }
              : {
                  occurred_at: request.before.occurredAt,
                  source: request.before.source,
                  change_seq: request.before.changeSeq,
                }
            : null,
          limit: request.pageSize ?? null,
        });
        if (snapshot.value.kind !== "page_history") {
          throw new Error("Core returned a non-Page-history Library read value");
        }
        const page = snapshot.value.value;
        if (
          page.library_id !== input.libraryId
          || page.page_id !== request.pageId
        ) {
          throw new Error("Core Page history escaped its Library Page scope");
        }
        return parsePageHistoryCommandResult({
          ok: true,
          value: mapPageHistory(page),
        });
      } catch (error) {
        return { ok: false, error: pageHistoryError(error) };
      }
    },
    searchPages: async (searchInput) => {
      const snapshot = await input.client.libraryRead({
        kind: "project_page_search",
        project_ids: searchInput.projectIds,
        query: searchInput.query,
        limit: searchInput.limit ?? null,
      });
      if (
        snapshot.store_epoch !== input.storeEpoch
        || snapshot.value.kind !== "project_page_search"
      ) {
        throw new Error("Core Project Page search escaped its snapshot boundary");
      }
      return snapshot.value.items.map((item): PageSearchResult => {
        if (
          !item.project_id
          || !item.page_id
          || !isWorkflowStatus(item.status)
          || !Number.isSafeInteger(item.score)
          || item.score < 1
        ) {
          throw new Error("Core Project Page search returned invalid evidence");
        }
        return {
          projectId: item.project_id,
          pageId: item.page_id,
          status: item.status,
          score: item.score,
          excerpt: item.excerpt,
        };
      });
    },
  };
};
