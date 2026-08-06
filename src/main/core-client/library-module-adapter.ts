import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import type { DatabaseViewKind } from "../../shared/database-kernel";
import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";
import { blockRecordSnapshotToWindow } from "../../shared/block-records/wire";
import {
  buildArchiveBlockRecordSubtreeApplyInput,
  buildCreateBlockRecordApplyInput,
  buildMoveManyBlockRecordApplyInput,
  buildRestoreBlockRecordSubtreeApplyInput,
} from "../../shared/block-records/apply-request";
import { planFractionalRank } from "../../shared/block-records/fractional-rank";
import type { BlockPlacementParent } from "../../shared/block-records/contracts";
import type {
  LibraryApplyOperation,
  LibraryCanvasDestination,
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleApplyReceipt,
  LibraryModuleError,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
  LibraryNavigationNode,
  LibraryNavigationParent,
  LibraryReadValue,
  LibraryResourceTarget,
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
import {
  parseBlockPropertyMutationCommandResultV2,
  parseLibraryBlockPropertyMutationCommandResultV2,
  type BlockPropertyMutationCommandResultV2,
  type BlockPropertyMutationFieldResultV2,
  type BlockPropertyMutationRequestV2,
  type LibraryBlockPropertyMutationCommandResultV2,
  type LibraryBlockPropertyMutationRequestV2,
} from "../../shared/block-property-mutations-v2";
import { parsePage } from "../../shared/page";
import type { PageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-runtime";
import { parsePageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-transport";
import {
  parsePageLifecycleMutationCommandResultV2,
  type PageLifecycleMutationCommandResultV2,
  type PageLifecycleMutationErrorCodeV2,
  type PageLifecycleMutationRequestV2,
  type PageLifecycleOperationV2,
} from "../../shared/page-lifecycle-v2";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "../../shared/page-targets";
import type {
  PageOwnershipPathReadModel,
  ResolvePageOwnershipPathInput,
} from "../../shared/page-ownership-paths";
import { isWorkflowStatus } from "../../shared/workflow-status";
import { CoreModuleResponseError } from "./core-client";
import { applyBlockRecordWithResolution } from "./block-record-commit";
import {
  mapCorePropertyDescriptor,
  toCoreDatabaseIntent,
} from "./database-module-adapter";
import type {
  CoreClientPort,
  CoreModuleError,
  LibraryIntent,
  LibraryRead,
  LibraryReadSnapshot,
} from "./types";

const canonicalPageActorId = (profileId: string): string => `profile:${profileId}`;

const canonicalPageSessionId = (libraryId: string): string =>
  `library-module:${libraryId}`;

const canonicalPageParent = (
  libraryId: string,
  parent: LibraryWriteParent,
) => parent.kind === "library"
  ? { kind: "library" as const, libraryId }
  : { kind: "block" as const, blockId: parent.pageId };

const canonicalPageParentKey = (
  parent: LibraryWriteParent,
): string => parent.kind === "library" ? "library" : `page:${parent.pageId}`;

const canonicalPlacementKey = (
  parent: {
    readonly kind: "library" | "block" | "dataSource";
    readonly libraryId?: string;
    readonly blockId?: string;
    readonly dataSourceId?: string;
  },
): string => {
  if (parent.kind === "library") return "library";
  if (parent.kind === "block") return `page:${parent.blockId}`;
  return `data-source:${parent.dataSourceId}`;
};

/**
 * Library navigation revisions are deliberately one-based because the old
 * Library contract treats zero as an absent revision. BlockRecord revisions
 * start at zero for a freshly inserted row, so the adapter translates the
 * public fence back to the canonical value only after proving the row is the
 * same record that the user acted on.
 */
const canonicalPublicRevision = (revision: number): number => revision + 1;

const archivedRankPrefix = "__nodex_archived__";

const activeRankFromArchived = (
  blockId: string,
  rankKey: string,
): string | null => {
  const prefix = `${archivedRankPrefix}${blockId}__`;
  return rankKey.startsWith(prefix) ? rankKey.slice(prefix.length) || null : null;
};

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
    minimumCommitSeq?: number,
  ): Promise<PageDetailResult>;
  readLibraryPageDetail(
    pageId: string,
    minimumCommitSeq?: number,
  ): Promise<LibraryPageDetailResult>;
  listPageHistory(
    request: ListPageHistoryRequest,
  ): Promise<PageHistoryCommandResult>;
  searchPages(input: PageSearchInput): Promise<PageSearchResult[]>;
  resolvePageTarget(
    input: ResolvePageTargetInput,
  ): Promise<PageTargetReadModel | null>;
  resolvePageOwnershipPath(
    input: ResolvePageOwnershipPathInput,
  ): Promise<PageOwnershipPathReadModel | null>;
  findPageLocation(
    pageId: string,
  ): Promise<{ readonly pageId: string; readonly projectId: string } | null>;
  findViewLocation(
    viewId: string,
  ): Promise<{
    readonly viewId: string;
    readonly dataSourceId: string;
    readonly databaseId: string;
    readonly projectId: string;
  } | null>;
  readPageLifecyclePreflight(
    projectId: string,
    pageId: string,
  ): Promise<PageLifecyclePreflightResultV2>;
  applyPageLifecycleMutation(
    request: PageLifecycleMutationRequestV2,
  ): Promise<PageLifecycleMutationCommandResultV2>;
  applyBlockPropertyMutation(
    request: BlockPropertyMutationRequestV2,
  ): Promise<BlockPropertyMutationCommandResultV2>;
  applyLibraryBlockPropertyMutation(input: {
    readonly request: LibraryBlockPropertyMutationRequestV2;
    readonly actor: BlockPropertyMutationRequestV2["actor"];
  }): Promise<LibraryBlockPropertyMutationCommandResultV2>;
}

const toCoreRouteTarget = (target: LibraryRouteTarget) => {
  if (target.kind === "page") return { kind: target.kind, page_id: target.pageId } as const;
  if (target.kind === "database") {
    return { kind: target.kind, database_id: target.databaseId } as const;
  }
  if (target.kind === "canvas") {
    return { kind: target.kind, canvas_id: target.canvasId } as const;
  }
  return { kind: target.kind, view_id: target.viewId } as const;
};

const toCoreResourceTarget = (target: LibraryResourceTarget) => {
  if (target.kind === "page") return { kind: target.kind, page_id: target.pageId } as const;
  if (target.kind === "database") {
    return { kind: target.kind, database_id: target.databaseId } as const;
  }
  return { kind: target.kind, canvas_id: target.canvasId } as const;
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

const toCoreCanvasDestination = (destination: LibraryCanvasDestination) => {
  if (destination.kind === "library") {
    return {
      kind: destination.kind,
      before: destination.before
        ? {
            block_id: destination.before.blockId,
            expected_location_revision:
              destination.before.expectedLocationRevision,
          }
        : null,
    } as const;
  }
  const insertion = (() => {
    if (destination.insertion.kind === "append") {
      return {
        kind: destination.insertion.kind,
        parent_block_id: destination.insertion.parentBlockId ?? null,
      } as const;
    }
    if (destination.insertion.kind === "before") {
      return {
        kind: destination.insertion.kind,
        parent_block_id: destination.insertion.parentBlockId ?? null,
        anchor_block_id: destination.insertion.anchorBlockId,
      } as const;
    }
    return {
      kind: destination.insertion.kind,
      block_id: destination.insertion.blockId,
    } as const;
  })();
  return {
    kind: destination.kind,
    page_id: destination.pageId,
    expected_document_generation: destination.expectedDocumentGeneration,
    expected_document_head_seq: destination.expectedDocumentHeadSeq,
    insertion,
  } as const;
};

const toCoreRead = (request: LibraryModuleReadRequest): LibraryRead => {
  const read = request.read;
  switch (read.mode) {
    case "metadata":
      return { kind: "metadata" };
    case "resource_project_access":
      return {
        kind: "resource_project_access",
        target: toCoreResourceTarget(read.target),
      };
    case "canvas_target":
      return { kind: "canvas_target", canvas_id: read.canvasId };
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
    case "standalone_roots":
      return {
        kind: "standalone_roots",
        cursor: read.cursor ?? null,
        limit: read.limit,
        force_include_target: read.forceIncludeTarget
          ? toCoreResourceTarget(read.forceIncludeTarget)
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
    case "create_canvas":
      return {
        kind: operation.kind,
        canvas_id: operation.canvasId,
        document_id: operation.documentId,
        display_name: operation.displayName,
        destination: toCoreCanvasDestination(operation.destination),
      };
    case "rename_canvas":
      return {
        kind: operation.kind,
        canvas_id: operation.canvasId,
        display_name: operation.displayName,
        expected_metadata_revision: operation.expectedMetadataRevision,
      };
    case "move_canvas":
      return {
        kind: operation.kind,
        canvas_id: operation.canvasId,
        expected_location_revision: operation.expectedLocationRevision,
        destination: toCoreCanvasDestination(operation.destination),
      };
    case "duplicate_canvas":
      return {
        kind: operation.kind,
        source_canvas_id: operation.sourceCanvasId,
        canvas_id: operation.canvasId,
        document_id: operation.documentId,
        display_name: operation.displayName ?? null,
        expected_document_generation: operation.expectedDocumentGeneration,
        expected_document_head_seq: operation.expectedDocumentHeadSeq,
        destination: toCoreCanvasDestination(operation.destination),
      };
    case "delete_canvas":
      return {
        kind: operation.kind,
        canvas_id: operation.canvasId,
        expected_location_revision: operation.expectedLocationRevision,
        expected_metadata_revision: operation.expectedMetadataRevision,
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
    case "set_project_access":
      return {
        kind: operation.kind,
        target: toCoreResourceTarget(operation.target),
        changes: operation.changes.map((change) => ({
          project_id: change.projectId,
          access: change.access,
          expected_revision: change.expectedRevision,
        })),
      };
    case "apply_page_metadata_properties":
      return {
        kind: operation.kind,
        database_intents: operation.databaseOperations.map(toCoreDatabaseIntent),
        intrinsic_mutation: toCoreBlockPropertyMutation(
          operation.intrinsicFields,
          { kind: "page_metadata" },
          operation.clientSessionId,
        ),
      };
  }
};

type CorePageLifecycleMutation = Extract<
  LibraryIntent,
  { kind: "apply_page_lifecycle" }
>["mutation"];

const toCorePageLifecycleMutation = (
  operation: PageLifecycleOperationV2,
): CorePageLifecycleMutation => {
  switch (operation.kind) {
    case "create_page":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        title: operation.title,
        rich_title: operation.richTitle ?? null,
        nfm: operation.nfm,
        status: operation.status,
        priority: operation.priority,
        estimate: operation.estimate,
        due_date: operation.dueDate,
        scheduled_start: operation.scheduledStart,
        scheduled_end: operation.scheduledEnd,
        is_all_day: operation.isAllDay,
        recurrence: operation.recurrence,
        reminders: [...operation.reminders],
        schedule_timezone: operation.scheduleTimezone,
        assignee: operation.assignee,
        run_in_target: operation.runInTarget,
        run_in_local_path: operation.runInLocalPath,
        run_in_base_branch: operation.runInBaseBranch,
        run_in_worktree_path: operation.runInWorktreePath,
        run_in_environment_path: operation.runInEnvironmentPath,
        before_block_id: operation.beforeBlockId ?? null,
        before_view_page_id: operation.beforeViewPageId ?? null,
        data_source_id: operation.dataSourceId,
        tag_option_ids: [...operation.tagOptionIds],
        new_tag_options: operation.newTagOptions.map((option) => ({
          option_id: option.optionId,
          name: option.name,
        })),
        expected_tags_property_revision:
          operation.expectedTagsPropertyRevision,
      };
    case "archive_page":
    case "unarchive_page":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        expected_metadata_revision: operation.expectedMetadataRevision,
      };
    case "delete_page":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        expected_metadata_revision: operation.expectedMetadataRevision,
        expected_parent_revision: operation.expectedParentRevision,
      };
    case "restore_page":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        delete_operation_id: operation.deleteOperationId,
        expected_metadata_revision: operation.expectedMetadataRevision,
        expected_parent_revision: operation.expectedParentRevision,
        membership: operation.membership
          ? {
              membership_id: operation.membership.membershipId,
              database_id: operation.membership.databaseId,
              data_source_id: operation.membership.dataSourceId,
              status: operation.membership.status,
              position: operation.membership.position
                ? {
                    view_id: operation.membership.position.viewId,
                    before_view_page_id:
                      operation.membership.position.beforeViewPageId ?? null,
                  }
                : null,
            }
          : null,
        before_block_id: operation.beforeBlockId ?? null,
      };
    case "move_page_in_library":
      return {
        kind: operation.kind,
        page_id: operation.pageId,
        expected_parent_revision: operation.expectedParentRevision,
        before_block_id: operation.beforeBlockId ?? null,
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
type CoreNavigationNode = Extract<
  LibraryReadSnapshot["value"],
  { kind: "children" | "standalone_roots" }
>["items"][number];
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
type CorePageTarget = NonNullable<Extract<
  LibraryReadSnapshot["value"],
  { kind: "page_target" }
>["value"]>;
type CorePageOwnershipPath = NonNullable<Extract<
  LibraryReadSnapshot["value"],
  { kind: "page_ownership_path" }
>["value"]>;
type CorePageLifecyclePreflight = Extract<
  LibraryReadSnapshot["value"],
  { kind: "page_lifecycle_preflight" }
>["value"];

const fromCoreRouteTarget = (
  target: CoreRouteTarget,
): LibraryRouteTarget => {
  if (target.kind === "page") return { kind: target.kind, pageId: target.page_id };
  if (target.kind === "database") {
    return { kind: target.kind, databaseId: parseDatabaseId(target.database_id) };
  }
  if (target.kind === "canvas") {
    return { kind: target.kind, canvasId: target.canvas_id };
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
  if (value === "kanban" || value === "list" || value === "calendar") {
    return value;
  }
  throw new Error(`Core returned unsupported Database View kind ${value}`);
};

const fromCoreNode = (
  node: CoreNavigationNode,
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
  if (node.kind === "canvas") {
    return {
      kind: node.kind,
      canvasId: node.canvas_id,
      title: node.title,
      isPrimary: node.is_primary,
      metadataRevision: node.metadata_revision,
      locationRevision: node.location_revision,
      documentGeneration: node.document_generation,
      documentHeadSeq: node.document_head_seq,
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
    case "resource_project_access":
      return {
        kind: value.kind,
        value: {
          target: value.value.target.kind === "page"
            ? { kind: "page" as const, pageId: value.value.target.page_id }
            : value.value.target.kind === "database"
              ? {
                kind: "database" as const,
                databaseId: parseDatabaseId(value.value.target.database_id),
              }
              : (() => {
                throw new Error("Canvas access is inherited and cannot be managed directly");
              })(),
          projects: value.value.projects.map((project) => ({
            projectId: project.project_id,
            projectName: project.project_name,
            appearance: project.appearance,
            lifecycle: project.lifecycle,
            directGrant: project.direct_grant
              ? {
                access: project.direct_grant.access,
                revision: project.direct_grant.revision,
              }
              : null,
            inheritedSources: project.inherited_sources.map((source) => {
              if (source.kind === "ancestor_page") {
                return {
                  kind: source.kind,
                  pageId: source.page_id,
                  pageTitle: source.page_title,
                  access: source.access,
                } as const;
              }
              return {
                kind: source.kind,
                databaseId: parseDatabaseId(source.database_id),
                databaseName: source.database_name,
                access: source.access,
              } as const;
            }),
            effectiveAccess: project.effective_access ?? null,
          })),
        },
      } as const;
    case "canvas_target":
      return {
        kind: value.kind,
        value: value.value.status === "available"
          ? {
              status: value.value.status,
              summary: {
                canvasId: value.value.summary.canvas_id,
                projectId: value.value.summary.project_id,
                title: value.value.summary.title,
                lifecycle: value.value.summary.lifecycle,
                isPrimary: value.value.summary.is_primary,
                location: value.value.summary.location.kind === "library"
                  ? { kind: "library" as const }
                  : {
                      kind: "page" as const,
                      pageId: value.value.summary.location.page_id,
                      documentId: value.value.summary.location.document_id,
                    },
                metadataRevision: value.value.summary.metadata_revision,
                locationRevision: value.value.summary.location_revision,
                documentGeneration: value.value.summary.document_generation,
                documentHeadSeq: value.value.summary.document_head_seq,
                updatedAt: value.value.summary.updated_at,
              },
            }
          : value.value.status === "deleted"
            ? {
                status: value.value.status,
                canvasId: value.value.canvas_id,
                libraryId: value.value.library_id,
              }
            : {
                status: value.value.status,
                canvasId: value.value.canvas_id,
              },
      } as const;
    case "children":
      return {
        kind: value.kind,
        parent: fromCoreParent(value.parent),
        items: value.items.map(fromCoreNode),
        nextCursor: value.next_cursor ?? null,
        hasMore: value.has_more,
        total: value.total,
      } as const;
    case "standalone_roots":
      return {
        kind: value.kind,
        items: value.items.map(fromCoreNode).filter(
          (node) => node.kind !== "view",
        ),
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
              : item.target.kind === "database"
                ? {
                  kind: "database" as const,
                  databaseId: parseDatabaseId(item.target.database_id),
                }
                : {
                    kind: "canvas" as const,
                    canvasId: item.target.canvas_id,
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
    properties: context.properties.map(mapCorePropertyDescriptor),
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

const mapPageTarget = (
  value: CorePageTarget,
  authority: {
    readonly libraryId: string;
    readonly storeEpoch: string;
    readonly changeLogSeq: number;
  },
): PageTargetReadModel => {
  const base = authority;
  if (value.status === "missing") {
    return { ...base, status: value.status, targetPageId: value.target_page_id };
  }
  if (value.status === "invalid_target") {
    return {
      ...base,
      status: value.status,
      targetPageId: value.target_page_id,
      actualBlockType: value.actual_block_type,
    };
  }
  if (value.status === "deleted") {
    return {
      ...base,
      status: value.status,
      targetPageId: value.target_page_id,
      libraryId: value.library_id,
    };
  }
  const page = parsePage(value.page);
  if (page.pageId !== value.target_page_id || page.lifecycle === "deleted") {
    throw new Error("Core Page target escaped its requested active Page boundary");
  }
  const readiness = value.document.readiness;
  if (
    readiness !== "pending_genesis"
    && readiness !== "ready"
    && readiness !== "failed"
  ) {
    throw new Error("Core Page target returned invalid Document readiness");
  }
  return {
    ...base,
    status: value.status,
    targetPageId: value.target_page_id,
    page: { ...page, lifecycle: page.lifecycle },
    document: {
      readiness,
      schemaKey: value.document.schema_key,
      schemaVersion: value.document.schema_version,
    },
  };
};

const mapPageOwnershipPath = (
  value: CorePageOwnershipPath,
  authority: {
    readonly libraryId: string;
    readonly storeEpoch: string;
    readonly changeLogSeq: number;
  },
): PageOwnershipPathReadModel => {
  if (value.status === "missing") {
    return { ...authority, status: value.status, targetPageId: value.target_page_id };
  }
  return {
    ...authority,
    status: value.status,
    targetPageId: value.target_page_id,
    ancestors: value.ancestors.map((ancestor) => ({
      pageId: ancestor.page_id,
      title: ancestor.title,
      lifecycle: ancestor.lifecycle,
    })),
  };
};

const coreRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  throw new Error(`Core ${label} is not an object`);
};

const mapLifecycleTagsProperty = (value: unknown) => {
  const property = coreRecord(value, "Page lifecycle tags Property");
  return {
    propertyId: property.propertyId,
    dataSourceId: property.dataSourceId,
    valueType: property.valueType,
    lifecycle: property.lifecycle,
    revision: property.revision,
    config: property.config,
  };
};

const mapLifecycleDefaultView = (
  value: unknown,
): Readonly<Record<string, unknown>> => {
  const defaultView = coreRecord(value, "Page lifecycle default View");
  if (!Array.isArray(defaultView.properties)) {
    throw new Error("Core Page lifecycle default View has no Property descriptors");
  }
  return {
    ...defaultView,
    properties: defaultView.properties.map(mapCorePropertyDescriptor),
  };
};

const mapLifecycleParent = (
  parent: CorePageLifecyclePreflight["page"] extends infer Page
    ? NonNullable<Page> extends { parent: infer Parent }
      ? Parent
      : never
    : never,
) => {
  if (parent.kind === "library") {
    return { kind: parent.kind, libraryId: parent.library_id } as const;
  }
  if (parent.kind === "page") {
    return { kind: parent.kind, pageId: parent.page_id } as const;
  }
  return {
    kind: parent.kind,
    dataSourceId: parseDataSourceId(parent.data_source_id),
  } as const;
};

const mapLifecyclePage = (
  page: NonNullable<CorePageLifecyclePreflight["page"]>,
) => {
  if (![
    "active",
    "archived",
    "deleted",
  ].includes(page.lifecycle)) {
    throw new Error("Core Page lifecycle preflight returned invalid lifecycle");
  }
  if (
    page.document.readiness !== "ready"
    || page.document.authority !== "ydoc_primary"
    || !isWorkflowStatus(page.membership?.status ?? "triage")
  ) {
    throw new Error("Core Page lifecycle preflight returned invalid authority");
  }
  const membership = page.membership
    ? {
        membershipId: page.membership.membership_id,
        databaseId: parseDatabaseId(page.membership.database_id),
        dataSourceId: parseDataSourceId(page.membership.data_source_id),
        membershipRevision: page.membership.membership_revision,
        viewId: parseDatabaseViewId(page.membership.view_id),
        viewRevision: page.membership.view_revision,
        statusPropertyId: page.membership.status_property_id,
        statusValueRevision: page.membership.status_value_revision,
        status: page.membership.status,
        position: page.membership.position
          ? {
              groupKey: page.membership.position.group_key ?? null,
              rankKey: page.membership.position.rank_key,
              revision: page.membership.position.revision,
            }
          : null,
      }
    : null;
  const restoreEvidence = page.restore_evidence
    ? {
        deleteOperationId: page.restore_evidence.delete_operation_id,
        previousLifecycle: page.restore_evidence.previous_lifecycle,
        membership: page.restore_evidence.membership
          ? {
              membershipId: page.restore_evidence.membership.membership_id,
              databaseId: parseDatabaseId(
                page.restore_evidence.membership.database_id,
              ),
              dataSourceId: parseDataSourceId(
                page.restore_evidence.membership.data_source_id,
              ),
              status: page.restore_evidence.membership.status,
              position: page.restore_evidence.membership.view_id
                ? {
                    viewId: parseDatabaseViewId(
                      page.restore_evidence.membership.view_id,
                    ),
                  }
                : null,
            }
          : null,
      }
    : null;
  return {
    pageId: page.page_id,
    lifecycle: page.lifecycle as "active" | "archived" | "deleted",
    parent: mapLifecycleParent(page.parent),
    libraryRankKey: page.library_rank_key ?? null,
    metadataRevision: page.metadata_revision,
    parentRevision: page.parent_revision,
    document: {
      documentId: page.document.document_id,
      generation: page.document.generation,
      headSeq: page.document.head_seq,
      readiness: page.document.readiness as "ready",
      authority: page.document.authority as "ydoc_primary",
      schemaKey: page.document.schema_key,
      schemaVersion: page.document.schema_version,
    },
    membership,
    restoreEvidence,
  };
};

const mapPageLifecyclePreflight = (
  input: CorePageLifecyclePreflight,
) => ({
  version: input.version,
  defaultView: mapLifecycleDefaultView(input.default_view),
  tagsProperty: mapLifecycleTagsProperty(input.tags_property),
  reservedBlockType: input.reserved_block_type ?? null,
  page: input.page ? mapLifecyclePage(input.page) : null,
});

const pageLifecyclePreflightFailure = (
  error: unknown,
): PageLifecyclePreflightResultV2 => {
  if (error instanceof CoreModuleResponseError) {
    const code = (() => {
      switch (error.coreError.code) {
        case "invalid_input":
          return "invalid_request";
        case "stale_store_epoch":
          return "store_not_initialized";
        case "not_found":
          return "page_not_found";
        case "unauthorized":
          return "authorization_denied";
        case "store_corrupt":
        case "invalid_document_schema":
          return "state_corrupt";
        default:
          return "unknown";
      }
    })() satisfies Extract<
      PageLifecyclePreflightResultV2,
      { readonly ok: false }
    >["error"]["code"];
    return {
      ok: false,
      error: {
        code,
        message: error.message,
        retryable: error.coreError.retryable,
      },
    };
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

const pageLifecycleMutationFailure = (
  request: PageLifecycleMutationRequestV2,
  error: unknown,
): PageLifecycleMutationCommandResultV2 => {
  const coreError = error instanceof CoreModuleResponseError
    ? error.coreError
    : null;
  const code = (() => {
    switch (coreError?.code) {
      case "invalid_input":
        return "invalid_page_lifecycle_request";
      case "stale_store_epoch":
        return "store_epoch_mismatch";
      case "idempotency_key_reused":
        return "operation_id_collision";
      case "not_found":
        return "page_not_found";
      case "unauthorized":
        return "authorization_denied";
      case "revision_conflict":
        return request.operation.kind === "move_page_in_library"
          ? "parent_revision_conflict"
          : "metadata_revision_conflict";
      case "store_corrupt":
      case "invalid_document_schema":
        return "document_state_corrupt";
      default:
        return "unknown";
    }
  })() satisfies PageLifecycleMutationErrorCodeV2;
  return parsePageLifecycleMutationCommandResultV2({
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
      retryable: coreError?.retryable ?? true,
      operationId: request.operationId,
      pageId: request.operation.pageId,
    },
  });
};

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
      case "unauthorized":
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
  if (target.kind === "database") {
    return { kind: target.kind, databaseId: parseDatabaseId(target.database_id) };
  }
  return { kind: target.kind, canvasId: target.canvas_id };
};

type CoreBlockPropertyMutation = Extract<
  LibraryIntent,
  { kind: "apply_block_property_mutation" }
>["mutation"];
type CoreBlockPropertyOutcome = NonNullable<
  Awaited<ReturnType<CoreClientPort["libraryApply"]>>["value"]["block_property_mutation"]
>["outcome"];

const toCoreBlockPropertyMutation = (
  fields: BlockPropertyMutationRequestV2["fields"],
  actor: BlockPropertyMutationRequestV2["actor"],
  clientSessionId: string | undefined,
): CoreBlockPropertyMutation => ({
  actor,
  client_session_id: clientSessionId ?? null,
  fields: fields.map((field) => ({
    kind: "intrinsic_set" as const,
    block_id: field.blockId,
    property_key: field.propertyKey,
    expected_revision: field.expectedRevision,
    value: field.value,
  })),
});

const fromCoreBlockPropertyField = (
  field: Extract<CoreBlockPropertyOutcome, { status: "committed" }>["fields"][number],
): BlockPropertyMutationFieldResultV2 => {
  if (field.scope !== "intrinsic") {
    throw new Error("Core returned retired Data Source Property mutation evidence");
  }
  return {
    path: field.path,
    scope: "intrinsic",
    blockId: field.block_id,
    propertyKey: field.property_key,
    operation: "set",
    revision: field.revision,
    value: field.value as BlockPropertyMutationFieldResultV2["value"],
  };
};

const blockPropertyFailure = (
  mutationId: string,
  error: unknown,
): BlockPropertyMutationCommandResultV2 => {
  const coreError = error instanceof CoreModuleResponseError
    ? error.coreError
    : null;
  const code = (() => {
    switch (coreError?.code) {
      case "invalid_input":
        return "invalid_property_mutation_request";
      case "stale_store_epoch":
        return "store_epoch_mismatch";
      case "idempotency_key_reused":
        return "mutation_id_collision";
      case "not_found":
        return "block_not_found";
      case "revision_conflict":
        return "property_conflict";
      default:
        return "unknown";
    }
  })() satisfies Extract<
    BlockPropertyMutationCommandResultV2,
    { readonly ok: false }
  >["error"]["code"];
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
      retryable: coreError?.retryable ?? true,
      mutationId,
    },
  };
};

const fromCoreBlockPropertyOutcome = (
  mutationId: string,
  outcome: CoreBlockPropertyOutcome,
): Extract<BlockPropertyMutationCommandResultV2, { readonly ok: false }> | null => {
  if (outcome.status === "committed") return null;
  return {
    ok: false,
    error: {
      code: outcome.error.code,
      message: outcome.error.message,
      retryable: outcome.error.retryable,
      mutationId,
      ...(outcome.error.field_path === undefined
        || outcome.error.field_path === null
        ? {}
        : { fieldPath: outcome.error.field_path }),
      ...(outcome.error.expected_revision === undefined
        || outcome.error.expected_revision === null
        ? {}
        : { expectedRevision: outcome.error.expected_revision }),
      ...(outcome.error.actual_revision === undefined
        || outcome.error.actual_revision === null
        ? {}
        : { actualRevision: outcome.error.actual_revision }),
    },
  };
};

const applyCanonicalPageCreate = async (
  input: CoreLibraryModuleAdapterInput,
  request: LibraryModuleApplyRequest & {
    readonly operation: Extract<LibraryApplyOperation, { readonly kind: "create_page" }>;
  },
): Promise<LibraryModuleApplyReceipt> => {
  const parent = canonicalPageParent(input.libraryId, request.operation.parent);
  const read = {
    kind: "window" as const,
    parent: parent.kind === "library"
      ? { kind: "library" as const }
      : { kind: "block" as const, id: parent.blockId },
    include_content: false,
    include_descendants: false,
  } as const;
  const snapshot = await input.client.blockRecordRead(read);
  if (
    snapshot.library_id !== input.libraryId
    || snapshot.observed_cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Page creation escaped its BlockRecord snapshot boundary");
  }
  const window = blockRecordSnapshotToWindow(snapshot, read);
  const siblings = window.placements
    .filter((placement) => {
      if (parent.kind === "library") {
        return placement.parent.kind === "library";
      }
      return placement.parent.kind === "block" && placement.parent.blockId === parent.blockId;
    })
    .sort((left, right) => (
      left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
    ))
    .map((placement) => ({ id: placement.blockId, rankKey: placement.rankKey }));
  const before = request.operation.parent.before;
  if (before) {
    const anchor = window.placements.find((placement) => placement.blockId === before.blockId);
    if (!anchor || anchor.revision !== before.expectedLocationRevision) {
      throw new Error("Canonical Page creation anchor is stale");
    }
  }
  const rank = planFractionalRank(siblings, request.operation.pageId, before?.blockId);
  const apply = await buildCreateBlockRecordApplyInput({
    operationId: request.operationId,
    actorId: canonicalPageActorId(input.profileId),
    sessionId: canonicalPageSessionId(input.libraryId),
    blockId: request.operation.pageId,
    blockKind: "page",
    properties: {
      title: request.operation.title,
      createdAt: request.operationId,
    },
    contentShardId: `block-record-shard:${request.operation.pageId}`,
    parent,
    rankKey: rank.rankKey,
    materializedJson: plainTextToPortableRichText(request.operation.title),
    placementRebalances: [...rank.rebalancedRankKeys].map(([blockId, rankKey]) => {
      const placement = window.placements.find((candidate) => candidate.blockId === blockId);
      if (!placement) throw new Error(`Canonical Page sibling ${blockId} is not loaded`);
      return {
        blockId,
        rankKey,
        expectedRevision: placement.revision,
      };
    }),
  });
  const committed = await applyBlockRecordWithResolution({
    client: input.client,
    input: apply,
    storeEpoch: input.storeEpoch,
  });
  if (
    committed.operation_id !== request.operationId
    || committed.cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Page creation receipt escaped its operation boundary");
  }
  return {
    version: request.version,
    operationId: request.operationId,
    storeEpoch: committed.cursor.store_epoch,
    libraryId: input.libraryId,
    operationKind: request.operation.kind,
    duplicate: committed.duplicate,
    didMutate: !committed.duplicate,
    createdTarget: { kind: "page", pageId: request.operation.pageId },
    canvasMutation: null,
    affectedParentKeys: [canonicalPageParentKey(request.operation.parent)],
    affectedPageIds: [request.operation.pageId],
    affectedDatabaseIds: [],
    affectedViewIds: [],
    committedRevisions: {
      [`blockMetadata:${request.operation.pageId}`]: canonicalPublicRevision(0),
      [`blockLocation:${request.operation.pageId}`]: canonicalPublicRevision(0),
    },
    changeLogSeq: committed.cursor.commit_seq,
    committedAt: committed.committed_at,
  };
};

const readCanonicalPageWithLifecycle = async (
  input: CoreLibraryModuleAdapterInput,
  pageId: string,
  includeArchived: boolean,
) => {
  const read = {
    kind: "window" as const,
    block_ids: [pageId],
    include_content: false,
    include_descendants: false,
    include_archived: includeArchived,
  } as const;
  const snapshot = await input.client.blockRecordRead(read);
  if (
    snapshot.library_id !== input.libraryId
    || snapshot.observed_cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Page lookup escaped its BlockRecord snapshot boundary");
  }
  const window = blockRecordSnapshotToWindow(snapshot, read);
  const record = window.records.find((candidate) => candidate.id === pageId);
  const placement = window.placements.find((candidate) => candidate.blockId === pageId);
  if (!record || record.kind !== "page" || !placement) {
    return null;
  }
  return { read, snapshot, window, record, placement };
};

const readCanonicalPage = async (
  input: CoreLibraryModuleAdapterInput,
  pageId: string,
) => {
  const page = await readCanonicalPageWithLifecycle(input, pageId, false);
  return page?.record.lifecycle === "active" ? page : null;
};

const readCanonicalArchivedPage = async (
  input: CoreLibraryModuleAdapterInput,
  pageId: string,
) => {
  const page = await readCanonicalPageWithLifecycle(input, pageId, true);
  return page?.record.lifecycle === "archived" ? page : null;
};

const readCanonicalParentWindow = async (
  input: CoreLibraryModuleAdapterInput,
  parent: LibraryWriteParent | BlockPlacementParent,
) => {
  const canonicalParent = parent.kind === "library"
    ? { kind: "library" as const, libraryId: input.libraryId }
    : parent.kind === "page"
      ? { kind: "block" as const, blockId: parent.pageId }
      : parent;
  const read = {
    kind: "window" as const,
    parent: canonicalParent.kind === "library"
      ? { kind: "library" as const }
      : canonicalParent.kind === "block"
        ? { kind: "block" as const, id: canonicalParent.blockId }
        : { kind: "data_source" as const, id: canonicalParent.dataSourceId },
    include_content: false,
    include_descendants: false,
  } as const;
  const snapshot = await input.client.blockRecordRead(read);
  if (
    snapshot.library_id !== input.libraryId
    || snapshot.observed_cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Library parent escaped its BlockRecord snapshot boundary");
  }
  return {
    canonicalParent,
    read,
    snapshot,
    window: blockRecordSnapshotToWindow(snapshot, read),
  };
};

const applyCanonicalPageMove = async (
  input: CoreLibraryModuleAdapterInput,
  request: LibraryModuleApplyRequest & {
    readonly operation: Extract<LibraryApplyOperation, { readonly kind: "move_block" }>;
  },
): Promise<LibraryModuleApplyReceipt | null> => {
  if (request.operation.target.kind !== "page") return null;
  const source = await readCanonicalPage(input, request.operation.target.pageId);
  if (!source) return null;
  if (
    request.operation.target.expectedLocationRevision
    !== canonicalPublicRevision(source.placement.revision)
  ) {
    throw new Error("Canonical Page moved since this action began");
  }

  const destination = await readCanonicalParentWindow(input, request.operation.parent);
  const targetPageId = request.operation.parent.kind === "page"
    ? request.operation.parent.pageId
    : null;
  if (targetPageId) {
    const target = destination.window.records.find((record) => (
      record.id === targetPageId
    ));
    if (!target || target.kind !== "page" || target.lifecycle !== "active") {
      throw new Error("Canonical destination Page is unavailable");
    }
    if (target.id === source.record.id) {
      throw new Error("A Page cannot move below itself");
    }
  }
  const anchor = request.operation.parent.before;
  if (anchor) {
    const anchorPlacement = destination.window.placements.find(
      (placement) => placement.blockId === anchor.blockId,
    );
    if (
      !anchorPlacement
      || anchorPlacement.revision + 1 !== anchor.expectedLocationRevision
    ) {
      throw new Error("Canonical destination anchor is stale");
    }
  }
  const siblings = destination.window.placements
    .filter((placement) => (
      destination.canonicalParent.kind === "library"
        ? placement.parent.kind === "library"
        : destination.canonicalParent.kind === "block"
          ? placement.parent.kind === "block"
            && placement.parent.blockId === destination.canonicalParent.blockId
          : placement.parent.kind === "dataSource"
            && placement.parent.dataSourceId === destination.canonicalParent.dataSourceId
    ))
    .sort((left, right) => (
      left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
    ))
    .map((placement) => ({ id: placement.blockId, rankKey: placement.rankKey }));
  const rank = planFractionalRank(siblings, source.record.id, anchor?.blockId);
  const apply = await buildMoveManyBlockRecordApplyInput({
    operationId: request.operationId,
    actorId: canonicalPageActorId(input.profileId),
    sessionId: canonicalPageSessionId(input.libraryId),
    entries: [{
      blockId: source.record.id,
      targetParent: destination.canonicalParent,
      rankKey: rank.rankKey,
      expectedBlockRevision: source.record.revision,
      expectedPlacementRevision: source.placement.revision,
    }],
    placementRebalances: [...rank.rebalancedRankKeys].map(([blockId, rankKey]) => {
      const placement = destination.window.placements.find(
        (candidate) => candidate.blockId === blockId,
      );
      if (!placement) throw new Error(`Canonical sibling ${blockId} is not loaded`);
      return {
        blockId,
        rankKey,
        expectedRevision: placement.revision,
      };
    }),
  });
  const committed = await applyBlockRecordWithResolution({
    client: input.client,
    input: apply,
    storeEpoch: input.storeEpoch,
  });
  if (
    committed.operation_id !== request.operationId
    || committed.cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Page move receipt escaped its operation boundary");
  }
  const nextPlacementRevision = canonicalPublicRevision(source.placement.revision + 1);
  const affectedParentKeys = [
    canonicalPlacementKey(source.placement.parent),
    canonicalPlacementKey(destination.canonicalParent),
  ].filter((key, index, keys) => keys.indexOf(key) === index);
  return {
    version: request.version,
    operationId: request.operationId,
    storeEpoch: committed.cursor.store_epoch,
    libraryId: input.libraryId,
    operationKind: request.operation.kind,
    duplicate: committed.duplicate,
    didMutate: !committed.duplicate,
    createdTarget: null,
    canvasMutation: null,
    affectedParentKeys,
    affectedPageIds: [
      source.record.id,
      ...(request.operation.parent.kind === "page"
        ? [request.operation.parent.pageId]
        : []),
    ].filter((id, index, ids) => ids.indexOf(id) === index),
    affectedDatabaseIds: [],
    affectedViewIds: [],
    committedRevisions: {
      [`blockLocation:${source.record.id}`]: nextPlacementRevision,
    },
    changeLogSeq: committed.cursor.commit_seq,
    committedAt: committed.committed_at,
  };
};

const applyCanonicalPageArchive = async (
  input: CoreLibraryModuleAdapterInput,
  request: LibraryModuleApplyRequest & {
    readonly operation: Extract<LibraryApplyOperation, { readonly kind: "archive_resource" }>;
  },
): Promise<LibraryModuleApplyReceipt | null> => {
  if (request.operation.target.kind !== "page") return null;
  const source = await readCanonicalPage(input, request.operation.target.pageId);
  if (!source) return null;
  if (
    request.operation.target.expectedMetadataRevision
    !== canonicalPublicRevision(source.record.revision)
  ) {
    throw new Error("Canonical Page metadata changed since this action began");
  }
  const apply = await buildArchiveBlockRecordSubtreeApplyInput({
    operationId: request.operationId,
    actorId: canonicalPageActorId(input.profileId),
    sessionId: canonicalPageSessionId(input.libraryId),
    blockId: source.record.id,
    expectedBlockRevision: source.record.revision,
    expectedPlacementRevision: source.placement.revision,
  });
  const committed = await applyBlockRecordWithResolution({
    client: input.client,
    input: apply,
    storeEpoch: input.storeEpoch,
  });
  if (
    committed.operation_id !== request.operationId
    || committed.cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Page archive receipt escaped its operation boundary");
  }
  return {
    version: request.version,
    operationId: request.operationId,
    storeEpoch: committed.cursor.store_epoch,
    libraryId: input.libraryId,
    operationKind: request.operation.kind,
    duplicate: committed.duplicate,
    didMutate: !committed.duplicate,
    createdTarget: null,
    canvasMutation: null,
    affectedParentKeys: [canonicalPlacementKey(source.placement.parent)],
    affectedPageIds: [source.record.id],
    affectedDatabaseIds: [],
    affectedViewIds: [],
    committedRevisions: {
      [`blockMetadata:${source.record.id}`]: canonicalPublicRevision(source.record.revision + 1),
    },
    changeLogSeq: committed.cursor.commit_seq,
    committedAt: committed.committed_at,
  };
};

const applyCanonicalPageRestore = async (
  input: CoreLibraryModuleAdapterInput,
  request: LibraryModuleApplyRequest & {
    readonly operation: Extract<LibraryApplyOperation, { readonly kind: "restore_resource" }>;
  },
): Promise<LibraryModuleApplyReceipt | null> => {
  if (request.operation.target.kind !== "page") return null;
  const source = await readCanonicalArchivedPage(input, request.operation.target.pageId);
  if (!source) return null;
  if (
    request.operation.target.expectedMetadataRevision
    !== canonicalPublicRevision(source.record.revision)
  ) {
    throw new Error("Canonical Page metadata changed since this action began");
  }
  if (source.placement.parent.kind === "block") {
    const parent = await readCanonicalPage(input, source.placement.parent.blockId);
    if (!parent) {
      throw new Error("Canonical Page restore parent is still archived");
    }
  }
  const destination = await readCanonicalParentWindow(input, source.placement.parent);
  const siblings = destination.window.placements
    .filter((placement) => (
      destination.canonicalParent.kind === "library"
        ? placement.parent.kind === "library"
        : destination.canonicalParent.kind === "block"
          ? placement.parent.kind === "block"
            && placement.parent.blockId === destination.canonicalParent.blockId
          : placement.parent.kind === "dataSource"
            && placement.parent.dataSourceId === destination.canonicalParent.dataSourceId
    ))
    .sort((left, right) => (
      left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
    ))
    .map((placement) => ({ id: placement.blockId, rankKey: placement.rankKey }));
  const archivedRank = activeRankFromArchived(
    source.record.id,
    source.placement.rankKey,
  );
  const rank = archivedRank
    && !siblings.some((sibling) => sibling.rankKey === archivedRank)
    ? { rankKey: archivedRank, rebalancedRankKeys: new Map<string, string>() }
    : planFractionalRank(siblings, source.record.id);
  const apply = await buildRestoreBlockRecordSubtreeApplyInput({
    operationId: request.operationId,
    actorId: canonicalPageActorId(input.profileId),
    sessionId: canonicalPageSessionId(input.libraryId),
    blockId: source.record.id,
    targetParent: source.placement.parent,
    rankKey: rank.rankKey,
    expectedBlockRevision: source.record.revision,
    expectedPlacementRevision: source.placement.revision,
    placementRebalances: [...rank.rebalancedRankKeys].map(([blockId, rankKey]) => {
      const placement = destination.window.placements.find(
        (candidate) => candidate.blockId === blockId,
      );
      if (!placement) throw new Error(`Canonical sibling ${blockId} is not loaded`);
      return {
        blockId,
        rankKey,
        expectedRevision: placement.revision,
      };
    }),
  });
  const committed = await applyBlockRecordWithResolution({
    client: input.client,
    input: apply,
    storeEpoch: input.storeEpoch,
  });
  if (
    committed.operation_id !== request.operationId
    || committed.cursor.store_epoch !== input.storeEpoch
  ) {
    throw new Error("Canonical Page restore receipt escaped its operation boundary");
  }
  const nextRevision = canonicalPublicRevision(source.record.revision + 1);
  const affectedParentKeys = [canonicalPlacementKey(source.placement.parent)];
  return {
    version: request.version,
    operationId: request.operationId,
    storeEpoch: committed.cursor.store_epoch,
    libraryId: input.libraryId,
    operationKind: request.operation.kind,
    duplicate: committed.duplicate,
    didMutate: !committed.duplicate,
    createdTarget: null,
    canvasMutation: null,
    affectedParentKeys,
    affectedPageIds: [source.record.id],
    affectedDatabaseIds: [],
    affectedViewIds: [],
    committedRevisions: {
      [`blockMetadata:${source.record.id}`]: nextRevision,
      [`blockLocation:${source.record.id}`]: nextRevision,
    },
    changeLogSeq: committed.cursor.commit_seq,
    committedAt: committed.committed_at,
  };
};

export const createCoreLibraryModuleAdapter = (
  input: CoreLibraryModuleAdapterInput,
): CoreLibraryModuleAdapter => {
  const readPageDetail = async (
    pageId: string,
    minimumCommitSeq = 0,
  ): Promise<CorePageDetail> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
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
      if (snapshot.event_head >= minimumCommitSeq) return detail;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(
      `Core Page Detail read did not reach local commit ${minimumCommitSeq}`,
    );
  };

  const readCanonicalPageDetail = async (
    pageId: string,
    minimumCommitSeq = 0,
  ): Promise<LibraryPageDetailResult> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const read = {
        kind: "window" as const,
        block_ids: [pageId],
        include_content: true,
        include_descendants: false,
      } as const;
      const snapshot = await input.client.blockRecordRead(read);
      if (
        snapshot.library_id !== input.libraryId
        || snapshot.observed_cursor.store_epoch !== input.storeEpoch
      ) {
        throw new Error("Canonical Page Detail escaped its BlockRecord snapshot boundary");
      }
      if (snapshot.observed_cursor.commit_seq < minimumCommitSeq) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        continue;
      }
      const window = blockRecordSnapshotToWindow(snapshot, read);
      const record = window.records.find((candidate) => candidate.id === pageId);
      const placement = window.placements.find((candidate) => candidate.blockId === pageId);
      if (!record || record.kind !== "page" || !placement) {
        throw new Error("Canonical Page is unavailable");
      }
      const titleContent = window.content.find((candidate) => (
        candidate.blockId === pageId && candidate.slot === "title"
      ));
      const title = typeof titleContent?.content === "object"
        && titleContent.content !== null
        ? (() => {
            const plainText = Array.isArray(titleContent.content)
              ? titleContent.content
                  .filter((item): item is { readonly type?: unknown; readonly text?: unknown } => (
                    typeof item === "object" && item !== null
                  ))
                  .filter((item) => item.type === "text" && typeof item.text === "string")
                  .map((item) => item.text as string)
                  .join("")
              : "";
            return plainText || (typeof record.properties.title === "string"
              ? record.properties.title
              : "Untitled");
          })()
        : typeof record.properties.title === "string"
          ? record.properties.title
          : "Untitled";
      const richTitle = titleContent?.content ?? plainTextToPortableRichText(title);
      const parent = placement.parent.kind === "library"
        ? { kind: "library" as const, libraryId: input.libraryId }
        : placement.parent.kind === "dataSource"
          ? { kind: "data_source" as const, dataSourceId: placement.parent.dataSourceId }
          : { kind: "page" as const, pageId: placement.parent.blockId };
      return parseLibraryPageDetailResult({
        ok: true,
        value: {
          version: 3,
          libraryId: input.libraryId,
          storeEpoch: snapshot.observed_cursor.store_epoch,
          changeLogSeq: snapshot.observed_cursor.commit_seq,
          page: {
            pageId,
            libraryId: input.libraryId,
            parent,
            lifecycle: record.lifecycle,
            parentRevision: placement.revision,
            metadataRevision: record.revision,
            documentId: `block-record:${pageId}`,
            documentGeneration: 0,
            documentHeadSeq: 0,
            title,
            richTitle,
            preview: "",
            plainText: "",
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          document: {
            readiness: "ready",
            schemaKey: "nodex.block-record",
            schemaVersion: 1,
          },
          intrinsicProperties: [],
          dataSourceContext: { kind: "standalone" },
          accessContext: { kind: "library" },
        },
      });
    }
    throw new Error(`Canonical Page Detail did not reach local commit ${minimumCommitSeq}`);
  };

  const applyBlockProperty = async (request: {
    readonly mutationId: string;
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly clientSessionId?: string;
    readonly actor: BlockPropertyMutationRequestV2["actor"];
    readonly fields: BlockPropertyMutationRequestV2["fields"];
  }): Promise<BlockPropertyMutationCommandResultV2> => {
    if (request.storeEpoch !== input.storeEpoch) {
      return {
        ok: false,
        error: {
          code: "store_epoch_mismatch",
          message: "Property mutation targets a stale Store epoch",
          retryable: false,
          mutationId: request.mutationId,
        },
      };
    }
    try {
      const committed = await input.client.libraryApply({
        operationId: request.mutationId,
        intent: {
          kind: "apply_block_property_mutation",
          mutation: toCoreBlockPropertyMutation(
            request.fields,
            request.actor,
            request.clientSessionId,
          ),
        },
      });
      const receipt = committed.value.block_property_mutation;
      if (
        !receipt
        || committed.store_epoch !== request.storeEpoch
        || committed.receipt.operation_id !== request.mutationId
        || committed.receipt.operation_kind !== "property_batch"
      ) {
        throw new Error(
          "Core Property mutation receipt escaped its operation boundary",
        );
      }
      const rejected = fromCoreBlockPropertyOutcome(
        request.mutationId,
        receipt.outcome,
      );
      if (rejected) return rejected;
      if (receipt.outcome.status !== "committed") {
        throw new Error("Core returned an invalid Property mutation outcome");
      }
      return parseBlockPropertyMutationCommandResultV2({
        ok: true,
        value: {
          version: 2,
          mutationId: request.mutationId,
          projectId: request.projectId,
          storeEpoch: committed.store_epoch,
          duplicate: committed.receipt.duplicate,
          fields: receipt.outcome.fields.map(fromCoreBlockPropertyField),
          blockMetadataRevisions:
            receipt.outcome.block_metadata_revisions,
          changeLogSeq: committed.receipt.change_log_seq,
          committedAt: committed.receipt.committed_at,
        },
      });
    } catch (error) {
      return blockPropertyFailure(request.mutationId, error);
    }
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
        if (request.operation.kind === "create_page") {
          const pageRequest = request as LibraryModuleApplyRequest & {
            readonly operation: Extract<LibraryApplyOperation, { readonly kind: "create_page" }>;
          };
          return {
            ok: true,
            value: await applyCanonicalPageCreate(input, pageRequest),
          };
        }
        if (request.operation.kind === "move_block") {
          const canonicalReceipt = await applyCanonicalPageMove(input, request as LibraryModuleApplyRequest & {
            readonly operation: Extract<LibraryApplyOperation, { readonly kind: "move_block" }>;
          });
          if (canonicalReceipt) return { ok: true, value: canonicalReceipt };
        }
        if (request.operation.kind === "archive_resource") {
          const canonicalReceipt = await applyCanonicalPageArchive(input, request as LibraryModuleApplyRequest & {
            readonly operation: Extract<LibraryApplyOperation, { readonly kind: "archive_resource" }>;
          });
          if (canonicalReceipt) return { ok: true, value: canonicalReceipt };
        }
        if (request.operation.kind === "restore_resource") {
          const canonicalReceipt = await applyCanonicalPageRestore(input, request as LibraryModuleApplyRequest & {
            readonly operation: Extract<LibraryApplyOperation, { readonly kind: "restore_resource" }>;
          });
          if (canonicalReceipt) return { ok: true, value: canonicalReceipt };
        }
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
            canvasMutation: committed.value.canvas_mutation
              ? {
                  operationKind:
                    committed.value.canvas_mutation.operation_kind,
                  canvasId: committed.value.canvas_mutation.canvas_id,
                  documentId: committed.value.canvas_mutation.document_id,
                  sourceCanvasId:
                    committed.value.canvas_mutation.source_canvas_id ?? null,
                  locationRevision:
                    committed.value.canvas_mutation.location_revision,
                  metadataRevision:
                    committed.value.canvas_mutation.metadata_revision,
                  documentCommits:
                    committed.value.canvas_mutation.document_commits.map(
                      (commit) => ({
                        documentId: commit.document_id,
                        generation: commit.generation,
                        baseHeadSeq: commit.base_head_seq,
                        headSeq: commit.head_seq,
                        updateId: commit.update_id,
                        update: Uint8Array.from(commit.update),
                        stateVector: Uint8Array.from(commit.state_vector),
                      }),
                    ),
                }
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
    readProjectPageDetail: async (projectId, pageId, minimumCommitSeq) => {
      try {
        return parsePageDetailResult({
          ok: true,
          value: {
            ...mapPageDetail(await readPageDetail(pageId, minimumCommitSeq)),
            projectId,
          },
        });
      } catch (error) {
        return { ok: false, error: pageDetailError(error) };
      }
    },
    readLibraryPageDetail: async (pageId, minimumCommitSeq) => {
      try {
        let canonicalPage: Awaited<ReturnType<typeof readCanonicalPage>> = null;
        try {
          canonicalPage = await readCanonicalPage(input, pageId);
        } catch {
          // A legacy Page detail remains the fallback while the canonical
          // BlockRecord catalog is being cut over. The final one-big model
          // removes this probe and the legacy branch together.
        }
        if (canonicalPage) {
          return await readCanonicalPageDetail(pageId, minimumCommitSeq);
        }
        return parseLibraryPageDetailResult({
          ok: true,
          value: {
            ...mapPageDetail(await readPageDetail(pageId, minimumCommitSeq)),
            accessContext: { kind: "library" },
          },
        });
      } catch (error) {
        if (
          error instanceof CoreModuleResponseError
          && error.coreError.code === "not_found"
        ) {
          try {
            return await readCanonicalPageDetail(pageId, minimumCommitSeq);
          } catch {
            // Preserve the established Library error mapping when neither
            // canonical nor legacy Page authority can serve the request.
          }
        }
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
          || typeof item.title !== "string"
          || !isWorkflowStatus(item.status)
          || !Number.isSafeInteger(item.score)
          || item.score < 1
        ) {
          throw new Error("Core Project Page search returned invalid evidence");
        }
        return {
          projectId: item.project_id,
          pageId: item.page_id,
          title: item.title,
          status: item.status,
          score: item.score,
          excerpt: item.excerpt,
        };
      });
    },
    resolvePageTarget: async (request) => {
      const snapshot = await input.client.libraryRead({
        kind: "page_target",
        page_id: request.targetPageId,
      });
      if (snapshot.value.kind !== "page_target") {
        throw new Error("Core returned a non-Page-target Library read value");
      }
      const value = snapshot.value.value;
      if (!value) return null;
      if (value.target_page_id !== request.targetPageId) {
        throw new Error("Core Page target escaped its requested identity");
      }
      return mapPageTarget(value, {
        libraryId: input.libraryId,
        storeEpoch: snapshot.store_epoch,
        changeLogSeq: snapshot.event_head,
      });
    },
    resolvePageOwnershipPath: async (request) => {
      const snapshot = await input.client.libraryRead({
        kind: "page_ownership_path",
        page_id: request.targetPageId,
      });
      if (snapshot.value.kind !== "page_ownership_path") {
        throw new Error("Core returned a non-ownership-path Library read value");
      }
      const value = snapshot.value.value;
      if (!value) return null;
      if (value.target_page_id !== request.targetPageId) {
        throw new Error("Core Page ownership path escaped its requested identity");
      }
      return mapPageOwnershipPath(value, {
        libraryId: input.libraryId,
        storeEpoch: snapshot.store_epoch,
        changeLogSeq: snapshot.event_head,
      });
    },
    findPageLocation: async (pageId) => {
      const snapshot = await input.client.libraryRead({
        kind: "page_location",
        page_id: pageId,
      });
      if (snapshot.value.kind !== "page_location") {
        throw new Error("Core returned a non-Page-location Library read value");
      }
      const value = snapshot.value.value;
      if (!value) return null;
      if (value.page_id !== pageId || !value.project_id) {
        throw new Error("Core Page location escaped its requested identity");
      }
      return { pageId: value.page_id, projectId: value.project_id };
    },
    findViewLocation: async (viewId) => {
      const snapshot = await input.client.libraryRead({
        kind: "view_location",
        view_id: viewId,
      });
      if (snapshot.value.kind !== "view_location") {
        throw new Error("Core returned a non-View-location Library read value");
      }
      const value = snapshot.value.value;
      if (!value) return null;
      if (value.view_id !== viewId || !value.project_id) {
        throw new Error("Core View location escaped its requested identity");
      }
      return {
        viewId: value.view_id,
        dataSourceId: value.data_source_id,
        databaseId: value.database_id,
        projectId: value.project_id,
      };
    },
    readPageLifecyclePreflight: async (projectId, pageId) => {
      try {
        const snapshot = await input.client.libraryRead({
          kind: "page_lifecycle_preflight",
          page_id: pageId,
        });
        if (
          snapshot.value.kind !== "page_lifecycle_preflight"
          || snapshot.store_epoch !== input.storeEpoch
        ) {
          throw new Error(
            "Core Page lifecycle preflight escaped its snapshot boundary",
          );
        }
        return parsePageLifecyclePreflightResultV2({
          ok: true,
          value: {
            version: 2,
            projectId,
            libraryId: input.libraryId,
            storeEpoch: snapshot.store_epoch,
            changeLogSeq: snapshot.event_head,
            value: mapPageLifecyclePreflight(snapshot.value.value),
          },
        });
      } catch (error) {
        return pageLifecyclePreflightFailure(error);
      }
    },
    applyPageLifecycleMutation: async (request) => {
      if (request.storeEpoch !== input.storeEpoch) {
        return parsePageLifecycleMutationCommandResultV2({
          ok: false,
          error: {
            code: "store_epoch_mismatch",
            message: "Page lifecycle operation targets a stale Store epoch",
            retryable: false,
            operationId: request.operationId,
            pageId: request.operation.pageId,
          },
        });
      }
      try {
        const committed = await input.client.libraryApply({
          operationId: request.operationId,
          intent: {
            kind: "apply_page_lifecycle",
            mutation: toCorePageLifecycleMutation(request.operation),
          },
        });
        const lifecycle = committed.value.page_lifecycle;
        if (
          !lifecycle
          || committed.store_epoch !== request.storeEpoch
          || committed.receipt.operation_id !== request.operationId
          || committed.receipt.operation_kind !== request.operation.kind
          || lifecycle.operation_kind !== request.operation.kind
          || lifecycle.page_id !== request.operation.pageId
        ) {
          throw new Error(
            "Core Page lifecycle receipt escaped its operation boundary",
          );
        }
        return parsePageLifecycleMutationCommandResultV2({
          ok: true,
          value: {
            version: 2,
            operationKind: lifecycle.operation_kind,
            operationId: committed.receipt.operation_id,
            projectId: request.projectId,
            storeEpoch: committed.store_epoch,
            pageId: lifecycle.page_id,
            duplicate: committed.receipt.duplicate,
            metadataRevision: lifecycle.metadata_revision,
            parentRevision: lifecycle.parent_revision,
            lifecycle: lifecycle.lifecycle,
            documentId: lifecycle.document_id,
            documentGeneration: lifecycle.document_generation,
            documentHeadSeq: lifecycle.document_head_seq,
            databaseId: lifecycle.database_id,
            dataSourceId: lifecycle.data_source_id,
            membershipId: lifecycle.membership_id,
            viewId: lifecycle.view_id,
            libraryRankKey: lifecycle.library_rank_key,
            viewRankKey: lifecycle.view_rank_key,
            createdBlockIds: lifecycle.created_block_ids,
            createdTagOptionIds: lifecycle.created_tag_option_ids,
            changeLogSeq: committed.receipt.change_log_seq,
            committedAt: committed.receipt.committed_at,
          },
        });
      } catch (error) {
        return pageLifecycleMutationFailure(request, error);
      }
    },
    applyBlockPropertyMutation: async (request) =>
      await applyBlockProperty(request),
    applyLibraryBlockPropertyMutation: async ({ request, actor }) => {
      const compatibilityProjectId = `library:${input.libraryId}`;
      const result = await applyBlockProperty({
        ...request,
        projectId: compatibilityProjectId,
        actor,
      });
      if (!result.ok) return result;
      return parseLibraryBlockPropertyMutationCommandResultV2({
        ok: true,
        value: {
          version: result.value.version,
          mutationId: result.value.mutationId,
          accessContext: { kind: "library" },
          storeEpoch: result.value.storeEpoch,
          duplicate: result.value.duplicate,
          fields: result.value.fields,
          blockMetadataRevisions: result.value.blockMetadataRevisions,
          changeLogSeq: result.value.changeLogSeq,
          committedAt: result.value.committedAt,
        },
      });
    },
  };
};
