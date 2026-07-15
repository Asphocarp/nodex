import type { BlockPropertyJsonValue } from "./block-property-mutations";
import {
  parseCardLifecycleMutationRequest,
  type CardLifecycleMutationCommandError,
  type CardLifecycleMutationCommandResult,
  type CardLifecycleMutationReceipt,
  type CardLifecycleMutationRequest,
} from "./card-lifecycle";
import type { CardStatus } from "./card-status";
import type {
  DatabaseReadCommandResult,
  DatabaseReadSnapshot,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
} from "./database-query";
import type { Card, CardCreateInput, CardCreatePlacement } from "./types";

export const CARD_LIFECYCLE_PREFLIGHT_VERSION = 1 as const;

export interface CardLifecycleDocumentCoordinate {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
  readonly schemaKey: string;
  readonly schemaVersion: number;
}

export interface CardLifecycleMembershipCoordinate {
  readonly membershipId: string;
  readonly databaseBlockId: string;
  readonly membershipRevision: number;
  readonly viewId: string;
  readonly viewRevision: number;
  readonly statusPropertyId: string;
  readonly statusValueRevision: number;
  readonly status: CardStatus;
  readonly position: Readonly<{
    groupKey: string | null;
    rankKey: string;
    revision: number;
  }> | null;
}

export interface CardLifecycleRestoreEvidence {
  readonly deleteOperationId: string;
  readonly previousLifecycle: "active" | "archived";
  readonly membership: null | Readonly<{
    membershipId: string;
    databaseBlockId: string;
    status: CardStatus;
    position: null | Readonly<{ viewId: string }>;
  }>;
}

export interface CardLifecycleOwnedBlockAuthority {
  readonly cardId: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location:
    | Readonly<{ kind: "space"; rankKey: string | null }>
    | Readonly<{ kind: "document"; documentId: string }>
    | Readonly<{ kind: "database"; databaseBlockId: string }>;
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly document: CardLifecycleDocumentCoordinate;
  readonly membership: CardLifecycleMembershipCoordinate | null;
  readonly restoreEvidence: CardLifecycleRestoreEvidence | null;
}

/**
 * One SQLite read snapshot used to compile a lifecycle command. Descriptor,
 * evaluated primary View, owned Block, membership, and delete evidence all
 * share the outer storeEpoch/changeLogSeq coordinate.
 */
export interface CardLifecyclePreflight {
  readonly version: typeof CARD_LIFECYCLE_PREFLIGHT_VERSION;
  readonly primaryDatabase: Readonly<{
    descriptor: GeneralDatabaseDescriptor;
    query: GeneralDatabaseViewQuery;
  }>;
  /** Non-null when the requested application identity belongs to another Block type. */
  readonly reservedBlockType: string | null;
  readonly card: CardLifecycleOwnedBlockAuthority | null;
}

export type CardLifecyclePreflightResult =
  DatabaseReadCommandResult<CardLifecyclePreflight>;
export type CardLifecyclePreflightSnapshot =
  DatabaseReadSnapshot<CardLifecyclePreflight>;

interface CardLifecycleIntentBase {
  readonly projectId: string;
  readonly operationId: string;
  readonly clientSessionId?: string;
}

export type CardLifecycleIntent =
  | (CardLifecycleIntentBase & {
      readonly kind: "create";
      readonly cardId: string;
      readonly status: CardStatus;
      readonly input: CardCreateInput;
      readonly placement?: CardCreatePlacement;
    })
  | (CardLifecycleIntentBase & {
      readonly kind: "archive";
      readonly cardId: string;
    })
  | (CardLifecycleIntentBase & {
      readonly kind: "unarchive";
      readonly cardId: string;
    })
  | (CardLifecycleIntentBase & {
      readonly kind: "delete";
      readonly cardId: string;
    })
  | (CardLifecycleIntentBase & {
      readonly kind: "restore";
      readonly cardId: string;
      readonly beforeBlockId?: string;
      readonly beforeViewCardId?: string;
    })
  | (CardLifecycleIntentBase & {
      readonly kind: "move_in_space";
      readonly cardId: string;
      readonly beforeBlockId?: string;
    });

export type CardLifecycleRuntimeErrorCode =
  | "preflight_unavailable"
  | "preflight_mismatch"
  | "card_identity_collision"
  | "card_not_found"
  | "card_lifecycle_conflict"
  | "card_location_invalid"
  | "restore_evidence_missing"
  | "mutation_rejected"
  | "canonical_read_stale";

export class CardLifecycleRuntimeError extends Error {
  constructor(
    readonly code: CardLifecycleRuntimeErrorCode,
    message: string,
    readonly commandError?: CardLifecycleMutationCommandError,
  ) {
    super(message);
    this.name = "CardLifecycleRuntimeError";
  }
}

export interface CardLifecycleRuntimeDependencies {
  readonly readPreflight: (
    projectId: string,
    cardId: string,
  ) => Promise<CardLifecyclePreflightResult>;
  readonly mutate: (
    projectId: string,
    request: CardLifecycleMutationRequest,
  ) => Promise<CardLifecycleMutationCommandResult>;
  readonly readCard: (
    projectId: string,
    cardId: string,
  ) => Promise<Card | null>;
  readonly waitBeforeCanonicalReadRetry?: () => Promise<void>;
}

export interface CardLifecycleExecutionResult {
  readonly receipt: CardLifecycleMutationReceipt;
  readonly card: Card | null;
}

const fail = (
  code: CardLifecycleRuntimeErrorCode,
  message: string,
): never => {
  throw new CardLifecycleRuntimeError(code, message);
};

const canonicalDate = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

const canonicalDateTime = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const primaryView = (
  preflight: CardLifecyclePreflightSnapshot,
) => {
  const value = preflight.value;
  if (!value || value.version !== CARD_LIFECYCLE_PREFLIGHT_VERSION) {
    return fail("preflight_mismatch", "Card lifecycle preflight is missing");
  }
  const descriptor = value.primaryDatabase.descriptor;
  const query = value.primaryDatabase.query;
  const view = descriptor.views.find(
    (candidate) =>
      candidate.lifecycle === "active" &&
      candidate.isPrimary &&
      candidate.kind === "kanban",
  );
  if (
    !descriptor.database.isPrimary ||
    !view ||
    query.database.blockId !== descriptor.database.blockId ||
    query.view.id !== view.id ||
    query.view.revision !== view.revision
  ) {
    return fail(
      "preflight_mismatch",
      "Primary Database descriptor and View query do not share one authority",
    );
  }
  return { descriptor, query, view };
};

const requireCard = (
  preflight: CardLifecyclePreflightSnapshot,
  cardId: string,
): CardLifecycleOwnedBlockAuthority => {
  const card = preflight.value?.card;
  if (!card || card.cardId !== cardId) {
    return fail("card_not_found", `Card does not exist: ${cardId}`);
  }
  return card;
};

const requireTopLevelCard = (
  preflight: CardLifecyclePreflightSnapshot,
  cardId: string,
): CardLifecycleOwnedBlockAuthority => {
  const card = requireCard(preflight, cardId);
  if (card.location.kind !== "space" || card.location.rankKey === null) {
    return fail(
      "card_location_invalid",
      `Card ${cardId} is not a top-level Space Block`,
    );
  }
  return card;
};

const requireLifecycleCard = (
  preflight: CardLifecyclePreflightSnapshot,
  cardId: string,
): CardLifecycleOwnedBlockAuthority => {
  const card = requireCard(preflight, cardId);
  if (card.location.kind === "document") {
    return fail(
      "card_location_invalid",
      `Nested Card ${cardId} requires a Block transfer`,
    );
  }
  if (card.location.kind === "space" && card.location.rankKey === null) {
    return fail(
      "card_location_invalid",
      `Space Card ${cardId} has no top-level placement`,
    );
  }
  if (
    card.location.kind === "database" &&
    card.membership?.databaseBlockId !== card.location.databaseBlockId
  ) {
    return fail(
      "preflight_mismatch",
      `Database Card ${cardId} has no matching active membership`,
    );
  }
  return card;
};

const createOperation = (
  intent: Extract<CardLifecycleIntent, { readonly kind: "create" }>,
  preflight: CardLifecyclePreflightSnapshot,
) => {
  if (preflight.value?.card || preflight.value?.reservedBlockType) {
    return fail(
      "card_identity_collision",
      `Card identity is already reserved: ${intent.cardId}`,
    );
  }
  const { query } = primaryView(preflight);
  const beforeViewCardId =
    intent.placement === "top"
      ? query.rows.find((row) => row.effectiveGroupKey === intent.status)?.card
          .blockId
      : typeof intent.placement === "object"
        ? intent.placement.beforeCardId
        : undefined;
  const input = intent.input;
  return {
    kind: "create_card" as const,
    cardId: intent.cardId,
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
    ...(beforeViewCardId ? { beforeViewCardId } : {}),
  };
};

export const compileCardLifecycleRequest = (input: {
  readonly intent: CardLifecycleIntent;
  readonly preflight: CardLifecyclePreflightSnapshot;
}): CardLifecycleMutationRequest => {
  const { intent, preflight } = input;
  if (
    preflight.projectId !== intent.projectId ||
    !preflight.storeEpoch ||
    preflight.value?.version !== CARD_LIFECYCLE_PREFLIGHT_VERSION
  ) {
    return fail(
      "preflight_mismatch",
      "Card lifecycle preflight does not match the requested Project",
    );
  }
  primaryView(preflight);

  let operation;
  if (intent.kind === "create") {
    operation = createOperation(intent, preflight);
  } else if (intent.kind === "archive") {
    const card = requireLifecycleCard(preflight, intent.cardId);
    if (card.lifecycle !== "active") {
      return fail(
        "card_lifecycle_conflict",
        `Card ${intent.cardId} is not active`,
      );
    }
    operation = {
      kind: "archive_card" as const,
      cardId: intent.cardId,
      expectedMetadataRevision: card.metadataRevision,
    };
  } else if (intent.kind === "unarchive") {
    const card = requireLifecycleCard(preflight, intent.cardId);
    if (card.lifecycle !== "archived") {
      return fail(
        "card_lifecycle_conflict",
        `Card ${intent.cardId} is not archived`,
      );
    }
    operation = {
      kind: "unarchive_card" as const,
      cardId: intent.cardId,
      expectedMetadataRevision: card.metadataRevision,
    };
  } else if (intent.kind === "delete") {
    const card = requireLifecycleCard(preflight, intent.cardId);
    if (card.lifecycle === "deleted") {
      return fail(
        "card_lifecycle_conflict",
        `Card ${intent.cardId} is already deleted`,
      );
    }
    operation = {
      kind: "delete_card" as const,
      cardId: intent.cardId,
      expectedMetadataRevision: card.metadataRevision,
      expectedLocationRevision: card.locationRevision,
    };
  } else if (intent.kind === "restore") {
    const card = requireCard(preflight, intent.cardId);
    if (card.lifecycle !== "deleted") {
      return fail(
        "card_lifecycle_conflict",
        `Card ${intent.cardId} is not deleted`,
      );
    }
    const evidence = card.restoreEvidence;
    if (!evidence) {
      return fail(
        "restore_evidence_missing",
        `Card ${intent.cardId} has no valid delete receipt`,
      );
    }
    operation = {
      kind: "restore_card" as const,
      cardId: intent.cardId,
      deleteOperationId: evidence.deleteOperationId,
      expectedMetadataRevision: card.metadataRevision,
      expectedLocationRevision: card.locationRevision,
      membership: evidence.membership,
      ...(intent.beforeBlockId ? { beforeBlockId: intent.beforeBlockId } : {}),
      ...(intent.beforeViewCardId && evidence.membership?.position
        ? {
            membership: {
              ...evidence.membership,
              position: {
                ...evidence.membership.position,
                beforeViewCardId: intent.beforeViewCardId,
              },
            },
          }
        : {}),
    };
  } else {
    const card = requireTopLevelCard(preflight, intent.cardId);
    if (card.lifecycle === "deleted") {
      return fail(
        "card_lifecycle_conflict",
        `Card ${intent.cardId} is deleted`,
      );
    }
    operation = {
      kind: "move_card_in_space" as const,
      cardId: intent.cardId,
      expectedLocationRevision: card.locationRevision,
      ...(intent.beforeBlockId ? { beforeBlockId: intent.beforeBlockId } : {}),
    };
  }

  const actor = {
    kind: "card_lifecycle_runtime",
  } satisfies Readonly<Record<string, BlockPropertyJsonValue>>;
  return parseCardLifecycleMutationRequest({
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

const readCanonicalCard = async (
  intent: CardLifecycleIntent,
  receipt: CardLifecycleMutationReceipt,
  dependencies: CardLifecycleRuntimeDependencies,
): Promise<Card | null> => {
  const expectsDeleted = receipt.lifecycle === "deleted";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const card = await dependencies.readCard(intent.projectId, receipt.cardId);
    const matches = expectsDeleted
      ? card === null
      : card?.id === receipt.cardId &&
        card.archived === (receipt.lifecycle === "archived");
    if (matches) return card;
    if (attempt < 2) {
      await (dependencies.waitBeforeCanonicalReadRetry?.() ??
        Promise.resolve());
    }
  }
  return fail(
    "canonical_read_stale",
    `Canonical Card read did not reach lifecycle ${receipt.lifecycle}`,
  );
};

/**
 * Execute one user lifecycle intent. A transport failure retries the exact
 * same request object, preserving operationId, epoch, revisions, and intent.
 */
export const executeCardLifecycleIntent = async (
  intent: CardLifecycleIntent,
  dependencies: CardLifecycleRuntimeDependencies,
): Promise<CardLifecycleExecutionResult> => {
  const preflight = await dependencies.readPreflight(
    intent.projectId,
    intent.cardId,
  );
  if (!preflight.ok) {
    throw new CardLifecycleRuntimeError(
      "preflight_unavailable",
      preflight.error.message,
    );
  }
  if (!preflight.value.value) {
    return fail("preflight_unavailable", "Card lifecycle preflight is empty");
  }
  const request = compileCardLifecycleRequest({
    intent,
    preflight: preflight.value,
  });
  let result: CardLifecycleMutationCommandResult;
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
    throw new CardLifecycleRuntimeError(
      "mutation_rejected",
      result.error.message,
      result.error,
    );
  }
  return {
    receipt: result.value,
    card: await readCanonicalCard(intent, result.value, dependencies),
  };
};
