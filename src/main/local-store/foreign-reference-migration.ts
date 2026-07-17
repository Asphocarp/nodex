import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createUuidV7, isUuidV7 } from "../../shared/uuid-v7";
import {
  DEFAULT_WORKFLOW_STATUS,
  WORKFLOW_STATUS_LABELS,
  type WorkflowStatus,
} from "../../shared/workflow-status";
import { upgradeLegacyWorkflowStatus } from "../../shared/workflow-status-cutover";
import {
  MAX_PAGE_ASSIGNEE_LENGTH,
  MAX_PAGE_TAG_COUNT,
  MAX_PAGE_TAG_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
} from "../../shared/page-limits";
import {
  collectLegacyProjectionRootIds,
  migrateForeignReferences,
  type ForeignReferenceResolution,
} from "../../shared/block-documents";
import {
  materializePageDocument,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  MAX_BLOCK_ID_LENGTH,
} from "../../shared/block-documents/contracts";
import {
  isLegacyForeignBodyReference,
  type BlockDocumentReference,
} from "../../shared/block-documents/derived-records";
import type { LegacyInlineDatabaseViewProps } from "../../shared/database-views";
import { extractPlainText } from "../../shared/nfm/extract-text";
import { parseNfm } from "../../shared/nfm/parser";
import { serializeNfm } from "../../shared/nfm/serializer";
import type { NfmBlock, NfmCardToggle } from "../../shared/nfm/types";
import type {
  PageCreateInput,
  Estimate,
  Priority,
} from "../../shared/types";
import { summarizePageDescription } from "../../shared/page-summary";
import {
  applyLegacyShadowDocumentUpdate,
  loadLegacyShadowBlockDocumentForMigration,
} from "./block-document-store";
import {
  upsertLegacyInlineDatabaseView,
  type UpsertLegacyInlineDatabaseViewInput,
  type UpsertLegacyInlineDatabaseViewResult,
} from "./legacy-inline-database-views";
import { getDb } from "./database";
import * as descriptionRevisionService from "./description-revisions";
import { persistPageDocumentMaterialization } from "./document-materializations";

/** Shipped-store import only; current runtime never owns foreign bodies. */
const DEFAULT_BATCH_LIMIT = 50;
const MIGRATION_CLIENT_SESSION_ID = "foreign-reference-migration";

type LegacyReference = Extract<
  BlockDocumentReference,
  { readonly kind: "legacy_card_projection" | "legacy_database_query" }
>;

interface CandidateDocumentRow {
  readonly document_id: string;
  readonly host_block_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
}

interface StoredMaterializationRow {
  readonly generation: number;
  readonly projected_seq: number;
  readonly schema_version: number;
  readonly title: string;
  readonly nfm: string;
  readonly plain_text: string;
  readonly preview: string;
  readonly block_tree_json: string;
  readonly references_json: string;
  readonly asset_refs_json: string;
}

interface LedgerRow {
  readonly source_block_id: string;
  readonly host_document_id: string;
  readonly host_block_id: string;
  readonly project_id: string;
  readonly legacy_kind: "card_ref" | "card_toggle" | "database_query";
  readonly legacy_target_block_id: string | null;
  readonly occurrence: number;
  readonly source_fingerprint: string;
  readonly target_block_id: string | null;
  readonly database_view_id: string | null;
  readonly recovered_card_id: string | null;
  readonly status: "pending" | "applying" | "applied" | "failed";
  readonly attempt_count: number;
}

interface TargetCardRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly title: string | null;
}

interface RecoverySnapshot {
  readonly title?: string;
  readonly description?: string;
  readonly projectId?: string;
  readonly status?: string;
  readonly priority?: Priority | null;
  readonly estimate?: Estimate | null;
  readonly tags?: readonly string[];
  readonly dueDate?: Date | null;
  readonly scheduledStart?: Date | null;
  readonly scheduledEnd?: Date | null;
  readonly isAllDay?: boolean | null;
  readonly assignee?: string;
}

interface ResolvedDocumentMigration {
  readonly resolutions: readonly ForeignReferenceResolution[];
  readonly ledgerBySourceBlockId: ReadonlyMap<string, LedgerRow>;
  readonly recoveredCards: number;
  readonly databaseViewsCreated: number;
}

export interface ForeignReferenceMigrationBatchResult {
  readonly processedDocuments: number;
  readonly migratedReferences: number;
  readonly recoveredCards: number;
  readonly databaseViewsCreated: number;
  readonly failedDocuments: number;
  readonly exhausted: boolean;
  readonly changedDocumentIds: readonly string[];
  readonly errors: readonly {
    readonly documentId: string;
    readonly message: string;
  }[];
}

export interface ForeignReferenceMigrationDependencies {
  readonly createRecoveredCard?: (input: {
    readonly projectId: string;
    readonly status: WorkflowStatus;
    readonly card: PageCreateInput;
  }) => Promise<unknown>;
  readonly upsertInlineDatabaseView?: (
    input: UpsertLegacyInlineDatabaseViewInput,
    database: Database.Database,
  ) => UpsertLegacyInlineDatabaseViewResult;
  readonly createMigrationId?: () => string;
}

export interface MigrateForeignReferenceBatchOptions {
  readonly limit?: number;
  readonly dependencies?: ForeignReferenceMigrationDependencies;
}

export class ForeignReferenceMigrationStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ForeignReferenceMigrationStoreError";
  }
}

const requireBatchLimit = (value: number | undefined): number => {
  if (value === undefined) return DEFAULT_BATCH_LIMIT;
  if (Number.isSafeInteger(value) && value > 0 && value <= 1_000) return value;
  throw new TypeError(
    "Foreign reference migration limit must be between 1 and 1000",
  );
};

const readReadyLegacyDocuments = (
  database: Database.Database,
): readonly CandidateDocumentRow[] =>
  database
    .prepare(
      `
  SELECT
    document.id AS document_id,
    owner.id AS host_block_id,
    owner.project_id,
    document.generation,
    document.head_seq
  FROM documents document
  INNER JOIN block_documents ownership ON ownership.document_id = document.id
  INNER JOIN blocks owner ON owner.id = ownership.block_id
  WHERE document.authority = 'legacy_shadow'
    AND document.readiness = 'ready'
    AND owner.type = 'page'
  ORDER BY owner.project_id, owner.id
`,
    )
    .all() as readonly CandidateDocumentRow[];

const projectionMatches = (
  row: StoredMaterializationRow | undefined,
  input: {
    readonly generation: number;
    readonly headSeq: number;
    readonly materialization: ReturnType<typeof materializePageDocument>;
  },
): boolean =>
  Boolean(
    row &&
    row.generation === input.generation &&
    row.projected_seq === input.headSeq &&
    row.schema_version === input.materialization.schemaVersion &&
    row.title === input.materialization.title &&
    row.nfm === input.materialization.nfm &&
    row.plain_text === input.materialization.plainText &&
    row.preview === input.materialization.preview &&
    row.block_tree_json === JSON.stringify(input.materialization.blockTree) &&
    row.references_json === JSON.stringify(input.materialization.references) &&
    row.asset_refs_json === JSON.stringify(input.materialization.assetRefs),
  );

/**
 * Rebuilds the exact materialization from every ready legacy Y.Doc before the
 * candidate query. Search/asset secondary projections intentionally wait for
 * the current-schema startup repair; their live registry rejects retired
 * schemas by design.
 */
const synchronizeLegacyMaterializations = (
  database: Database.Database,
): void => {
  const readProjection = database.prepare(`
    SELECT
      generation, projected_seq, schema_version, title, nfm, plain_text,
      preview, block_tree_json, references_json, asset_refs_json
    FROM document_materializations
    WHERE document_id = ?
  `);
  for (const candidate of readReadyLegacyDocuments(database)) {
    const loaded = loadLegacyShadowBlockDocumentForMigration(
      database,
      candidate.document_id,
    );
    try {
      const materialization = materializePageDocument(loaded.document);
      const row = readProjection.get(candidate.document_id) as
        StoredMaterializationRow | undefined;
      if (
        projectionMatches(row, {
          generation: loaded.head.generation,
          headSeq: loaded.head.headSeq,
          materialization,
        })
      ) {
        continue;
      }
      persistPageDocumentMaterialization(database, {
        documentId: candidate.document_id,
        generation: loaded.head.generation,
        projectedSeq: loaded.head.headSeq,
        materialization,
      });
    } finally {
      loaded.document.destroy();
    }
  }
};

const readCandidateDocuments = (
  database: Database.Database,
  limit: number,
): readonly CandidateDocumentRow[] =>
  database
    .prepare(
      `
  SELECT
    document.id AS document_id,
    owner.id AS host_block_id,
    owner.project_id,
    document.generation,
    document.head_seq
  FROM documents document
  INNER JOIN block_documents ownership ON ownership.document_id = document.id
  INNER JOIN blocks owner ON owner.id = ownership.block_id
  INNER JOIN document_materializations materialization
    ON materialization.document_id = document.id
    AND materialization.generation = document.generation
    AND materialization.projected_seq = document.head_seq
  WHERE document.authority = 'legacy_shadow'
    AND document.readiness = 'ready'
    AND EXISTS (
      SELECT 1
      FROM json_each(materialization.references_json) reference
      WHERE json_extract(reference.value, '$.kind') IN (
        'legacy_card_projection',
        'legacy_database_query'
      )
    )
  ORDER BY owner.project_id, owner.id
  LIMIT ?
`,
    )
    .all(limit) as readonly CandidateDocumentRow[];

const hasCandidateDocuments = (database: Database.Database): boolean =>
  readCandidateDocuments(database, 1).length > 0;

const flattenBlockTree = (
  blocks: readonly BlockTreeNode[],
  target: Map<string, BlockTreeNode>,
): void => {
  for (const block of blocks) {
    target.set(block.id, block);
    flattenBlockTree(block.children, target);
  }
};

const mapNfmBlocksById = (
  blockTree: readonly BlockTreeNode[],
  nfmBlocks: readonly NfmBlock[],
  target: Map<string, NfmBlock>,
): void => {
  if (blockTree.length !== nfmBlocks.length) {
    throw new ForeignReferenceMigrationStoreError(
      "Foreign reference migration BlockTree/NFM roots diverged",
    );
  }
  blockTree.forEach((block, index) => {
    const nfmBlock = nfmBlocks[index];
    if (!nfmBlock) {
      throw new ForeignReferenceMigrationStoreError(
        `NFM Block is missing for ${block.id}`,
      );
    }
    target.set(block.id, nfmBlock);
    mapNfmBlocksById(block.children, nfmBlock.children, target);
  });
};

const readStringProp = (
  block: BlockTreeNode,
  key: string,
): string | undefined => {
  const value = block.props[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readTargetCard = (
  database: Database.Database,
  targetBlockId: string,
): TargetCardRow | null => {
  if (!targetBlockId) return null;
  const row = database
    .prepare(
      `
    SELECT
      block.id,
      block.project_id,
      block.type,
      block.lifecycle,
      COALESCE(materialization.title, card.title) AS title
    FROM blocks block
    LEFT JOIN block_documents ownership
      ON ownership.block_id = block.id
     AND ownership.project_id = block.project_id
    LEFT JOIN documents document
      ON document.id = ownership.document_id
     AND document.project_id = ownership.project_id
     AND document.readiness = 'ready'
    LEFT JOIN document_materializations materialization
      ON materialization.document_id = document.id
     AND materialization.generation = document.generation
     AND materialization.projected_seq = document.head_seq
    LEFT JOIN cards card ON card.id = block.id
    WHERE block.id = ?
    LIMIT 1
  `,
    )
    .get(targetBlockId) as TargetCardRow | undefined;
  if (!row || row.type !== "page" || row.title === null) return null;
  return row;
};

const blockIdentityExists = (
  database: Database.Database,
  blockId: string,
): boolean =>
  database.prepare("SELECT 1 FROM blocks WHERE id = ? LIMIT 1").get(blockId) !==
  undefined;

const allocateAvailableCardId = (
  database: Database.Database,
  allocate: () => string,
  forbiddenIds: ReadonlySet<string> = new Set(),
): string => {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = allocate();
    if (!isUuidV7(candidate)) {
      throw new ForeignReferenceMigrationStoreError(
        "Foreign reference migration IDs must be canonical UUID-v7 values",
      );
    }
    if (forbiddenIds.has(candidate)) continue;
    if (!blockIdentityExists(database, candidate)) return candidate;
  }
  throw new ForeignReferenceMigrationStoreError(
    "Could not allocate an unused Card identity for foreign reference recovery",
  );
};

const isCanonicalReferenceIdentity = (value: string): boolean =>
  value.length > 0 &&
  value === value.trim() &&
  value.length <= MAX_BLOCK_ID_LENGTH;

const reserveUnresolvedPageTarget = (
  database: Database.Database,
  candidate: CandidateDocumentRow,
  targetBlockId: string,
  legacyTargetBlockId: string,
): void => {
  const existing = database
    .prepare("SELECT 1 FROM blocks WHERE id = ? LIMIT 1")
    .get(targetBlockId);
  if (existing) return;
  const now = new Date().toISOString();
  const reserve = database.transaction(() => {
    database
      .prepare(
        `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind, containing_document_id,
        location_revision, metadata_revision, created_at, updated_at
      ) VALUES (?, ?, 'unresolved_card_reference', 'deleted', 'space', NULL, 1, 1, ?, ?)
    `,
      )
      .run(targetBlockId, candidate.project_id, now, now);
    database
      .prepare(
        `
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type, value_json,
        revision, updated_at
      ) VALUES (?, ?, 'unresolved_reference_diagnostic', 'json', ?, 1, ?)
    `,
      )
      .run(
        targetBlockId,
        candidate.project_id,
        JSON.stringify({
          kind: "legacy_card_reference",
          hostDocumentId: candidate.document_id,
          legacyTargetBlockId,
        }),
        now,
      );
  });
  reserve();
};

const projectExists = (
  database: Database.Database,
  projectId: string | undefined,
): projectId is string => {
  if (!projectId) return false;
  return (
    database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId) !==
    undefined
  );
};

const PRIORITIES = new Set<Priority>([
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
]);
const ESTIMATES = new Set<Estimate>(["xs", "s", "m", "l", "xl"]);

const readNullablePriority = (value: unknown): Priority | null | undefined => {
  if (value === null) return null;
  if (typeof value === "string" && PRIORITIES.has(value as Priority)) {
    return value as Priority;
  }
  return undefined;
};

const readNullableEstimate = (value: unknown): Estimate | null | undefined => {
  if (value === null) return null;
  if (typeof value === "string" && ESTIMATES.has(value as Estimate)) {
    return value as Estimate;
  }
  return undefined;
};

const readNullableDate = (value: unknown): Date | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const decodeSnapshot = (
  snapshot: string | undefined,
): RecoverySnapshot | null => {
  if (!snapshot) return null;
  try {
    const value = JSON.parse(
      Buffer.from(snapshot, "base64").toString("utf8"),
    ) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const record = value as Record<string, unknown>;
    const card =
      typeof record.card === "object" && record.card !== null
        ? (record.card as Record<string, unknown>)
        : {};
    const priority = readNullablePriority(card.priority);
    const estimate = readNullableEstimate(card.estimate);
    const dueDate = readNullableDate(card.dueDate);
    const scheduledStart = readNullableDate(card.scheduledStart);
    const scheduledEnd = readNullableDate(card.scheduledEnd);
    return {
      ...(typeof card.title === "string" ? { title: card.title } : {}),
      ...(typeof card.description === "string"
        ? { description: card.description }
        : {}),
      ...(typeof record.projectId === "string"
        ? { projectId: record.projectId }
        : {}),
      ...(typeof record.status === "string" ? { status: record.status } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(estimate !== undefined ? { estimate } : {}),
      ...(Array.isArray(card.tags)
        ? {
            tags: card.tags.filter(
              (tag): tag is string => typeof tag === "string",
            ),
          }
        : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(scheduledStart !== undefined ? { scheduledStart } : {}),
      ...(scheduledEnd !== undefined ? { scheduledEnd } : {}),
      ...(typeof card.isAllDay === "boolean"
        ? { isAllDay: card.isAllDay }
        : {}),
      ...(typeof card.assignee === "string" ? { assignee: card.assignee } : {}),
    };
  } catch {
    return null;
  }
};

const inlineText = (block: NfmCardToggle): string =>
  extractPlainText(
    serializeNfm([
      {
        type: "paragraph",
        content: block.content,
        children: [],
      },
    ]),
  ).trim();

interface RecoveryMeta {
  readonly priority?: Priority | null;
  readonly estimate?: Estimate | null;
  readonly status?: WorkflowStatus;
  readonly tags: readonly string[];
}

const PRIORITY_BY_META_TOKEN: Readonly<Record<string, Priority>> = {
  P0: "p0-critical",
  P1: "p1-high",
  P2: "p2-medium",
  P3: "p3-low",
  P4: "p4-later",
};
const ESTIMATE_BY_META_TOKEN: Readonly<Record<string, Estimate>> = {
  XS: "xs",
  S: "s",
  M: "m",
  L: "l",
  XL: "xl",
};
const STATUS_BY_META_TOKEN = new Map(
  Object.entries(WORKFLOW_STATUS_LABELS).map(([status, label]) => [
    label,
    status as WorkflowStatus,
  ]),
);

const parseRecoveryMeta = (meta: string): RecoveryMeta => {
  let priority: Priority | null | undefined;
  let estimate: Estimate | null | undefined;
  let status: WorkflowStatus | undefined;
  const tags: string[] = [];
  for (const match of meta.matchAll(/\[([^\]]+)\]/g)) {
    const token = match[1]?.trim();
    if (!token) continue;
    const nextPriority = PRIORITY_BY_META_TOKEN[token];
    if (nextPriority) {
      priority = nextPriority;
      continue;
    }
    if (token === "-") {
      estimate = null;
      continue;
    }
    const nextEstimate = ESTIMATE_BY_META_TOKEN[token.toUpperCase()];
    if (nextEstimate) {
      estimate = nextEstimate;
      continue;
    }
    const nextStatus = STATUS_BY_META_TOKEN.get(token);
    if (nextStatus) {
      status = nextStatus;
      continue;
    }
    tags.push(token);
  }
  return {
    ...(priority !== undefined ? { priority } : {}),
    ...(estimate !== undefined ? { estimate } : {}),
    ...(status ? { status } : {}),
    tags,
  };
};

const recoveryContent = (
  block: NfmCardToggle,
): Omit<PageCreateInput, "id"> & { readonly projectId?: string } => {
  const snapshot = decodeSnapshot(block.snapshot);
  const meta = parseRecoveryMeta(block.meta);
  const title =
    inlineText(block) || snapshot?.title?.trim() || "Recovered Card";
  const tags = [...new Set([...(snapshot?.tags ?? []), ...meta.tags])];
  const status =
    meta.status ??
    upgradeLegacyWorkflowStatus(block.sourceStatus) ??
    upgradeLegacyWorkflowStatus(snapshot?.status) ??
    undefined;
  return {
    title,
    // The live host subtree is the newest editable copy. Snapshot body text is
    // deliberately never allowed to resurrect content that the user deleted.
    description: serializeNfm(block.children),
    ...(status ? { status } : {}),
    ...(meta.priority !== undefined
      ? { priority: meta.priority }
      : snapshot?.priority !== undefined
        ? { priority: snapshot.priority }
        : {}),
    ...(meta.estimate !== undefined
      ? { estimate: meta.estimate }
      : snapshot?.estimate !== undefined
        ? { estimate: snapshot.estimate }
        : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(snapshot?.dueDate !== undefined ? { dueDate: snapshot.dueDate } : {}),
    ...(snapshot?.scheduledStart !== undefined
      ? { scheduledStart: snapshot.scheduledStart }
      : {}),
    ...(snapshot?.scheduledEnd !== undefined
      ? { scheduledEnd: snapshot.scheduledEnd }
      : {}),
    ...(snapshot?.isAllDay !== undefined
      ? { isAllDay: snapshot.isAllDay }
      : {}),
    ...(snapshot?.assignee !== undefined
      ? { assignee: snapshot.assignee }
      : {}),
    ...(snapshot?.projectId ? { projectId: snapshot.projectId } : {}),
  };
};

const sanitizeRecoveryCardInput = (
  input: Omit<PageCreateInput, "id" | "status">,
): Omit<PageCreateInput, "id" | "status"> => {
  const normalizedTags = input.tags
    ? [
        ...new Set(input.tags.map((tag) => tag.slice(0, MAX_PAGE_TAG_LENGTH))),
      ].slice(0, MAX_PAGE_TAG_COUNT)
    : undefined;
  const invalidRange =
    input.scheduledStart instanceof Date &&
    input.scheduledEnd instanceof Date &&
    input.scheduledEnd.getTime() <= input.scheduledStart.getTime();
  const scheduledEnd = invalidRange ? undefined : input.scheduledEnd;
  const hasAllDayPair =
    input.scheduledStart instanceof Date && scheduledEnd instanceof Date;
  const isAllDay =
    input.isAllDay === true && !hasAllDayPair ? false : input.isAllDay;
  return {
    ...input,
    title: input.title.slice(0, MAX_PAGE_TITLE_LENGTH),
    ...(normalizedTags ? { tags: normalizedTags } : {}),
    ...(input.assignee !== undefined
      ? { assignee: input.assignee.slice(0, MAX_PAGE_ASSIGNEE_LENGTH) }
      : {}),
    ...(invalidRange ? { scheduledEnd: undefined } : {}),
    ...(isAllDay !== undefined ? { isAllDay } : {}),
  };
};

/**
 * One source Block ID may be reintroduced with the same legacy target after a
 * prior migration. The full live root fingerprint separates those occurrences
 * so a newer orphan snapshot never silently reuses an older recovered Card.
 */
const fingerprintLegacyReferenceRoot = (nfmBlock: NfmBlock): string =>
  createHash("sha256")
    .update(serializeNfm([nfmBlock]))
    .digest("hex");

const readLedger = (
  database: Database.Database,
  sourceBlockId: string,
): LedgerRow | null => {
  const row = database
    .prepare(
      `
    SELECT
      source_block_id,
      host_document_id,
      host_block_id,
      project_id,
      legacy_kind,
      legacy_target_block_id,
      occurrence,
      source_fingerprint,
      target_block_id,
      database_view_id,
      recovered_card_id,
      status,
      attempt_count
    FROM foreign_reference_migrations
    WHERE source_block_id = ?
  `,
    )
    .get(sourceBlockId) as LedgerRow | undefined;
  return row ?? null;
};

const ensureLedger = (
  database: Database.Database,
  input: {
    readonly sourceBlockId: string;
    readonly candidate: CandidateDocumentRow;
    readonly legacyKind: LedgerRow["legacy_kind"];
    readonly legacyTargetBlockId?: string;
    readonly sourceFingerprint: string;
  },
): LedgerRow => {
  const now = new Date().toISOString();
  database
    .prepare(
      `
    INSERT INTO foreign_reference_migrations (
      source_block_id, host_document_id, host_block_id, project_id,
      legacy_kind, legacy_target_block_id, source_fingerprint, target_block_id,
      database_view_id, recovered_card_id,
      status, attempt_count, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending', 0, NULL, ?, ?)
    ON CONFLICT(source_block_id) DO NOTHING
  `,
    )
    .run(
      input.sourceBlockId,
      input.candidate.document_id,
      input.candidate.host_block_id,
      input.candidate.project_id,
      input.legacyKind,
      input.legacyTargetBlockId ?? null,
      input.sourceFingerprint,
      now,
      now,
    );
  let row = readLedger(database, input.sourceBlockId);
  if (
    !row ||
    row.host_document_id !== input.candidate.document_id ||
    row.host_block_id !== input.candidate.host_block_id ||
    row.project_id !== input.candidate.project_id
  ) {
    throw new ForeignReferenceMigrationStoreError(
      `Migration ledger identity collision for Block ${input.sourceBlockId}`,
    );
  }
  if (
    row.legacy_kind !== input.legacyKind ||
    row.legacy_target_block_id !== (input.legacyTargetBlockId ?? null) ||
    row.source_fingerprint !== input.sourceFingerprint
  ) {
    database
      .prepare(
        `
      UPDATE foreign_reference_migrations
      SET legacy_kind = ?,
          legacy_target_block_id = ?,
          source_fingerprint = ?,
          occurrence = occurrence + 1,
          target_block_id = NULL,
          database_view_id = NULL,
          recovered_card_id = NULL,
          status = 'pending',
          attempt_count = 0,
          last_error = NULL,
          updated_at = ?
      WHERE source_block_id = ?
    `,
      )
      .run(
        input.legacyKind,
        input.legacyTargetBlockId ?? null,
        input.sourceFingerprint,
        now,
        input.sourceBlockId,
      );
    row = readLedger(database, input.sourceBlockId);
    if (!row) {
      throw new ForeignReferenceMigrationStoreError(
        `Migration ledger could not reset Block ${input.sourceBlockId}`,
      );
    }
  }
  database
    .prepare(
      `
    UPDATE foreign_reference_migrations
    SET status = 'applying',
        attempt_count = attempt_count + 1,
        last_error = NULL,
        updated_at = ?
    WHERE source_block_id = ?
  `,
    )
    .run(now, input.sourceBlockId);
  const applying = readLedger(database, input.sourceBlockId);
  if (!applying) {
    throw new ForeignReferenceMigrationStoreError(
      `Migration ledger disappeared for Block ${input.sourceBlockId}`,
    );
  }
  return applying;
};

const setLedgerTarget = (
  database: Database.Database,
  sourceBlockId: string,
  input: {
    readonly targetBlockId?: string;
    readonly databaseViewId?: string;
    readonly recoveredCardId?: string;
  },
): LedgerRow => {
  const assignments: string[] = [];
  const values: string[] = [];
  if (input.targetBlockId !== undefined) {
    assignments.push("target_block_id = ?");
    values.push(input.targetBlockId);
  }
  if (input.databaseViewId !== undefined) {
    assignments.push("database_view_id = ?");
    values.push(input.databaseViewId);
  }
  if (input.recoveredCardId !== undefined) {
    assignments.push("recovered_card_id = ?");
    values.push(input.recoveredCardId);
  }
  if (assignments.length === 0) {
    throw new ForeignReferenceMigrationStoreError(
      `Migration ledger target is empty for Block ${sourceBlockId}`,
    );
  }
  assignments.push("updated_at = ?");
  values.push(new Date().toISOString(), sourceBlockId);
  database
    .prepare(
      `
    UPDATE foreign_reference_migrations
    SET ${assignments.join(", ")}
    WHERE source_block_id = ?
  `,
    )
    .run(...values);
  const row = readLedger(database, sourceBlockId);
  if (row) return row;
  throw new ForeignReferenceMigrationStoreError(
    `Could not update migration ledger for Block ${sourceBlockId}`,
  );
};

const markLedgersFailed = (
  database: Database.Database,
  hostDocumentId: string,
  error: unknown,
): void => {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  const update = database.prepare(`
    UPDATE foreign_reference_migrations
    SET status = 'failed', last_error = ?, updated_at = ?
    WHERE host_document_id = ? AND status = 'applying'
  `);
  update.run(message, now, hostDocumentId);
};

const legacyRunTarget = (
  target: PageCreateInput["runInTarget"],
): string => {
  if (target === "newWorktree") return "new_worktree";
  if (target === "cloud") return "cloud";
  return "local_project";
};

/**
 * Foreign-body recovery is deliberately a shipped-store import write. Inserting the
 * temporary compatibility row lets the transitional triggers create a
 * legacy-shadow Card shell and enqueue its body for the next fixed-point pass.
 * Public Card creation must never use this path because primary genesis
 * rejects legacy foreign bodies.
 */
const createDefaultRecoveredCard = async (
  database: Database.Database,
  input: {
  readonly projectId: string;
  readonly status: WorkflowStatus;
  readonly card: PageCreateInput;
  },
): Promise<void> => {
  const cardId = input.card.id;
  if (!cardId) {
    throw new ForeignReferenceMigrationStoreError(
      "Recovered Card requires a reserved identity",
    );
  }
  const description = input.card.description ?? "";
  const summary = summarizePageDescription(description);
  const nextOrder = database
    .prepare(
      `
      SELECT COALESCE(MAX("order"), -1) + 1 AS next_order
      FROM cards
      WHERE project_id = ? AND status = ? AND archived = 0
    `,
    )
    .get(input.projectId, input.status) as { readonly next_order: number };
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO cards (
        id, project_id, status, title, description,
        description_preview, description_length, has_description,
        priority, estimate, tags, due_date, assignee,
        run_in_target, run_in_local_path,
        run_in_base_branch, run_in_worktree_path, run_in_environment_path,
        scheduled_start, scheduled_end, is_all_day, recurrence_json,
        reminders_json, schedule_timezone, created, "order"
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    )
    .run(
      cardId,
      input.projectId,
      input.status,
      input.card.title,
      description,
      summary.descriptionPreview,
      summary.descriptionLength,
      summary.hasDescription ? 1 : 0,
      input.card.priority ?? null,
      input.card.estimate ?? null,
      JSON.stringify(input.card.tags ?? []),
      input.card.dueDate?.toISOString().slice(0, 10) ?? null,
      input.card.assignee?.trim() || null,
      legacyRunTarget(input.card.runInTarget),
      input.card.runInLocalPath?.trim() || null,
      input.card.runInBaseBranch?.trim() || null,
      input.card.runInWorktreePath?.trim() || null,
      input.card.runInEnvironmentPath?.trim() || null,
      input.card.scheduledStart?.toISOString() ?? null,
      input.card.scheduledEnd?.toISOString() ?? null,
      input.card.isAllDay ? 1 : 0,
      input.card.recurrence ? JSON.stringify(input.card.recurrence) : null,
      JSON.stringify(input.card.reminders ?? []),
      input.card.scheduleTimezone?.trim() || null,
      now,
      nextOrder.next_order,
    );
};

const resolveCardProjection = async (
  database: Database.Database,
  candidate: CandidateDocumentRow,
  reference: Extract<
    LegacyReference,
    { readonly kind: "legacy_card_projection" }
  >,
  block: BlockTreeNode,
  nfmBlock: NfmBlock,
  dependencies: Required<
    Pick<
      ForeignReferenceMigrationDependencies,
      "createRecoveredCard" | "createMigrationId"
    >
  >,
): Promise<{
  readonly resolution: Extract<
    ForeignReferenceResolution,
    { readonly kind: "page" }
  >;
  readonly ledger: LedgerRow;
  readonly recovered: boolean;
}> => {
  const legacyKind: LedgerRow["legacy_kind"] =
    block.type === "cardToggle" ? "card_toggle" : "card_ref";
  const initialTargetId = reference.targetBlockId;
  const canonicalLegacyTargetId = isCanonicalReferenceIdentity(initialTargetId)
    ? initialTargetId
    : "";
  let ledger = ensureLedger(database, {
    sourceBlockId: reference.sourceBlockId,
    candidate,
    legacyKind,
    ...(initialTargetId ? { legacyTargetBlockId: initialTargetId } : {}),
    sourceFingerprint: fingerprintLegacyReferenceRoot(nfmBlock),
  });

  const resolvedTarget = ledger.target_block_id
    ? readTargetCard(database, ledger.target_block_id)
    : null;
  if (resolvedTarget) {
    const resumedRecovery =
      legacyKind === "card_toggle" &&
      ledger.target_block_id !== ledger.legacy_target_block_id;
    ledger = setLedgerTarget(database, reference.sourceBlockId, {
      targetBlockId: resolvedTarget.id,
      ...(resumedRecovery
        ? { recoveredCardId: resolvedTarget.id }
        : ledger.recovered_card_id
          ? { recoveredCardId: ledger.recovered_card_id }
          : {}),
    });
    return {
      resolution: {
        kind: "page",
        sourceBlockId: reference.sourceBlockId,
        targetBlockId: resolvedTarget.id,
      },
      ledger,
      recovered: false,
    };
  }

  const legacyTarget = readTargetCard(database, canonicalLegacyTargetId);
  if (legacyTarget) {
    ledger = setLedgerTarget(database, reference.sourceBlockId, {
      targetBlockId: legacyTarget.id,
    });
    return {
      resolution: {
        kind: "page",
        sourceBlockId: reference.sourceBlockId,
        targetBlockId: legacyTarget.id,
      },
      ledger,
      recovered: false,
    };
  }

  if (block.type !== "cardToggle" || nfmBlock.type !== "cardToggle") {
    const persistedTargetId =
      ledger.target_block_id &&
      isCanonicalReferenceIdentity(ledger.target_block_id)
        ? ledger.target_block_id
        : "";
    const unresolvedTargetId =
      persistedTargetId ||
      canonicalLegacyTargetId ||
      allocateAvailableCardId(
        database,
        dependencies.createMigrationId,
        new Set(initialTargetId ? [initialTargetId] : []),
      );
    ledger = setLedgerTarget(database, reference.sourceBlockId, {
      targetBlockId: unresolvedTargetId,
    });
    reserveUnresolvedPageTarget(
      database,
      candidate,
      unresolvedTargetId,
      initialTargetId,
    );
    return {
      resolution: {
        kind: "page",
        sourceBlockId: reference.sourceBlockId,
        targetBlockId: unresolvedTargetId,
      },
      ledger,
      recovered: false,
    };
  }

  const recovery = recoveryContent(nfmBlock);
  const recoveryProjectId = projectExists(database, recovery.projectId)
    ? recovery.projectId
    : projectExists(database, reference.projectHint)
      ? reference.projectHint
      : candidate.project_id;
  const reservedRecoveryId =
    ledger.target_block_id &&
    isUuidV7(ledger.target_block_id) &&
    ledger.target_block_id !== initialTargetId &&
    !blockIdentityExists(database, ledger.target_block_id)
      ? ledger.target_block_id
      : null;
  const recoveredCardId =
    reservedRecoveryId ??
    allocateAvailableCardId(
      database,
      dependencies.createMigrationId,
      new Set(initialTargetId ? [initialTargetId] : []),
    );
  ledger = setLedgerTarget(database, reference.sourceBlockId, {
    targetBlockId: recoveredCardId,
  });
  let recoveredTarget = readTargetCard(database, recoveredCardId);
  let created = false;
  if (!recoveredTarget) {
    const {
      projectId: _recoveryProjectHint,
      status: recoveryStatus,
      ...recoveredCard
    } = recovery;
    void _recoveryProjectHint;
    const status = recoveryStatus ?? DEFAULT_WORKFLOW_STATUS;
    const sanitizedRecoveredCard = sanitizeRecoveryCardInput(recoveredCard);
    await dependencies.createRecoveredCard({
      projectId: recoveryProjectId,
      status,
      card: {
        ...sanitizedRecoveredCard,
        id: recoveredCardId,
      },
    });
    recoveredTarget = readTargetCard(database, recoveredCardId);
    created = true;
  }
  if (!recoveredTarget) {
    throw new ForeignReferenceMigrationStoreError(
      `Recovered Card ${recoveredCardId} was not created`,
    );
  }
  ledger = setLedgerTarget(database, reference.sourceBlockId, {
    targetBlockId: recoveredCardId,
    recoveredCardId,
  });
  return {
    resolution: {
      kind: "page",
      sourceBlockId: reference.sourceBlockId,
      targetBlockId: recoveredCardId,
    },
    ledger,
    recovered: created,
  };
};

const toLegacyInlineProps = (
  block: BlockTreeNode,
): LegacyInlineDatabaseViewProps => ({
  sourceProjectId: readStringProp(block, "sourceProjectId") ?? "default",
  ...(readStringProp(block, "rulesV2B64")
    ? { rulesV2B64: readStringProp(block, "rulesV2B64") }
    : {}),
  ...(readStringProp(block, "propertyOrderCsv")
    ? { propertyOrderCsv: readStringProp(block, "propertyOrderCsv") }
    : {}),
  ...(readStringProp(block, "hiddenPropertiesCsv")
    ? { hiddenPropertiesCsv: readStringProp(block, "hiddenPropertiesCsv") }
    : {}),
  ...(readStringProp(block, "showEmptyEstimate")
    ? {
        showEmptyEstimate: readStringProp(block, "showEmptyEstimate") as
          "true" | "false",
      }
    : {}),
  ...(readStringProp(block, "showEmptyPriority")
    ? {
        showEmptyPriority: readStringProp(block, "showEmptyPriority") as
          "true" | "false",
      }
    : {}),
});

const resolveDocument = async (
  database: Database.Database,
  candidate: CandidateDocumentRow,
  materialization: ReturnType<typeof materializePageDocument>,
  dependencies: Required<
    Pick<
      ForeignReferenceMigrationDependencies,
      "createRecoveredCard" | "upsertInlineDatabaseView" | "createMigrationId"
    >
  >,
): Promise<ResolvedDocumentMigration> => {
  const rootIds = collectLegacyProjectionRootIds(materialization.blockTree);
  const references = materialization.references.filter(
    (reference): reference is LegacyReference =>
      isLegacyForeignBodyReference(reference) &&
      rootIds.has(reference.sourceBlockId),
  );
  const blocks = new Map<string, BlockTreeNode>();
  flattenBlockTree(materialization.blockTree, blocks);
  const nfmBlocks = new Map<string, NfmBlock>();
  mapNfmBlocksById(
    materialization.blockTree,
    parseNfm(materialization.nfm),
    nfmBlocks,
  );

  const resolutions: ForeignReferenceResolution[] = [];
  const ledgerBySourceBlockId = new Map<string, LedgerRow>();
  let recoveredCards = 0;
  let databaseViewsCreated = 0;
  for (const reference of references) {
    const block = blocks.get(reference.sourceBlockId);
    const nfmBlock = nfmBlocks.get(reference.sourceBlockId);
    if (!block || !nfmBlock) {
      throw new ForeignReferenceMigrationStoreError(
        `Legacy reference Block ${reference.sourceBlockId} is missing`,
      );
    }
    if (reference.kind === "legacy_card_projection") {
      const resolved = await resolveCardProjection(
        database,
        candidate,
        reference,
        block,
        nfmBlock,
        dependencies,
      );
      resolutions.push(resolved.resolution);
      ledgerBySourceBlockId.set(reference.sourceBlockId, resolved.ledger);
      if (resolved.recovered) recoveredCards += 1;
      continue;
    }

    let ledger = ensureLedger(database, {
      sourceBlockId: reference.sourceBlockId,
      candidate,
      legacyKind: "database_query",
      sourceFingerprint: fingerprintLegacyReferenceRoot(nfmBlock),
    });
    const legacyProps = toLegacyInlineProps(block);
    const resolvedSourceProjectId = projectExists(
      database,
      legacyProps.sourceProjectId,
    )
      ? legacyProps.sourceProjectId
      : candidate.project_id;
    const upserted = dependencies.upsertInlineDatabaseView(
      {
        sourceBlockId: reference.sourceBlockId,
        hostDocumentId: candidate.document_id,
        hostProjectId: candidate.project_id,
        resolvedSourceProjectId,
        name: "Inline view",
        props: legacyProps,
      },
      database,
    );
    ledger = setLedgerTarget(database, reference.sourceBlockId, {
      databaseViewId: upserted.view.id,
    });
    ledgerBySourceBlockId.set(reference.sourceBlockId, ledger);
    resolutions.push({
      kind: "database_view",
      sourceBlockId: reference.sourceBlockId,
      databaseViewId: upserted.view.id,
      displayHint: upserted.view.name,
    });
    if (upserted.definitionChange === "created") databaseViewsCreated += 1;
  }
  return {
    resolutions,
    ledgerBySourceBlockId,
    recoveredCards,
    databaseViewsCreated,
  };
};

const commitDocumentMigration = (
  database: Database.Database,
  candidate: CandidateDocumentRow,
  migration: ReturnType<typeof migrateForeignReferences>,
  ledgerBySourceBlockId: ReadonlyMap<string, LedgerRow>,
  storeEpoch: string,
): void => {
  const commit = database.transaction(() => {
    const ack = applyLegacyShadowDocumentUpdate(database, {
      documentId: candidate.document_id,
      storeEpoch,
      generation: candidate.generation,
      updateId: `foreign-reference:${candidate.document_id}:${candidate.generation}:${candidate.head_seq}`,
      clientSessionId: MIGRATION_CLIENT_SESSION_ID,
      baseHeadSeq: candidate.head_seq,
      touchedBlockIds: migration.migratedBlockIds,
      update: migration.update,
    });
    if (ack.duplicate) {
      throw new ForeignReferenceMigrationStoreError(
        `Unexpected duplicate migration update for ${candidate.document_id}`,
      );
    }

    const card = database
      .prepare(
        `
      SELECT description, description_revision_id
      FROM cards
      WHERE id = ?
    `,
      )
      .get(candidate.host_block_id) as
      | {
          readonly description: string;
          readonly description_revision_id: number | null;
        }
      | undefined;
    if (card && card.description !== migration.materialization.nfm) {
      const now = new Date().toISOString();
      const descriptionRevisionId = card.description_revision_id
        ? descriptionRevisionService.createNextDescriptionRevision(
            database,
            candidate.host_block_id,
            card.description_revision_id,
            migration.materialization.nfm,
            now,
          )
        : descriptionRevisionService.createInitialDescriptionRevision(
            database,
            candidate.host_block_id,
            migration.materialization.nfm,
            now,
          );
      database
        .prepare(
          `
        UPDATE cards
        SET description = ?,
            description_revision_id = ?,
            revision = revision + 1
        WHERE id = ?
      `,
        )
        .run(
          migration.materialization.nfm,
          descriptionRevisionId,
          candidate.host_block_id,
        );
    }

    const now = new Date().toISOString();
    const markApplied = database.prepare(`
      UPDATE foreign_reference_migrations
      SET status = 'applied', last_error = NULL, updated_at = ?
      WHERE source_block_id = ? AND status = 'applying'
    `);
    for (const [sourceBlockId] of ledgerBySourceBlockId) {
      const updated = markApplied.run(now, sourceBlockId);
      if (updated.changes !== 1) {
        throw new ForeignReferenceMigrationStoreError(
          `Migration ledger ${sourceBlockId} could not be committed`,
        );
      }
    }
  });
  commit.immediate();
};

export const migrateLegacyForeignReferences = async (
  database: Database.Database = getDb(),
  options: MigrateForeignReferenceBatchOptions = {},
): Promise<ForeignReferenceMigrationBatchResult> => {
  const limit = requireBatchLimit(options.limit);
  synchronizeLegacyMaterializations(database);
  const dependencies = {
    createRecoveredCard:
      options.dependencies?.createRecoveredCard ??
      ((input) => createDefaultRecoveredCard(database, input)),
    upsertInlineDatabaseView:
      options.dependencies?.upsertInlineDatabaseView ??
      ((
        input: UpsertLegacyInlineDatabaseViewInput,
        target: Database.Database,
      ) => upsertLegacyInlineDatabaseView(input, target)),
    createMigrationId: options.dependencies?.createMigrationId ?? createUuidV7,
  };
  const candidates = readCandidateDocuments(database, limit);
  const changedDocumentIds: string[] = [];
  const errors: Array<{ documentId: string; message: string }> = [];
  let migratedReferences = 0;
  let recoveredCards = 0;
  let databaseViewsCreated = 0;
  for (const candidate of candidates) {
    try {
      const loaded = loadLegacyShadowBlockDocumentForMigration(
        database,
        candidate.document_id,
      );
      try {
        const materialization = materializePageDocument(loaded.document);
        const resolved = await resolveDocument(
          database,
          candidate,
          materialization,
          dependencies,
        );
        const migration = migrateForeignReferences(
          loaded.document,
          resolved.resolutions,
        );
        commitDocumentMigration(
          database,
          candidate,
          migration,
          resolved.ledgerBySourceBlockId,
          loaded.storeEpoch,
        );
        changedDocumentIds.push(candidate.document_id);
        migratedReferences += migration.migratedBlockIds.length;
        recoveredCards += resolved.recoveredCards;
        databaseViewsCreated += resolved.databaseViewsCreated;
      } finally {
        loaded.document.destroy();
      }
    } catch (error) {
      markLedgersFailed(database, candidate.document_id, error);
      errors.push({
        documentId: candidate.document_id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    processedDocuments: candidates.length,
    migratedReferences,
    recoveredCards,
    databaseViewsCreated,
    failedDocuments: errors.length,
    exhausted: !hasCandidateDocuments(database),
    changedDocumentIds,
    errors,
  };
};

export const foreignReferenceMigrationTestHelpers = {
  recoveryContent,
};
