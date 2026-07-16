import type { BlockPropertyJsonValue } from "./block-property-mutations";
import {
  parsePageLifecycleMutationRequest,
  type PageLifecycleMutationCommandError,
  type PageLifecycleMutationCommandResult,
  type PageLifecycleMutationReceipt,
  type PageLifecycleMutationRequest,
} from "./page-lifecycle";
import type { WorkflowStatus } from "./workflow-status";
import type { DatabaseViewQueryResult } from "./database-module";
import type { PageParent } from "./page";
import type { DatabasePage, PageCreateInput, PageCreatePlacement } from "./types";

export const PAGE_LIFECYCLE_PREFLIGHT_VERSION = 1 as const;

export interface PageLifecycleDocumentCoordinate {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
  readonly schemaKey: string;
  readonly schemaVersion: number;
}

export interface PageLifecycleMembershipCoordinate {
  readonly membershipId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly membershipRevision: number;
  readonly viewId: string;
  readonly viewRevision: number;
  readonly statusPropertyId: string;
  readonly statusValueRevision: number;
  readonly status: WorkflowStatus;
  readonly position: Readonly<{
    groupKey: string | null;
    rankKey: string;
    revision: number;
  }> | null;
}

export interface PageLifecycleRestoreEvidence {
  readonly deleteOperationId: string;
  readonly previousLifecycle: "active" | "archived";
  readonly membership: null | Readonly<{
    membershipId: string;
    databaseId: string;
    dataSourceId: string;
    status: WorkflowStatus;
    position: null | Readonly<{ viewId: string }>;
  }>;
}

export interface PageLifecycleOwnedBlockAuthority {
  readonly pageId: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly parent: PageParent;
  /** Present only while the Page is directly owned by the Library. */
  readonly libraryRankKey: string | null;
  readonly metadataRevision: number;
  readonly parentRevision: number;
  readonly document: PageLifecycleDocumentCoordinate;
  readonly membership: PageLifecycleMembershipCoordinate | null;
  readonly restoreEvidence: PageLifecycleRestoreEvidence | null;
}

/**
 * One SQLite read snapshot used to compile a lifecycle command. Descriptor,
 * evaluated primary View, owned Block, membership, and delete evidence all
 * share the outer storeEpoch/changeLogSeq coordinate.
 */
export interface PageLifecyclePreflight {
  readonly version: typeof PAGE_LIFECYCLE_PREFLIGHT_VERSION;
  readonly defaultView: DatabaseViewQueryResult;
  /** Non-null when the requested application identity belongs to another Block type. */
  readonly reservedBlockType: string | null;
  readonly page: PageLifecycleOwnedBlockAuthority | null;
}

export interface PageLifecyclePreflightSnapshot {
  readonly version: typeof PAGE_LIFECYCLE_PREFLIGHT_VERSION;
  readonly projectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly value: PageLifecyclePreflight;
}

export type PageLifecyclePreflightErrorCode =
  | "invalid_request"
  | "store_not_initialized"
  | "project_not_found"
  | "page_not_found"
  | "authorization_denied"
  | "state_corrupt"
  | "unknown";

export type PageLifecyclePreflightResult =
  | { readonly ok: true; readonly value: PageLifecyclePreflightSnapshot }
  | {
      readonly ok: false;
      readonly error: Readonly<{
        code: PageLifecyclePreflightErrorCode;
        message: string;
        retryable: boolean;
      }>;
    };

interface PageLifecycleIntentBase {
  readonly projectId: string;
  readonly operationId: string;
  readonly clientSessionId?: string;
}

export type PageLifecycleIntent =
  | (PageLifecycleIntentBase & {
      readonly kind: "create";
      readonly pageId: string;
      readonly status: WorkflowStatus;
      readonly input: PageCreateInput;
      readonly placement?: PageCreatePlacement;
    })
  | (PageLifecycleIntentBase & {
      readonly kind: "archive";
      readonly pageId: string;
    })
  | (PageLifecycleIntentBase & {
      readonly kind: "unarchive";
      readonly pageId: string;
    })
  | (PageLifecycleIntentBase & {
      readonly kind: "delete";
      readonly pageId: string;
    })
  | (PageLifecycleIntentBase & {
      readonly kind: "restore";
      readonly pageId: string;
      readonly beforeBlockId?: string;
      readonly beforeViewPageId?: string;
    })
  | (PageLifecycleIntentBase & {
      readonly kind: "move_in_library";
      readonly pageId: string;
      readonly beforeBlockId?: string;
    });

export type PageLifecycleRuntimeErrorCode =
  | "preflight_unavailable"
  | "preflight_mismatch"
  | "page_identity_collision"
  | "page_not_found"
  | "page_lifecycle_conflict"
  | "page_parent_invalid"
  | "restore_evidence_missing"
  | "mutation_rejected"
  | "canonical_read_stale";

export class PageLifecycleRuntimeError extends Error {
  constructor(
    readonly code: PageLifecycleRuntimeErrorCode,
    message: string,
    readonly commandError?: PageLifecycleMutationCommandError,
  ) {
    super(message);
    this.name = "PageLifecycleRuntimeError";
  }
}

export interface PageLifecycleRuntimeDependencies {
  readonly readPreflight: (
    projectId: string,
    pageId: string,
  ) => Promise<PageLifecyclePreflightResult>;
  readonly mutate: (
    projectId: string,
    request: PageLifecycleMutationRequest,
  ) => Promise<PageLifecycleMutationCommandResult>;
  readonly readBoardProjection: (
    projectId: string,
    pageId: string,
  ) => Promise<DatabasePage | null>;
  readonly waitBeforeCanonicalReadRetry?: () => Promise<void>;
}

export interface PageLifecycleExecutionResult {
  readonly receipt: PageLifecycleMutationReceipt;
  /** Temporary single-Source Board projection; never Page authority. */
  readonly boardProjection: DatabasePage | null;
}

const fail = (
  code: PageLifecycleRuntimeErrorCode,
  message: string,
): never => {
  throw new PageLifecycleRuntimeError(code, message);
};

const canonicalDate = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

const canonicalDateTime = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const primaryView = (preflight: PageLifecyclePreflightSnapshot) => {
  const value = preflight.value;
  if (!value || value.version !== PAGE_LIFECYCLE_PREFLIGHT_VERSION) {
    return fail("preflight_mismatch", "Page lifecycle preflight is missing");
  }
  const query = value.defaultView;
  const { database, dataSource, view } = query;
  if (
    database.lifecycle !== "active" ||
    database.defaultViewId !== view.viewId ||
    dataSource.lifecycle !== "active" ||
    view.lifecycle !== "active" ||
    !view.isDefault ||
    view.kind !== "kanban" ||
    view.databaseId !== database.databaseId ||
    view.dataSourceId !== dataSource.dataSourceId
  ) {
    return fail(
      "preflight_mismatch",
      "Primary Database descriptor and View query do not share one authority",
    );
  }
  return query;
};

const requirePage = (
  preflight: PageLifecyclePreflightSnapshot,
  pageId: string,
): PageLifecycleOwnedBlockAuthority => {
  const page = preflight.value.page;
  if (!page || page.pageId !== pageId) {
    return fail("page_not_found", `Page does not exist: ${pageId}`);
  }
  return page;
};

const requireTopLevelPage = (
  preflight: PageLifecyclePreflightSnapshot,
  pageId: string,
): PageLifecycleOwnedBlockAuthority => {
  const page = requirePage(preflight, pageId);
  if (page.parent.kind !== "library" || page.libraryRankKey === null) {
    return fail(
      "page_parent_invalid",
      `Page ${pageId} is not a top-level Library Page`,
    );
  }
  return page;
};

const requireLifecyclePage = (
  preflight: PageLifecyclePreflightSnapshot,
  pageId: string,
): PageLifecycleOwnedBlockAuthority => {
  const page = requirePage(preflight, pageId);
  if (page.parent.kind === "page") {
    return fail(
      "page_parent_invalid",
      `Nested Page ${pageId} requires a Block transfer`,
    );
  }
  if (page.parent.kind === "library" && page.libraryRankKey === null) {
    return fail(
      "page_parent_invalid",
      `Library Page ${pageId} has no top-level placement`,
    );
  }
  if (
    page.parent.kind === "data_source" &&
    page.membership?.dataSourceId !== page.parent.dataSourceId
  ) {
    return fail(
      "preflight_mismatch",
      `Source Page ${pageId} has no matching active membership`,
    );
  }
  return page;
};

const createOperation = (
  intent: Extract<PageLifecycleIntent, { readonly kind: "create" }>,
  preflight: PageLifecyclePreflightSnapshot,
) => {
  if (preflight.value.page || preflight.value.reservedBlockType) {
    return fail(
      "page_identity_collision",
      `Page identity is already reserved: ${intent.pageId}`,
    );
  }
  const query = primaryView(preflight);
  const beforeViewPageId =
    intent.placement === "top"
      ? query.rows.find((row) => row.effectiveGroupKey === intent.status)?.page
          .pageId
      : typeof intent.placement === "object"
        ? intent.placement.beforePageId
        : undefined;
  const input = intent.input;
  return {
    kind: "create_page" as const,
    pageId: intent.pageId,
    title: input.title,
    nfm: input.description ?? "",
    status: intent.status,
    priority: input.priority ?? null,
    estimate: input.estimate ?? null,
    tags: input.tags ?? [],
    dueDate: canonicalDate(input.dueDate),
    scheduledStart: canonicalDateTime(input.scheduledStart),
    scheduledEnd: canonicalDateTime(input.scheduledEnd),
    isAllDay: input.isAllDay ?? false,
    recurrence: input.recurrence ?? null,
    reminders: input.reminders ?? [],
    scheduleTimezone: input.scheduleTimezone ?? null,
    assignee: input.assignee ?? null,
    runInTarget: input.runInTarget ?? "localProject",
    runInLocalPath: input.runInLocalPath ?? null,
    runInBaseBranch: input.runInBaseBranch ?? null,
    runInWorktreePath: input.runInWorktreePath ?? null,
    runInEnvironmentPath: input.runInEnvironmentPath ?? null,
    ...(beforeViewPageId ? { beforeViewPageId } : {}),
  };
};

export const compilePageLifecycleRequest = (input: {
  readonly intent: PageLifecycleIntent;
  readonly preflight: PageLifecyclePreflightSnapshot;
}): PageLifecycleMutationRequest => {
  const { intent, preflight } = input;
  if (
    preflight.projectId !== intent.projectId ||
    !preflight.storeEpoch ||
    preflight.value.version !== PAGE_LIFECYCLE_PREFLIGHT_VERSION
  ) {
    return fail(
      "preflight_mismatch",
      "Page lifecycle preflight does not match the requested Project",
    );
  }
  primaryView(preflight);

  let operation;
  if (intent.kind === "create") {
    operation = createOperation(intent, preflight);
  } else if (intent.kind === "archive") {
    const page = requireLifecyclePage(preflight, intent.pageId);
    if (page.lifecycle !== "active") {
      return fail(
        "page_lifecycle_conflict",
        `Page ${intent.pageId} is not active`,
      );
    }
    operation = {
      kind: "archive_page" as const,
      pageId: intent.pageId,
      expectedMetadataRevision: page.metadataRevision,
    };
  } else if (intent.kind === "unarchive") {
    const page = requireLifecyclePage(preflight, intent.pageId);
    if (page.lifecycle !== "archived") {
      return fail(
        "page_lifecycle_conflict",
        `Page ${intent.pageId} is not archived`,
      );
    }
    operation = {
      kind: "unarchive_page" as const,
      pageId: intent.pageId,
      expectedMetadataRevision: page.metadataRevision,
    };
  } else if (intent.kind === "delete") {
    const page = requireLifecyclePage(preflight, intent.pageId);
    if (page.lifecycle === "deleted") {
      return fail(
        "page_lifecycle_conflict",
        `Page ${intent.pageId} is already deleted`,
      );
    }
    operation = {
      kind: "delete_page" as const,
      pageId: intent.pageId,
      expectedMetadataRevision: page.metadataRevision,
      expectedParentRevision: page.parentRevision,
    };
  } else if (intent.kind === "restore") {
    const page = requirePage(preflight, intent.pageId);
    if (page.lifecycle !== "deleted") {
      return fail(
        "page_lifecycle_conflict",
        `Page ${intent.pageId} is not deleted`,
      );
    }
    const evidence = page.restoreEvidence;
    if (!evidence) {
      return fail(
        "restore_evidence_missing",
        `Page ${intent.pageId} has no valid delete receipt`,
      );
    }
    operation = {
      kind: "restore_page" as const,
      pageId: intent.pageId,
      deleteOperationId: evidence.deleteOperationId,
      expectedMetadataRevision: page.metadataRevision,
      expectedParentRevision: page.parentRevision,
      membership: evidence.membership,
      ...(intent.beforeBlockId ? { beforeBlockId: intent.beforeBlockId } : {}),
      ...(intent.beforeViewPageId && evidence.membership?.position
        ? {
            membership: {
              ...evidence.membership,
              position: {
                ...evidence.membership.position,
                beforeViewPageId: intent.beforeViewPageId,
              },
            },
          }
        : {}),
    };
  } else {
    const page = requireTopLevelPage(preflight, intent.pageId);
    if (page.lifecycle === "deleted") {
      return fail(
        "page_lifecycle_conflict",
        `Page ${intent.pageId} is deleted`,
      );
    }
    operation = {
      kind: "move_page_in_library" as const,
      pageId: intent.pageId,
      expectedParentRevision: page.parentRevision,
      ...(intent.beforeBlockId ? { beforeBlockId: intent.beforeBlockId } : {}),
    };
  }

  const actor = {
    kind: "page_lifecycle_runtime",
  } satisfies Readonly<Record<string, BlockPropertyJsonValue>>;
  return parsePageLifecycleMutationRequest({
    version: 1,
    operationId: intent.operationId,
    projectId: intent.projectId,
    storeEpoch: preflight.storeEpoch,
    ...(intent.clientSessionId
      ? { clientSessionId: intent.clientSessionId }
      : {}),
    actor,
    operation,
  });
};

const readBoardProjection = async (
  intent: PageLifecycleIntent,
  receipt: PageLifecycleMutationReceipt,
  dependencies: PageLifecycleRuntimeDependencies,
): Promise<DatabasePage | null> => {
  const expectsDeleted = receipt.lifecycle === "deleted";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const card = await dependencies.readBoardProjection(
      intent.projectId,
      receipt.pageId,
    );
    const matches = expectsDeleted
      ? card === null
      : card?.id === receipt.pageId &&
        card.archived === (receipt.lifecycle === "archived");
    if (matches) return card;
    if (attempt < 2) {
      await (dependencies.waitBeforeCanonicalReadRetry?.() ??
        Promise.resolve());
    }
  }
  return fail(
    "canonical_read_stale",
    `Board projection did not reach Page lifecycle ${receipt.lifecycle}`,
  );
};

/**
 * Execute one user lifecycle intent. A transport failure retries the exact
 * same request object, preserving operationId, epoch, revisions, and intent.
 */
export const executePageLifecycleIntent = async (
  intent: PageLifecycleIntent,
  dependencies: PageLifecycleRuntimeDependencies,
): Promise<PageLifecycleExecutionResult> => {
  const preflight = await dependencies.readPreflight(
    intent.projectId,
    intent.pageId,
  );
  if (!preflight.ok) {
    throw new PageLifecycleRuntimeError(
      "preflight_unavailable",
      preflight.error.message,
    );
  }
  const request = compilePageLifecycleRequest({
    intent,
    preflight: preflight.value,
  });
  let result: PageLifecycleMutationCommandResult;
  let retried = false;
  try {
    result = await dependencies.mutate(intent.projectId, request);
  } catch {
    retried = true;
    result = await dependencies.mutate(intent.projectId, request);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await dependencies.mutate(intent.projectId, request);
  }
  if (!result.ok) {
    throw new PageLifecycleRuntimeError(
      "mutation_rejected",
      result.error.message,
      result.error,
    );
  }
  return {
    receipt: result.value,
    boardProjection: await readBoardProjection(
      intent,
      result.value,
      dependencies,
    ),
  };
};
