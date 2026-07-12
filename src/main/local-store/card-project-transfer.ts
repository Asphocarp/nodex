import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
  cardProjectTransferIntentFromRequest,
  cardProjectTransferIntentsEqual,
  CardProjectTransferContractError,
  parseCardProjectTransferIntent,
  parseCardProjectTransferCommandResult,
  parseCardProjectTransferReceipt,
  parseCardProjectTransferRequest,
  type CardProjectTransferBlockCoordinate,
  type CardProjectTransferCommandError,
  type CardProjectTransferCommandResult,
  type CardProjectTransferDocumentCoordinate,
  type CardProjectTransferErrorCode,
  type CardProjectTransferIntent,
  type CardProjectTransferMembershipCoordinate,
  type CardProjectTransferReceipt,
  type CardProjectTransferRequest,
} from "../../shared/card-project-transfer";
import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "../../shared/block-property-mutations";
import type { CardStatus } from "../../shared/card-status";
import { getOwnedDocumentSchemaRegistration } from "../../shared/block-documents/document-schema-adapters";
import {
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import { rebuildCardReadModelProjection } from "./card-read-store";
import { replaceDocumentSecondaryProjections } from "./block-document-projections";
import {
  planDatabaseFractionalRank,
  type DatabaseRankedItem,
} from "./database-fractional-rank";
import { refreshScheduledCardIndexProjection } from "./scheduled-card-store";

const MUTATION_KIND = "card_project_transfer";
const CHANGE_KIND = "card_project_transfer";

export type CardProjectTransferFaultPoint =
  | "after_source_memberships"
  | "after_project_coordinates"
  | "after_target_memberships"
  | "after_projections"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface CompileCardProjectTransferInput {
  readonly operationId: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly cardId: string;
  readonly targetDatabaseBlockId: string;
  readonly targetViewId: string;
  readonly targetStatus: CardStatus;
  readonly beforeBlockId?: string;
  readonly beforeViewCardId?: string;
  readonly clientSessionId?: string;
  readonly actor?: Readonly<Record<string, BlockPropertyJsonValue>>;
}

export interface ApplyCardProjectTransferOptions {
  readonly now?: () => string;
  readonly faultInjector?: (point: CardProjectTransferFaultPoint) => void;
}

interface BlockRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly location_revision: number;
  readonly metadata_revision: number;
  readonly top_level_rank_key: string | null;
}

interface DocumentRow {
  readonly owner_block_id: string;
  readonly document_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
  readonly sync_engine: "yjs" | "canvas_scene";
}

interface MembershipRow {
  readonly card_block_id: string;
  readonly membership_id: string;
  readonly database_block_id: string;
  readonly database_schema_revision: number;
  readonly membership_revision: number;
  readonly status_property_id: string;
  readonly status_value_revision: number;
  readonly status_value_json: string;
}

interface AuthorityClosure {
  readonly blocks: readonly BlockRow[];
  readonly documents: readonly DocumentRow[];
  readonly memberships: readonly MembershipRow[];
}

interface TargetDatabaseRow {
  readonly database_block_id: string;
  readonly project_id: string;
  readonly schema_revision: number;
}

interface TargetViewRow {
  readonly view_id: string;
  readonly database_block_id: string;
  readonly project_id: string;
  readonly kind: string;
  readonly config_json: string;
  readonly revision: number;
  readonly lifecycle: "active" | "deleted";
}

interface PropertyRow {
  readonly property_id: string;
  readonly property_key: string;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
}

interface SourceValueRow extends PropertyRow {
  readonly card_block_id: string;
  readonly membership_id: string;
  readonly value_json: string;
}

interface PreparedTargetValue {
  readonly propertyId: string;
  readonly valueType: DatabasePropertyValueType;
  readonly valueJson: string;
}

interface PreparedTargetMembership {
  readonly cardBlockId: string;
  readonly sourceMembershipId: string;
  readonly targetMembershipId: string;
  readonly status: CardStatus;
  readonly values: readonly PreparedTargetValue[];
}

interface StoredMutationRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly outcome: "committed" | "rejected";
  readonly result_json: string;
  readonly change_log_seq: number | null;
}

interface TransferEvidence {
  readonly requestHash: string;
  readonly requestJson: string;
  readonly actorJson: string;
  readonly expectedRevisionsJson: string;
}

interface RankPlan {
  readonly finalRanks: ReadonlyMap<string, string>;
  readonly insertedIds: ReadonlySet<string>;
}

interface PreparedTransfer {
  readonly closure: AuthorityClosure;
  readonly targetDatabase: TargetDatabaseRow;
  readonly targetView: TargetViewRow;
  readonly targetMemberships: readonly PreparedTargetMembership[];
  readonly viewRanksByStatus: ReadonlyMap<CardStatus, RankPlan>;
}

export class CardProjectTransferCompilationError extends Error {
  constructor(
    readonly code: CardProjectTransferErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CardProjectTransferCompilationError";
  }
}

class TransferRejection extends Error {
  constructor(readonly error: CardProjectTransferCommandError) {
    super(error.message);
    this.name = "TransferRejection";
  }
}

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const requireIdentity = (value: string, label: string): string => {
  if (value && value === value.trim() && value.length <= 512) return value;
  throw new CardProjectTransferCompilationError(
    "invalid_card_project_transfer_request",
    `${label} must be a canonical bounded identity`,
  );
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new CardProjectTransferCompilationError(
    "store_epoch_mismatch",
    "Block store epoch is missing",
  );
};

const closureBlockSql = `
  WITH RECURSIVE closure(block_id) AS (
    VALUES (?)
    UNION
    SELECT child.id
    FROM closure current
    INNER JOIN block_documents ownership
      ON ownership.block_id = current.block_id
    INNER JOIN blocks child
      ON child.containing_document_id = ownership.document_id
  )
`;

const readAuthorityClosure = (
  database: Database.Database,
  sourceProjectId: string,
  cardId: string,
): AuthorityClosure => {
  const blocks = database
    .prepare(
      `${closureBlockSql}
       SELECT
         block.id, block.project_id, block.type, block.lifecycle,
         block.location_kind, block.containing_document_id,
         block.containing_database_id,
         block.location_revision, block.metadata_revision,
         placement.rank_key AS top_level_rank_key
       FROM closure
       INNER JOIN blocks block ON block.id = closure.block_id
       LEFT JOIN top_level_block_placements placement
         ON placement.block_id = block.id
       ORDER BY block.id`,
    )
    .all(cardId) as readonly BlockRow[];
  const root = blocks.find((block) => block.id === cardId);
  if (!root) {
    throw new CardProjectTransferCompilationError(
      "card_not_found",
      `Card does not exist: ${cardId}`,
    );
  }
  if (root.project_id !== sourceProjectId) {
    throw new CardProjectTransferCompilationError(
      "card_not_found",
      `Card ${cardId} does not belong to Project ${sourceProjectId}`,
    );
  }
  if (root.type !== "card") {
    throw new CardProjectTransferCompilationError(
      "card_type_mismatch",
      `Block ${cardId} is not a Card`,
    );
  }
  if (root.lifecycle !== "active") {
    throw new CardProjectTransferCompilationError(
      "card_lifecycle_conflict",
      `Card ${cardId} must be active before Project transfer`,
    );
  }
  if (
    root.location_kind !== "database" ||
    root.containing_document_id !== null ||
    root.containing_database_id === null ||
    root.top_level_rank_key !== null
  ) {
    throw new CardProjectTransferCompilationError(
      "card_location_invalid",
      `Card ${cardId} must be parented by one Database`,
    );
  }
  for (const block of blocks) {
    if (block.project_id !== sourceProjectId) {
      throw new CardProjectTransferCompilationError(
        "block_authority_conflict",
        `Closure Block ${block.id} escaped source Project ${sourceProjectId}`,
      );
    }
    if (block.id === cardId || block.location_kind === "document") continue;
    throw new CardProjectTransferCompilationError(
      "card_location_invalid",
      `Closure Block ${block.id} is unexpectedly top-level`,
    );
  }

  const documents = database
    .prepare(
      `${closureBlockSql}
       SELECT
         ownership.block_id AS owner_block_id,
         document.id AS document_id,
         document.project_id,
         document.generation,
         document.head_seq,
         document.schema_key,
         document.schema_version,
         document.sync_engine,
         document.readiness,
         document.authority
       FROM closure
       INNER JOIN block_documents ownership
         ON ownership.block_id = closure.block_id
       INNER JOIN documents document
         ON document.id = ownership.document_id
       ORDER BY document.id`,
    )
    .all(cardId) as readonly DocumentRow[];
  if (documents.length === 0) {
    throw new CardProjectTransferCompilationError(
      "document_authority_conflict",
      `Card ${cardId} has no owned Document`,
    );
  }
  const documentIds = new Set(documents.map((document) => document.document_id));
  for (const document of documents) {
    if (
      document.project_id !== sourceProjectId ||
      document.readiness !== "ready" ||
      document.authority !== "ydoc_primary" ||
      document.head_seq < 0
    ) {
      throw new CardProjectTransferCompilationError(
        "document_authority_conflict",
        `Owned Document ${document.document_id} is not a ready primary authority`,
      );
    }
    let adapter;
    try {
      adapter = getOwnedDocumentSchemaRegistration({
        ownerType: blocks.find((block) => block.id === document.owner_block_id)?.type ?? "",
        schemaKey: document.schema_key,
        schemaVersion: document.schema_version,
      });
    } catch {
      throw new CardProjectTransferCompilationError(
        "document_authority_conflict",
        `Owned Document ${document.document_id} uses an unregistered schema`,
      );
    }
    if (adapter.syncEngine !== document.sync_engine) {
      throw new CardProjectTransferCompilationError(
        "document_authority_conflict",
        `Owned Document ${document.document_id} sync engine does not match its schema`,
      );
    }
  }
  for (const block of blocks) {
    if (block.location_kind !== "document") continue;
    if (
      block.containing_document_id &&
      documentIds.has(block.containing_document_id)
    ) {
      continue;
    }
    throw new CardProjectTransferCompilationError(
      "block_authority_conflict",
      `Closure Block ${block.id} points outside the owned Document closure`,
    );
  }

  const memberships: MembershipRow[] = [];
  for (const block of blocks) {
    if (block.type !== "card" || block.lifecycle === "deleted") continue;
    const activeMemberships = database
      .prepare(
        `SELECT id
         FROM database_memberships
         WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL`,
      )
      .all(block.id, sourceProjectId) as readonly { readonly id: string }[];
    if (activeMemberships.length > 1) {
      throw new CardProjectTransferCompilationError(
        "membership_authority_conflict",
        `Card ${block.id} has more than one active Database membership`,
      );
    }
    if (activeMemberships.length === 0) {
      if (block.id !== cardId) continue;
      throw new CardProjectTransferCompilationError(
        "membership_authority_conflict",
        `Root Card ${cardId} requires one active Database membership`,
      );
    }
    const rows = database
      .prepare(
        `SELECT
           membership.card_block_id,
           membership.id AS membership_id,
           membership.database_block_id,
           capability.schema_revision AS database_schema_revision,
           membership.revision AS membership_revision,
           property.id AS status_property_id,
           value.revision AS status_value_revision,
           value.value_json AS status_value_json
         FROM database_memberships membership
         INNER JOIN database_capabilities capability
           ON capability.block_id = membership.database_block_id
          AND capability.project_id = membership.project_id
         INNER JOIN database_properties property
           ON property.database_block_id = membership.database_block_id
          AND property.project_id = membership.project_id
          AND property.key = 'status'
          AND property.value_type = 'select'
          AND property.lifecycle = 'active'
         INNER JOIN database_property_values value
           ON value.membership_id = membership.id
          AND value.database_block_id = membership.database_block_id
          AND value.project_id = membership.project_id
          AND value.property_id = property.id
          AND value.value_type = 'select'
         WHERE membership.card_block_id = ?
           AND membership.project_id = ?
           AND membership.removed_at IS NULL`,
      )
      .all(block.id, sourceProjectId) as readonly MembershipRow[];
    if (rows.length !== 1) {
      throw new CardProjectTransferCompilationError(
        "membership_authority_conflict",
        `Card ${block.id} membership has no valid active status value`,
      );
    }
    const membership = rows[0];
    if (!membership) throw new Error("Membership cardinality check diverged");
    if (
      block.location_kind !== "database" ||
      block.containing_database_id !== membership.database_block_id
    ) {
      throw new CardProjectTransferCompilationError(
        "membership_authority_conflict",
        `Card ${block.id} membership does not match its Database parent`,
      );
    }
    let status: unknown;
    try {
      status = JSON.parse(membership.status_value_json) as unknown;
    } catch {
      status = null;
    }
    if (
      status !== "draft" &&
      status !== "backlog" &&
      status !== "in_progress" &&
      status !== "in_review" &&
      status !== "done"
    ) {
      throw new CardProjectTransferCompilationError(
        "membership_authority_conflict",
        `Card ${block.id} has an invalid status value`,
      );
    }
    memberships.push(membership);
  }
  memberships.sort((left, right) =>
    left.card_block_id.localeCompare(right.card_block_id),
  );
  return { blocks, documents, memberships };
};

const toBlockCoordinates = (
  closure: AuthorityClosure,
): readonly CardProjectTransferBlockCoordinate[] =>
  closure.blocks.map((block) => ({
    blockId: block.id,
    type: block.type,
    lifecycle: block.lifecycle,
    location:
      block.location_kind === "space"
        ? { kind: "space" as const }
        : block.location_kind === "document"
          ? {
            kind: "document" as const,
            documentId: block.containing_document_id ?? "",
            }
          : {
              kind: "database" as const,
              databaseBlockId: block.containing_database_id ?? "",
            },
    locationRevision: block.location_revision,
    metadataRevision: block.metadata_revision,
  }));

const toDocumentCoordinates = (
  closure: AuthorityClosure,
): readonly CardProjectTransferDocumentCoordinate[] =>
  closure.documents.map((document) => ({
    ownerBlockId: document.owner_block_id,
    documentId: document.document_id,
    generation: document.generation,
    headSeq: document.head_seq,
    schemaKey: document.schema_key,
    schemaVersion: document.schema_version,
  }));

const toMembershipCoordinates = (
  closure: AuthorityClosure,
): readonly CardProjectTransferMembershipCoordinate[] =>
  closure.memberships.map((membership) => ({
    cardBlockId: membership.card_block_id,
    membershipId: membership.membership_id,
    databaseBlockId: membership.database_block_id,
    databaseSchemaRevision: membership.database_schema_revision,
    membershipRevision: membership.membership_revision,
    statusPropertyId: membership.status_property_id,
    statusValueRevision: membership.status_value_revision,
    status: JSON.parse(membership.status_value_json) as CardStatus,
  }));

const readTargetDatabase = (
  database: Database.Database,
  targetProjectId: string,
  targetDatabaseBlockId: string,
): TargetDatabaseRow => {
  const row = database
    .prepare(
      `SELECT
         capability.block_id AS database_block_id,
         capability.project_id,
         capability.schema_revision
       FROM database_capabilities capability
       INNER JOIN blocks block
         ON block.id = capability.block_id
        AND block.project_id = capability.project_id
       WHERE capability.block_id = ?
         AND capability.project_id = ?
         AND block.type = 'database'
         AND block.lifecycle = 'active'`,
    )
    .get(targetDatabaseBlockId, targetProjectId) as
    | TargetDatabaseRow
    | undefined;
  if (row) return row;
  throw new CardProjectTransferCompilationError(
    "target_database_conflict",
    `Target Database is not active: ${targetDatabaseBlockId}`,
  );
};

const readTargetView = (
  database: Database.Database,
  targetProjectId: string,
  targetDatabaseBlockId: string,
  targetViewId: string,
): TargetViewRow => {
  const row = database
    .prepare(
      `SELECT
         id AS view_id, database_block_id, project_id, kind,
         config_json, revision, lifecycle
       FROM database_views
       WHERE id = ? AND project_id = ? AND database_block_id = ?`,
    )
    .get(targetViewId, targetProjectId, targetDatabaseBlockId) as
    | TargetViewRow
    | undefined;
  if (row?.lifecycle === "active") return row;
  throw new CardProjectTransferCompilationError(
    "target_view_conflict",
    `Target Database View is not active: ${targetViewId}`,
  );
};

export const compileCardProjectTransferRequest = (
  database: Database.Database,
  input: CompileCardProjectTransferInput,
): CardProjectTransferRequest =>
  database.transaction(() => {
    const operationId = requireIdentity(input.operationId, "operationId");
    const sourceProjectId = requireIdentity(
      input.sourceProjectId,
      "sourceProjectId",
    );
    const targetProjectId = requireIdentity(
      input.targetProjectId,
      "targetProjectId",
    );
    const cardId = requireIdentity(input.cardId, "cardId");
    if (sourceProjectId === targetProjectId) {
      throw new CardProjectTransferCompilationError(
        "same_project",
        "A Card Project transfer requires two different Projects",
      );
    }
    const targetDatabase = readTargetDatabase(
      database,
      targetProjectId,
      input.targetDatabaseBlockId,
    );
    const targetView = readTargetView(
      database,
      targetProjectId,
      targetDatabase.database_block_id,
      input.targetViewId,
    );
    const closure = readAuthorityClosure(database, sourceProjectId, cardId);
    const request = parseCardProjectTransferRequest({
      version: CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
      operationId,
      storeEpoch: readStoreEpoch(database),
      sourceProjectId,
      targetProjectId,
      cardId,
      expectedBlocks: toBlockCoordinates(closure),
      expectedDocuments: toDocumentCoordinates(closure),
      expectedMemberships: toMembershipCoordinates(closure),
      target: {
        databaseBlockId: targetDatabase.database_block_id,
        databaseSchemaRevision: targetDatabase.schema_revision,
        viewId: targetView.view_id,
        viewRevision: targetView.revision,
        status: input.targetStatus,
        ...(input.beforeBlockId === undefined
          ? {}
          : { beforeBlockId: input.beforeBlockId }),
        ...(input.beforeViewCardId === undefined
          ? {}
          : { beforeViewCardId: input.beforeViewCardId }),
      },
      ...(input.clientSessionId === undefined
        ? {}
        : { clientSessionId: input.clientSessionId }),
      actor: input.actor ?? {},
    });
    try {
      validateTarget(database, request, closure);
    } catch (error) {
      if (error instanceof TransferRejection) {
        throw new CardProjectTransferCompilationError(
          error.error.code,
          error.error.message,
        );
      }
      throw error;
    }
    return request;
  })();

export const compileCardProjectTransferIntent = (
  database: Database.Database,
  rawIntent: CardProjectTransferIntent,
): CardProjectTransferRequest => {
  const intent = parseCardProjectTransferIntent(rawIntent);
  return compileCardProjectTransferRequest(database, {
    operationId: intent.operationId,
    sourceProjectId: intent.sourceProjectId,
    targetProjectId: intent.targetProjectId,
    cardId: intent.cardId,
    targetDatabaseBlockId: intent.target.databaseBlockId,
    targetViewId: intent.target.viewId,
    targetStatus: intent.target.status,
    ...(intent.target.beforeBlockId === undefined
      ? {}
      : { beforeBlockId: intent.target.beforeBlockId }),
    ...(intent.target.beforeViewCardId === undefined
      ? {}
      : { beforeViewCardId: intent.target.beforeViewCardId }),
    clientSessionId: intent.clientSessionId,
    actor: intent.actor,
  });
};

const canonicalLogicalRequest = (
  request: CardProjectTransferRequest,
): Readonly<Record<string, BlockPropertyJsonValue>> => ({
  version: request.version,
  operationId: request.operationId,
  storeEpoch: request.storeEpoch,
  sourceProjectId: request.sourceProjectId,
  targetProjectId: request.targetProjectId,
  cardId: request.cardId,
  expectedBlocks: request.expectedBlocks as unknown as BlockPropertyJsonValue,
  expectedDocuments:
    request.expectedDocuments as unknown as BlockPropertyJsonValue,
  expectedMemberships:
    request.expectedMemberships as unknown as BlockPropertyJsonValue,
  target: request.target as unknown as BlockPropertyJsonValue,
});

const makeEvidence = (request: CardProjectTransferRequest): TransferEvidence => {
  const requestJson = stableStringifyBlockPropertyJson(
    canonicalLogicalRequest(request),
  );
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  return {
    requestHash,
    requestJson,
    actorJson: stableStringifyBlockPropertyJson(request.actor),
    expectedRevisionsJson: stableStringifyBlockPropertyJson({
      blocks: Object.fromEntries(
        request.expectedBlocks.map((block) => [
          block.blockId,
          {
            locationRevision: block.locationRevision,
            metadataRevision: block.metadataRevision,
          },
        ]),
      ),
      documents: Object.fromEntries(
        request.expectedDocuments.map((document) => [
          document.documentId,
          {
            generation: document.generation,
            headSeq: document.headSeq,
          },
        ]),
      ),
      memberships: Object.fromEntries(
        request.expectedMemberships.map((membership) => [
          membership.membershipId,
          {
            membershipRevision: membership.membershipRevision,
            statusValueRevision: membership.statusValueRevision,
          },
        ]),
      ),
      targetDatabaseSchema: request.target.databaseSchemaRevision,
      targetView: request.target.viewRevision,
    }),
  };
};

const makeError = (
  code: CardProjectTransferErrorCode,
  message: string,
  request?: Pick<CardProjectTransferRequest, "operationId" | "cardId">,
  retryable = false,
): CardProjectTransferCommandError => ({
  code,
  message,
  retryable,
  ...(request ? { operationId: request.operationId, cardId: request.cardId } : {}),
});

const reject = (
  code: CardProjectTransferErrorCode,
  message: string,
  request: CardProjectTransferRequest,
): never => {
  throw new TransferRejection(makeError(code, message, request));
};

const stableCoordinates = (value: unknown): string =>
  stableStringifyBlockPropertyJson(value as BlockPropertyJsonValue);

const validateAuthorityClosure = (
  database: Database.Database,
  request: CardProjectTransferRequest,
): AuthorityClosure => {
  let closure: AuthorityClosure;
  try {
    closure = readAuthorityClosure(
      database,
      request.sourceProjectId,
      request.cardId,
    );
  } catch (error) {
    if (error instanceof CardProjectTransferCompilationError) {
      return reject(error.code, error.message, request);
    }
    throw error;
  }
  if (
    stableCoordinates(toBlockCoordinates(closure)) !==
    stableCoordinates(request.expectedBlocks)
  ) {
    reject(
      "block_authority_conflict",
      "Card transfer Block closure or revisions changed after compilation",
      request,
    );
  }
  if (
    stableCoordinates(toDocumentCoordinates(closure)) !==
    stableCoordinates(request.expectedDocuments)
  ) {
    reject(
      "document_authority_conflict",
      "Card transfer Document closure or heads changed after compilation",
      request,
    );
  }
  if (
    stableCoordinates(toMembershipCoordinates(closure)) !==
    stableCoordinates(request.expectedMemberships)
  ) {
    reject(
      "membership_authority_conflict",
      "Card transfer Database memberships changed after compilation",
      request,
    );
  }
  return closure;
};

const readPropertyRows = (
  database: Database.Database,
  targetProjectId: string,
  targetDatabaseBlockId: string,
): readonly PropertyRow[] =>
  database
    .prepare(
      `SELECT
         id AS property_id, key AS property_key, value_type, config_json
       FROM database_properties
       WHERE project_id = ?
         AND database_block_id = ?
         AND lifecycle = 'active'
       ORDER BY key, id`,
    )
    .all(targetProjectId, targetDatabaseBlockId) as readonly PropertyRow[];

const readSourceValuesForMembership = (
  database: Database.Database,
  sourceProjectId: string,
  membership: MembershipRow,
): readonly SourceValueRow[] =>
  database
    .prepare(
      `SELECT
         membership.card_block_id,
         value.membership_id,
         property.id AS property_id,
         property.key AS property_key,
         property.value_type,
         property.config_json,
         value.value_json
       FROM database_property_values value
       INNER JOIN database_memberships membership
         ON membership.id = value.membership_id
        AND membership.database_block_id = value.database_block_id
        AND membership.project_id = value.project_id
       INNER JOIN database_properties property
         ON property.id = value.property_id
        AND property.database_block_id = value.database_block_id
        AND property.project_id = value.project_id
        AND property.lifecycle = 'active'
       WHERE value.membership_id = ?
         AND value.database_block_id = ?
         AND value.project_id = ?
       ORDER BY property.key, property.id`,
    )
    .all(
      membership.membership_id,
      membership.database_block_id,
      sourceProjectId,
    ) as readonly SourceValueRow[];

const prepareTargetMemberships = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  closure: AuthorityClosure,
  targetProperties: readonly PropertyRow[],
): readonly PreparedTargetMembership[] => {
  const targetByKey = new Map(
    targetProperties.map((property) => [property.property_key, property] as const),
  );
  const targetStatus = targetByKey.get("status");
  if (!targetStatus || targetStatus.value_type !== "select") {
    return reject(
      "target_property_schema_invalid",
      `Target Database ${request.target.databaseBlockId} requires an active select status property`,
      request,
    );
  }
  const sourceByCard = new Map(
    closure.memberships.map((membership) => [
      membership.card_block_id,
      membership,
    ] as const),
  );
  const cardIds = closure.blocks
    .filter(
      (block) =>
        block.type === "card" &&
        block.lifecycle !== "deleted" &&
        (block.id === request.cardId || sourceByCard.has(block.id)),
    )
    .map((block) => block.id)
    .sort((left, right) => {
      if (left === request.cardId) return -1;
      if (right === request.cardId) return 1;
      return left.localeCompare(right);
    });
  return cardIds.map((cardBlockId) => {
    const source = sourceByCard.get(cardBlockId);
    if (!source) {
      return reject(
        "membership_authority_conflict",
        `Card ${cardBlockId} has no source membership to transfer`,
        request,
      );
    }
    const status =
      cardBlockId === request.cardId
        ? request.target.status
        : (JSON.parse(source.status_value_json) as CardStatus);
    const values = readSourceValuesForMembership(
      database,
      request.sourceProjectId,
      source,
    ).map((sourceValue): PreparedTargetValue => {
      const target = targetByKey.get(sourceValue.property_key);
      if (!target || target.value_type !== sourceValue.value_type) {
        return reject(
          "target_property_schema_invalid",
          `Target Database property ${sourceValue.property_key} is missing or has an incompatible type`,
          request,
        );
      }
      let rawValue: unknown;
      try {
        rawValue =
          sourceValue.property_key === "status"
            ? status
            : (JSON.parse(sourceValue.value_json) as unknown);
        const normalized = normalizeDatabasePropertyValue(
          {
            valueType: target.value_type,
            config: parseDatabasePropertyConfig(
              target.value_type,
              JSON.parse(target.config_json) as unknown,
            ),
          },
          rawValue,
        );
        return {
          propertyId: target.property_id,
          valueType: target.value_type,
          valueJson: stableStringifyBlockPropertyJson(normalized),
        };
      } catch (error) {
        return reject(
          "target_property_value_invalid",
          `Target Database rejects ${sourceValue.property_key} for Card ${cardBlockId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          request,
        );
      }
    });
    if (!values.some((value) => value.propertyId === targetStatus.property_id)) {
      reject(
        "target_property_value_invalid",
        `Card ${cardBlockId} has no transferable status value`,
        request,
      );
    }
    const targetMembershipId = randomUUID();
    const collision = database
      .prepare("SELECT 1 FROM database_memberships WHERE id = ?")
      .get(targetMembershipId);
    if (collision) {
      reject(
        "membership_authority_conflict",
        `Target membership identity is already reserved: ${targetMembershipId}`,
        request,
      );
    }
    return {
      cardBlockId,
      sourceMembershipId: source.membership_id,
      targetMembershipId,
      status,
      values,
    };
  });
};

const planRanks = (
  initialItems: readonly DatabaseRankedItem[],
  inserts: readonly Readonly<{
    id: string;
    beforeId?: string;
  }>[],
): RankPlan => {
  let items = initialItems.map((item) => ({ ...item }));
  const insertedIds = new Set(inserts.map((insert) => insert.id));
  for (const insert of inserts) {
    const plan = planDatabaseFractionalRank({
      items,
      targetId: insert.id,
      ...(insert.beforeId === undefined ? {} : { beforeId: insert.beforeId }),
    });
    items = items.map((item) => ({
      ...item,
      rankKey: plan.rebalancedRankKeys.get(item.id) ?? item.rankKey,
    }));
    items.push({ id: insert.id, rankKey: plan.rankKey });
    items.sort(
      (left, right) =>
        left.rankKey.localeCompare(right.rankKey) || left.id.localeCompare(right.id),
    );
  }
  return {
    finalRanks: new Map(items.map((item) => [item.id, item.rankKey] as const)),
    insertedIds,
  };
};

const readRankedItems = (
  database: Database.Database,
  sql: string,
  ...bindings: readonly unknown[]
): readonly DatabaseRankedItem[] =>
  database.prepare(sql).all(...bindings) as readonly DatabaseRankedItem[];

const validateTarget = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  closure: AuthorityClosure,
): PreparedTransfer => {
  let targetDatabase: TargetDatabaseRow;
  let targetView: TargetViewRow;
  try {
    targetDatabase = readTargetDatabase(
      database,
      request.targetProjectId,
      request.target.databaseBlockId,
    );
    targetView = readTargetView(
      database,
      request.targetProjectId,
      request.target.databaseBlockId,
      request.target.viewId,
    );
  } catch (error) {
    if (error instanceof CardProjectTransferCompilationError) {
      return reject(error.code, error.message, request);
    }
    throw error;
  }
  if (targetDatabase.schema_revision !== request.target.databaseSchemaRevision) {
    reject(
      "target_database_conflict",
      `Target Database ${targetDatabase.database_block_id} schema changed after compilation`,
      request,
    );
  }
  if (targetView.revision !== request.target.viewRevision) {
    reject(
      "target_view_conflict",
      `Target View ${targetView.view_id} changed after compilation`,
      request,
    );
  }
  if (targetView.kind !== "kanban") {
    reject(
      "target_view_conflict",
      `Target View ${targetView.view_id} must be a Kanban View`,
      request,
    );
  }
  const targetProperties = readPropertyRows(
    database,
    request.targetProjectId,
    request.target.databaseBlockId,
  );
  const statusProperty = targetProperties.find(
    (property) => property.property_key === "status",
  );
  if (!statusProperty || statusProperty.value_type !== "select") {
    return reject(
      "target_property_schema_invalid",
      `Target Database ${request.target.databaseBlockId} has no active select status property`,
      request,
    );
  }
  try {
    const config = parseGeneralDatabaseViewConfig(
      JSON.parse(targetView.config_json) as unknown,
    );
    if (config.group?.propertyId !== statusProperty.property_id) {
      reject(
        "target_view_conflict",
        `Target View ${targetView.view_id} is not grouped by its status property`,
        request,
      );
    }
    normalizeDatabasePropertyValue(
      {
        valueType: statusProperty.value_type,
        config: parseDatabasePropertyConfig(
          statusProperty.value_type,
          JSON.parse(statusProperty.config_json) as unknown,
        ),
      },
      request.target.status,
    );
  } catch (error) {
    if (error instanceof TransferRejection) throw error;
    reject(
      "target_property_value_invalid",
      `Target status ${request.target.status} is incompatible: ${
        error instanceof Error ? error.message : String(error)
      }`,
      request,
    );
  }

  const targetMemberships = prepareTargetMemberships(
    database,
    request,
    closure,
    targetProperties,
  );
  const membershipGroups = new Map<CardStatus, PreparedTargetMembership[]>();
  for (const membership of targetMemberships) {
    const group = membershipGroups.get(membership.status) ?? [];
    group.push(membership);
    membershipGroups.set(membership.status, group);
  }
  const viewRanksByStatus = new Map<CardStatus, RankPlan>();
  for (const [status, memberships] of membershipGroups) {
    const items = readRankedItems(
      database,
      `SELECT block_id AS id, rank_key AS rankKey
       FROM database_view_positions
       WHERE view_id = ? AND group_key IS ?
       ORDER BY rank_key, block_id`,
      request.target.viewId,
      status,
    );
    try {
      viewRanksByStatus.set(
        status,
        planRanks(
          items,
          memberships.map((membership) => ({
            id: membership.cardBlockId,
            ...(membership.cardBlockId === request.cardId &&
            request.target.beforeViewCardId !== undefined
              ? { beforeId: request.target.beforeViewCardId }
              : {}),
          })),
        ),
      );
    } catch (error) {
      const code = request.target.beforeViewCardId
        ? "position_anchor_group_mismatch"
        : "position_anchor_not_found";
      reject(
        code,
        error instanceof Error ? error.message : String(error),
        request,
      );
    }
  }
  if (
    request.target.beforeViewCardId !== undefined &&
    !viewRanksByStatus
      .get(request.target.status)
      ?.finalRanks.has(request.target.beforeViewCardId)
  ) {
    reject(
      "position_anchor_group_mismatch",
      `Target View anchor ${request.target.beforeViewCardId} is not in status group ${request.target.status}`,
      request,
    );
  }
  return {
    closure,
    targetDatabase,
    targetView,
    targetMemberships,
    viewRanksByStatus,
  };
};

const applyExistingRanks = (
  database: Database.Database,
  plan: RankPlan,
  update: (id: string, rankKey: string) => void,
): void => {
  for (const [id, rankKey] of plan.finalRanks) {
    if (plan.insertedIds.has(id)) continue;
    update(id, rankKey);
  }
};

const tombstoneSourceMemberships = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  closure: AuthorityClosure,
  now: string,
): void => {
  const deletePositions = database.prepare(
    `DELETE FROM database_view_positions
     WHERE block_id = ?
       AND project_id = ?
       AND view_id IN (
         SELECT id
         FROM database_views
         WHERE database_block_id = ? AND project_id = ?
       )`,
  );
  const removeMembership = database.prepare(
    `UPDATE database_memberships
     SET removed_at = ?, revision = revision + 1
     WHERE id = ?
       AND project_id = ?
       AND card_block_id = ?
       AND revision = ?
       AND removed_at IS NULL`,
  );
  for (const membership of closure.memberships) {
    deletePositions.run(
      membership.card_block_id,
      request.sourceProjectId,
      membership.database_block_id,
      request.sourceProjectId,
    );
    const removed = removeMembership.run(
      now,
      membership.membership_id,
      request.sourceProjectId,
      membership.card_block_id,
      membership.membership_revision,
    );
    if (removed.changes === 1) continue;
    throw new Error(
      `Source membership changed during Card transfer: ${membership.membership_id}`,
    );
  }
};

const moveProjectCoordinates = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  closure: AuthorityClosure,
  now: string,
): void => {
  const updateDocument = database.prepare(
    `UPDATE documents
     SET project_id = ?, updated_at = ?
     WHERE id = ?
       AND project_id = ?
       AND generation = ?
       AND head_seq = ?
       AND readiness = 'ready'
       AND authority = 'ydoc_primary'`,
  );
  for (const document of closure.documents) {
    const updated = updateDocument.run(
      request.targetProjectId,
      now,
      document.document_id,
      request.sourceProjectId,
      document.generation,
      document.head_seq,
    );
    if (updated.changes === 1) continue;
    throw new Error(
      `Document changed during Card transfer: ${document.document_id}`,
    );
  }

  const updateBlock = database.prepare(
    `UPDATE blocks
     SET project_id = ?,
         containing_database_id = CASE WHEN id = ? THEN ? ELSE containing_database_id END,
         location_revision = location_revision + 1,
         metadata_revision = metadata_revision + 1,
         updated_at = ?
     WHERE id = ?
       AND project_id = ?
       AND location_revision = ?
       AND metadata_revision = ?`,
  );
  for (const block of closure.blocks) {
    const updated = updateBlock.run(
      request.targetProjectId,
      request.cardId,
      request.target.databaseBlockId,
      now,
      block.id,
      request.sourceProjectId,
      block.location_revision,
      block.metadata_revision,
    );
    if (updated.changes === 1) continue;
    throw new Error(`Block changed during Card transfer: ${block.id}`);
  }

  const updateOwnership = database.prepare(
    `UPDATE block_documents
     SET project_id = ?
     WHERE block_id = ? AND document_id = ? AND project_id = ?`,
  );
  const updateCanvasFiles = database.prepare(
    `UPDATE canvas_scene_file_refs
     SET project_id = ?
     WHERE document_id = ? AND project_id = ?`,
  );
  const updateCanvasReferences = database.prepare(
    `UPDATE canvas_card_references
     SET project_id = ?
     WHERE document_id = ? AND project_id = ?`,
  );
  for (const document of closure.documents) {
    const ownership = updateOwnership.run(
      request.targetProjectId,
      document.owner_block_id,
      document.document_id,
      request.sourceProjectId,
    );
    if (ownership.changes !== 1) {
      throw new Error(
        `Document ownership changed during Card transfer: ${document.document_id}`,
      );
    }
    updateCanvasFiles.run(
      request.targetProjectId,
      document.document_id,
      request.sourceProjectId,
    );
    updateCanvasReferences.run(
      request.targetProjectId,
      document.document_id,
      request.sourceProjectId,
    );
  }
};

const insertTargetMemberships = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  prepared: PreparedTransfer,
  now: string,
): void => {
  for (const [status, rankPlan] of prepared.viewRanksByStatus) {
    applyExistingRanks(database, rankPlan, (blockId, rankKey) => {
      database
        .prepare(
          `UPDATE database_view_positions
           SET rank_key = ?
           WHERE view_id = ? AND block_id = ? AND project_id = ? AND group_key IS ?`,
        )
        .run(
          rankKey,
          request.target.viewId,
          blockId,
          request.targetProjectId,
          status,
        );
    });
  }

  const insertMembership = database.prepare(
    `INSERT INTO database_memberships (
       id, database_block_id, card_block_id, project_id,
       revision, created_at, removed_at
     ) VALUES (?, ?, ?, ?, 1, ?, NULL)`,
  );
  const insertValue = database.prepare(
    `INSERT INTO database_property_values (
       membership_id, property_id, database_block_id, project_id,
       value_type, value_json, revision, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  const insertPosition = database.prepare(
    `INSERT INTO database_view_positions (
       view_id, block_id, project_id, group_key, rank_key,
       revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  for (const membership of prepared.targetMemberships) {
    insertMembership.run(
      membership.targetMembershipId,
      request.target.databaseBlockId,
      membership.cardBlockId,
      request.targetProjectId,
      now,
    );
    for (const value of membership.values) {
      insertValue.run(
        membership.targetMembershipId,
        value.propertyId,
        request.target.databaseBlockId,
        request.targetProjectId,
        value.valueType,
        value.valueJson,
        now,
      );
    }
    const rank = prepared.viewRanksByStatus
      .get(membership.status)
      ?.finalRanks.get(membership.cardBlockId);
    if (!rank) {
      throw new Error(
        `Card transfer View rank plan is incomplete for ${membership.cardBlockId}`,
      );
    }
    insertPosition.run(
      request.target.viewId,
      membership.cardBlockId,
      request.targetProjectId,
      membership.status,
      rank,
      now,
      now,
    );
  }
};

const rebuildTransferProjections = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  closure: AuthorityClosure,
  now: string,
): void => {
  for (const document of closure.documents) {
    replaceDocumentSecondaryProjections(database, {
      documentId: document.document_id,
      expectedGeneration: document.generation,
      expectedProjectedSeq: document.head_seq,
    });
  }
  const cardIds = closure.blocks
    .filter((block) => block.type === "card")
    .map((block) => block.id);
  refreshScheduledCardIndexProjection(
    database,
    request.targetProjectId,
    cardIds,
    now,
  );
  rebuildCardReadModelProjection(database, request.targetProjectId, cardIds);
};

const clearTransferSecondaryProjections = (
  database: Database.Database,
  closure: AuthorityClosure,
): void => {
  const deleteSearch = database.prepare(
    "DELETE FROM block_search_units WHERE block_id = ? OR owner_block_id = ?",
  );
  for (const block of closure.blocks) deleteSearch.run(block.id, block.id);
  const deleteAssets = database.prepare(
    "DELETE FROM block_asset_refs WHERE document_id = ?",
  );
  const deleteCanvasFiles = database.prepare(
    "DELETE FROM canvas_scene_file_refs WHERE document_id = ?",
  );
  const deleteCanvasReferences = database.prepare(
    "DELETE FROM canvas_card_references WHERE document_id = ?",
  );
  for (const document of closure.documents) {
    deleteAssets.run(document.document_id);
    deleteCanvasFiles.run(document.document_id);
    deleteCanvasReferences.run(document.document_id);
  }
};

const assertNoForeignKeyViolations = (
  database: Database.Database,
): void => {
  const violations = database.pragma("foreign_key_check") as readonly {
    readonly table: string;
    readonly rowid: number | null;
    readonly parent: string;
    readonly fkid: number;
  }[];
  if (violations.length === 0) return;
  const first = violations[0];
  throw new Error(
    `Card transfer left a foreign-key violation in ${first?.table ?? "unknown"}`,
  );
};

const readStoredMutation = (
  database: Database.Database,
  operationId: string,
): StoredMutationRow | null =>
  (database
    .prepare(
      `SELECT
         mutation_id, project_id, store_epoch, mutation_kind,
         request_hash, request_json, outcome, result_json, change_log_seq
       FROM block_mutations
       WHERE mutation_id = ?`,
    )
    .get(operationId) as StoredMutationRow | undefined) ?? null;

const loadStoredOutcome = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  evidence: TransferEvidence,
  row: StoredMutationRow,
): CardProjectTransferCommandResult => {
  if (
    row.project_id !== request.targetProjectId ||
    row.store_epoch !== request.storeEpoch ||
    row.mutation_kind !== MUTATION_KIND ||
    row.request_hash !== evidence.requestHash ||
    row.request_json !== evidence.requestJson
  ) {
    return {
      ok: false,
      error: makeError(
        "operation_id_collision",
        `Operation ID ${request.operationId} already names another mutation`,
        request,
      ),
    };
  }
  if (row.outcome === "rejected") {
    try {
      return parseCardProjectTransferCommandResult({
        ok: false,
        error: JSON.parse(row.result_json) as unknown,
      });
    } catch {
      return {
        ok: false,
        error: makeError(
          "operation_receipt_corrupt",
          `Stored rejected transfer receipt is corrupt: ${request.operationId}`,
          request,
        ),
      };
    }
  }
  if (row.change_log_seq === null) {
    return {
      ok: false,
      error: makeError(
        "operation_receipt_corrupt",
        `Stored committed transfer has no change cursor: ${request.operationId}`,
        request,
      ),
    };
  }
  const change = database
    .prepare(
      `SELECT project_id, store_epoch, kind, operation_id, payload_json
       FROM change_log WHERE seq = ?`,
    )
    .get(row.change_log_seq) as
    | {
        readonly project_id: string;
        readonly store_epoch: string;
        readonly kind: string;
        readonly operation_id: string | null;
        readonly payload_json: string;
      }
    | undefined;
  if (
    !change ||
    change.project_id !== request.targetProjectId ||
    change.store_epoch !== request.storeEpoch ||
    change.kind !== CHANGE_KIND ||
    change.operation_id !== request.operationId
  ) {
    return {
      ok: false,
      error: makeError(
        "operation_receipt_corrupt",
        `Stored transfer change cursor is invalid: ${request.operationId}`,
        request,
      ),
    };
  }
  try {
    const payload = JSON.parse(change.payload_json) as {
      readonly requestHash?: unknown;
    };
    if (payload.requestHash !== evidence.requestHash) {
      throw new Error("change-log request hash diverged");
    }
    const receipt = parseCardProjectTransferReceipt(JSON.parse(row.result_json));
    if (receipt.changeLogSeq !== row.change_log_seq) {
      throw new Error("receipt cursor diverged");
    }
    return { ok: true, value: { ...receipt, duplicate: true } };
  } catch (error) {
    return {
      ok: false,
      error: makeError(
        "operation_receipt_corrupt",
        `Stored transfer receipt is corrupt: ${
          error instanceof Error ? error.message : String(error)
        }`,
        request,
      ),
    };
  }
};

/**
 * Resolve an immutable outcome from logical intent before touching source
 * authority. This makes response-loss retries independent of the Card's now
 * obsolete source Project coordinate while retaining operation-ID collision
 * detection.
 */
export const readCardProjectTransferOutcomeByIntent = (
  database: Database.Database,
  rawIntent: CardProjectTransferIntent,
): CardProjectTransferCommandResult | null => {
  let intent: CardProjectTransferIntent;
  try {
    intent = parseCardProjectTransferIntent(rawIntent);
  } catch (error) {
    return {
      ok: false,
      error: makeError(
        "invalid_card_project_transfer_request",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  const row = readStoredMutation(database, intent.operationId);
  if (!row) return null;
  const currentEpoch = readStoreEpoch(database);
  if (row.store_epoch !== currentEpoch) {
    return {
      ok: false,
      error: makeError(
        "store_epoch_mismatch",
        `Transfer receipt belongs to store epoch ${row.store_epoch}; current epoch is ${currentEpoch}`,
        intent,
      ),
    };
  }
  if (
    row.mutation_kind !== MUTATION_KIND ||
    row.project_id !== intent.targetProjectId
  ) {
    return {
      ok: false,
      error: makeError(
        "operation_id_collision",
        `Operation ID ${intent.operationId} already names another mutation`,
        intent,
      ),
    };
  }

  let storedRequest: CardProjectTransferRequest;
  try {
    const stored = JSON.parse(row.request_json) as Readonly<
      Record<string, unknown>
    >;
    storedRequest = parseCardProjectTransferRequest({
      ...stored,
      clientSessionId: intent.clientSessionId,
      actor: intent.actor,
    });
  } catch (error) {
    return {
      ok: false,
      error: makeError(
        "operation_receipt_corrupt",
        `Stored transfer request is corrupt: ${
          error instanceof Error ? error.message : String(error)
        }`,
        intent,
      ),
    };
  }
  if (
    !cardProjectTransferIntentsEqual(
      intent,
      cardProjectTransferIntentFromRequest(storedRequest),
    )
  ) {
    return {
      ok: false,
      error: makeError(
        "operation_id_collision",
        `Operation ID ${intent.operationId} already names another Card transfer intent`,
        intent,
      ),
    };
  }
  return loadStoredOutcome(
    database,
    storedRequest,
    makeEvidence(storedRequest),
    row,
  );
};

const persistLedger = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  evidence: TransferEvidence,
  input: {
    readonly outcome: "committed" | "rejected";
    readonly resultJson: string;
    readonly changeLogSeq: number | null;
    readonly committedRevisions: Readonly<Record<string, number>>;
    readonly documentHeads: Readonly<
      Record<string, Readonly<{ generation: number; headSeq: number }>>
    >;
    readonly now: string;
  },
): void => {
  database
    .prepare(
      `INSERT INTO block_mutations (
         mutation_id, project_id, store_epoch, mutation_kind, actor_json,
         client_session_id, request_hash, request_json, target_block_ids_json,
         affected_document_ids_json, affected_database_block_ids_json,
         field_intents_json, expected_revisions_json, outcome, result_json,
         committed_revisions_json, document_heads_json, change_log_seq,
         recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      request.operationId,
      request.targetProjectId,
      request.storeEpoch,
      MUTATION_KIND,
      evidence.actorJson,
      request.clientSessionId ?? null,
      evidence.requestHash,
      evidence.requestJson,
      stableStringifyBlockPropertyJson(
        request.expectedBlocks.map((block) => block.blockId),
      ),
      stableStringifyBlockPropertyJson(
        request.expectedDocuments.map((document) => document.documentId),
      ),
      stableStringifyBlockPropertyJson([
        request.target.databaseBlockId,
        ...request.expectedMemberships.map(
          (membership) => membership.databaseBlockId,
        ),
      ]),
      stableStringifyBlockPropertyJson([
        { path: "projectId", operation: "transfer" },
        { path: "databaseMembership", operation: "replace" },
      ]),
      evidence.expectedRevisionsJson,
      input.outcome,
      input.resultJson,
      stableStringifyBlockPropertyJson(input.committedRevisions),
      stableStringifyBlockPropertyJson(input.documentHeads),
      input.changeLogSeq,
      input.now,
    );
};

const persistRejected = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  evidence: TransferEvidence,
  error: CardProjectTransferCommandError,
  now: string,
): CardProjectTransferCommandResult => {
  persistLedger(database, request, evidence, {
    outcome: "rejected",
    resultJson: stableStringifyBlockPropertyJson(error),
    changeLogSeq: null,
    committedRevisions: {},
    documentHeads: {},
    now,
  });
  return { ok: false, error };
};

const persistChangeLog = (
  database: Database.Database,
  request: CardProjectTransferRequest,
  evidence: TransferEvidence,
  prepared: PreparedTransfer,
  documentHeads: CardProjectTransferReceipt["documentHeads"],
  now: string,
): number => {
  const payload = stableStringifyBlockPropertyJson({
    version: CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
    mutationKind: MUTATION_KIND,
    requestHash: evidence.requestHash,
    sourceProjectId: request.sourceProjectId,
    targetProjectId: request.targetProjectId,
    cardId: request.cardId,
    targetMembershipIds: Object.fromEntries(
      prepared.targetMemberships.map((membership) => [
        membership.cardBlockId,
        membership.targetMembershipId,
      ]),
    ),
    documentHeads,
  });
  const inserted = database
    .prepare(
      `INSERT INTO change_log (
         project_id, store_epoch, kind, operation_id, block_ids_json,
         document_ids_json, database_block_ids_json, payload_json, committed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      request.targetProjectId,
      request.storeEpoch,
      CHANGE_KIND,
      request.operationId,
      stableStringifyBlockPropertyJson(
        request.expectedBlocks.map((block) => block.blockId),
      ),
      stableStringifyBlockPropertyJson(
        request.expectedDocuments.map((document) => document.documentId),
      ),
      stableStringifyBlockPropertyJson(
        uniqueSorted([
          request.target.databaseBlockId,
          ...request.expectedMemberships.map(
            (membership) => membership.databaseBlockId,
          ),
        ]),
      ),
      payload,
      now,
    );
  const sequence = Number(inserted.lastInsertRowid);
  if (Number.isSafeInteger(sequence) && sequence >= 1) return sequence;
  throw new Error("SQLite returned an invalid Card transfer change sequence");
};

const buildReceipt = (
  request: CardProjectTransferRequest,
  prepared: PreparedTransfer,
  changeLogSeq: number,
  now: string,
): CardProjectTransferReceipt => {
  const blockMetadataRevisions = Object.fromEntries(
    prepared.closure.blocks.map((block) => [
      block.id,
      block.metadata_revision + 1,
    ]),
  );
  const documentHeads = Object.fromEntries(
    prepared.closure.documents.map((document) => [
      document.document_id,
      { generation: document.generation, headSeq: document.head_seq },
    ]),
  );
  const targetViewRank = prepared.viewRanksByStatus
    .get(request.target.status)
    ?.finalRanks.get(request.cardId);
  if (!targetViewRank) {
    throw new Error("Card transfer rank receipt is incomplete");
  }
  return parseCardProjectTransferReceipt({
    version: CARD_PROJECT_TRANSFER_CONTRACT_VERSION,
    operationId: request.operationId,
    storeEpoch: request.storeEpoch,
    sourceProjectId: request.sourceProjectId,
    targetProjectId: request.targetProjectId,
    cardId: request.cardId,
    duplicate: false,
    movedBlockIds: request.expectedBlocks.map((block) => block.blockId),
    movedDocumentIds: request.expectedDocuments.map(
      (document) => document.documentId,
    ),
    sourceMembershipIds: request.expectedMemberships.map(
      (membership) => membership.membershipId,
    ),
    targetMembershipIds: Object.fromEntries(
      prepared.targetMemberships.map((membership) => [
        membership.cardBlockId,
        membership.targetMembershipId,
      ]),
    ),
    blockMetadataRevisions,
    rootLocationRevision:
      (request.expectedBlocks.find((block) => block.blockId === request.cardId)
        ?.locationRevision ?? 0) + 1,
    documentHeads,
    targetDatabaseBlockId: request.target.databaseBlockId,
    targetDatabaseSchemaRevision: request.target.databaseSchemaRevision,
    targetViewId: request.target.viewId,
    targetStatus: request.target.status,
    targetViewRankKey: targetViewRank,
    changeLogSeq,
    committedAt: now,
  });
};

/**
 * Move one top-level Y.Doc-primary Card and its recursively owned Document
 * closure between Projects. References are intentionally not traversed. All
 * Project coordinates, membership replacement, projections, immutable receipt,
 * and disposable projections commit in one IMMEDIATE SQLite transaction while
 * Y.Doc updates, heads, state vectors, and internal struct identities remain
 * byte-for-byte unchanged.
 */
export const applyCardProjectTransfer = (
  database: Database.Database,
  rawRequest: CardProjectTransferRequest,
  options: ApplyCardProjectTransferOptions = {},
): CardProjectTransferCommandResult => {
  let request: CardProjectTransferRequest;
  try {
    request = parseCardProjectTransferRequest(rawRequest);
  } catch (error) {
    return {
      ok: false,
      error: makeError(
        "invalid_card_project_transfer_request",
        error instanceof CardProjectTransferContractError
          ? error.message
          : String(error),
      ),
    };
  }
  const evidence = makeEvidence(request);
  const inject = (point: CardProjectTransferFaultPoint): void => {
    options.faultInjector?.(point);
  };
  const transact = database.transaction((): CardProjectTransferCommandResult => {
    const currentEpoch = readStoreEpoch(database);
    if (currentEpoch !== request.storeEpoch) {
      return {
        ok: false,
        error: makeError(
          "store_epoch_mismatch",
          `Transfer belongs to store epoch ${request.storeEpoch}; current epoch is ${currentEpoch}`,
          request,
        ),
      };
    }
    const existing = readStoredMutation(database, request.operationId);
    if (existing) return loadStoredOutcome(database, request, evidence, existing);

    const targetProject = database
      .prepare("SELECT 1 FROM projects WHERE id = ?")
      .get(request.targetProjectId);
    if (!targetProject) {
      return {
        ok: false,
        error: makeError(
          "target_project_not_found",
          `Target Project does not exist: ${request.targetProjectId}`,
          request,
        ),
      };
    }
    const now = options.now?.() ?? new Date().toISOString();
    if (Number.isNaN(new Date(now).getTime())) {
      throw new TypeError("Card transfer clock returned an invalid timestamp");
    }
    try {
      if (request.sourceProjectId === request.targetProjectId) {
        reject("same_project", "Source and target Projects are equal", request);
      }
      const sourceProject = database
        .prepare("SELECT 1 FROM projects WHERE id = ?")
        .get(request.sourceProjectId);
      if (!sourceProject) {
        reject(
          "source_project_not_found",
          `Source Project does not exist: ${request.sourceProjectId}`,
          request,
        );
      }
      const closure = validateAuthorityClosure(database, request);
      const prepared = validateTarget(database, request, closure);

      // SQLite's documented per-transaction deferral is required because
      // Block, Document, ownership, and projection rows form a composite-FK
      // cycle. All coordinates are repaired before the outer commit.
      database.pragma("defer_foreign_keys = ON");
      database
        .prepare(
          `DELETE FROM card_read_model
           WHERE card_block_id IN (
             ${prepared.closure.blocks
               .filter((block) => block.type === "card")
               .map(() => "?")
               .join(", ")}
           )`,
        )
        .run(
          ...prepared.closure.blocks
            .filter((block) => block.type === "card")
            .map((block) => block.id),
        );
      clearTransferSecondaryProjections(database, prepared.closure);
      tombstoneSourceMemberships(database, request, prepared.closure, now);
      inject("after_source_memberships");
      moveProjectCoordinates(
        database,
        request,
        prepared.closure,
        now,
      );
      inject("after_project_coordinates");
      insertTargetMemberships(database, request, prepared, now);
      inject("after_target_memberships");
      rebuildTransferProjections(database, request, prepared.closure, now);
      inject("after_projections");
      assertNoForeignKeyViolations(database);

      const documentHeads = Object.fromEntries(
        prepared.closure.documents.map((document) => [
          document.document_id,
          { generation: document.generation, headSeq: document.head_seq },
        ]),
      );
      const changeLogSeq = persistChangeLog(
        database,
        request,
        evidence,
        prepared,
        documentHeads,
        now,
      );
      inject("after_change_log");
      const receipt = buildReceipt(request, prepared, changeLogSeq, now);
      persistLedger(database, request, evidence, {
        outcome: "committed",
        resultJson: stableStringifyBlockPropertyJson(receipt),
        changeLogSeq,
        committedRevisions: Object.fromEntries([
          ...prepared.closure.blocks.map((block) => [
            `block:${block.id}:metadata`,
            block.metadata_revision + 1,
          ] as const),
          ...prepared.closure.blocks.map((block) => [
            `block:${block.id}:location`,
            block.location_revision + 1,
          ] as const),
        ]),
        documentHeads,
        now,
      });
      inject("after_ledger");
      inject("before_commit");
      return { ok: true, value: receipt };
    } catch (error) {
      if (!(error instanceof TransferRejection)) throw error;
      const result = persistRejected(
        database,
        request,
        evidence,
        error.error,
        now,
      );
      inject("after_ledger");
      inject("before_commit");
      return result;
    }
  });
  const result = transact.immediate();
  inject("after_commit");
  return result;
};
