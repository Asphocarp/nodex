import type Database from "better-sqlite3";
import {
  canonicalizeNfmForBlockDocument,
  materializeCardDocument,
  type CardDocumentMaterialization,
} from "../../shared/block-documents/block-document-codec";
import type {
  DocumentAuthority,
  DocumentReadiness,
  OwnedBlockDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import { isLegacyForeignBodyReference } from "../../shared/block-documents/derived-records";
import { loadLegacyShadowBlockDocument } from "./block-document-store";

export type BlockDocumentCutoverErrorCode =
  | "owned_document_not_found"
  | "owner_not_writable"
  | "document_not_ready"
  | "document_generation_mismatch"
  | "document_head_mismatch"
  | "shadow_ledger_not_drained"
  | "shadow_ledger_failed"
  | "content_parity_failed"
  | "projection_parity_failed"
  | "foreign_body_reference";

export class BlockDocumentCutoverError extends Error {
  constructor(
    readonly code: BlockDocumentCutoverErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BlockDocumentCutoverError";
  }
}

export interface CutoverCardDocumentInput {
  readonly projectId: string;
  readonly ownerBlockId: string;
  readonly expectedGeneration: number;
  readonly expectedHeadSeq: number;
}

export interface CutoverEligibleCardDocumentsResult {
  readonly cutoverDocumentIds: readonly string[];
  readonly alreadyPrimary: number;
  readonly deferredForeignReferences: number;
}

interface OwnedDocumentRow {
  readonly project_id: string;
  readonly owner_block_id: string;
  readonly owner_type: string;
  readonly owner_lifecycle: "active" | "archived" | "deleted";
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly readiness: DocumentReadiness;
  readonly authority: DocumentAuthority;
  readonly state_vector: Buffer;
}

interface LegacyCardContentRow {
  readonly title: string;
  readonly description: string;
  readonly revision: number;
}

interface ShadowLedgerStatusRow {
  readonly last_event_seq: number;
  readonly last_source_revision: number;
  readonly latest_job_status: string | null;
  readonly latest_job_source_revision: number | null;
  readonly applied_document_head_seq: number | null;
  readonly unfinished_count: number;
  readonly failed_count: number;
}

interface MaterializationRow {
  readonly generation: number;
  readonly projected_seq: number;
  readonly nfm: string;
  readonly plain_text: string;
  readonly preview: string;
  readonly block_tree_json: string;
}

const requireIdentity = (value: string, field: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new BlockDocumentCutoverError(
    "owned_document_not_found",
    `${field} must be non-empty`,
  );
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database.prepare(`
    SELECT store_epoch FROM block_store_metadata WHERE id = 1
  `).get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new BlockDocumentCutoverError(
    "owned_document_not_found",
    "Block store epoch is missing",
  );
};

const readOwnedDocumentRow = (
  database: Database.Database,
  projectId: string,
  ownerBlockId: string,
): OwnedDocumentRow => {
  const row = database.prepare(`
    SELECT
      owner.project_id,
      owner.id AS owner_block_id,
      owner.type AS owner_type,
      owner.lifecycle AS owner_lifecycle,
      document.id AS document_id,
      document.generation,
      document.head_seq,
      document.schema_key,
      document.schema_version,
      document.readiness,
      document.authority,
      document.state_vector
    FROM blocks owner
    INNER JOIN block_documents ownership
      ON ownership.block_id = owner.id
      AND ownership.project_id = owner.project_id
    INNER JOIN documents document
      ON document.id = ownership.document_id
      AND document.project_id = owner.project_id
    WHERE owner.id = ? AND owner.project_id = ?
  `).get(ownerBlockId, projectId) as OwnedDocumentRow | undefined;
  if (row) return row;
  throw new BlockDocumentCutoverError(
    "owned_document_not_found",
    `Block ${ownerBlockId} has no owned Document in Project ${projectId}`,
  );
};

const toDescriptor = (
  row: OwnedDocumentRow,
  storeEpoch: string,
): OwnedBlockDocumentDescriptor => ({
  projectId: row.project_id,
  ownerBlockId: row.owner_block_id,
  ownerType: row.owner_type,
  ownerLifecycle: row.owner_lifecycle,
  documentId: row.document_id,
  storeEpoch,
  generation: row.generation,
  headSeq: row.head_seq,
  schemaKey: row.schema_key,
  schemaVersion: row.schema_version,
  readiness: row.readiness,
  authority: row.authority,
  stateVector: new Uint8Array(
    row.state_vector.buffer,
    row.state_vector.byteOffset,
    row.state_vector.byteLength,
  ).slice(),
});

export const getOwnedBlockDocumentDescriptor = (
  database: Database.Database,
  projectId: string,
  ownerBlockId: string,
): OwnedBlockDocumentDescriptor => {
  const normalizedProjectId = requireIdentity(projectId, "projectId");
  const normalizedOwnerBlockId = requireIdentity(ownerBlockId, "ownerBlockId");
  const read = database.transaction(() =>
    toDescriptor(
      readOwnedDocumentRow(
        database,
        normalizedProjectId,
        normalizedOwnerBlockId,
      ),
      readStoreEpoch(database),
    ),
  );
  return read();
};

const readLegacyCardContent = (
  database: Database.Database,
  row: OwnedDocumentRow,
): LegacyCardContentRow => {
  const card = database.prepare(`
    SELECT title, description, revision
    FROM cards
    WHERE id = ? AND project_id = ?
  `).get(row.owner_block_id, row.project_id) as
    | LegacyCardContentRow
    | undefined;
  if (card) return card;
  throw new BlockDocumentCutoverError(
    "owner_not_writable",
    `Card ${row.owner_block_id} is not an active legacy source row`,
  );
};

const assertShadowLedgerDrained = (
  database: Database.Database,
  row: OwnedDocumentRow,
  card: LegacyCardContentRow,
): void => {
  const ledger = database.prepare(`
    SELECT
      head.last_event_seq,
      head.last_source_revision,
      latest.status AS latest_job_status,
      latest.source_revision AS latest_job_source_revision,
      latest.applied_document_head_seq,
      (
        SELECT COUNT(*)
        FROM legacy_card_shadow_jobs job
        WHERE job.card_id = head.card_id
          AND job.status IN ('pending', 'processing')
      ) AS unfinished_count,
      (
        SELECT COUNT(*)
        FROM legacy_card_shadow_jobs job
        WHERE job.card_id = head.card_id AND job.status = 'failed'
      ) AS failed_count
    FROM legacy_card_shadow_heads head
    LEFT JOIN legacy_card_shadow_jobs latest
      ON latest.card_id = head.card_id
      AND latest.source_event_seq = head.last_event_seq
    WHERE head.card_id = ?
  `).get(row.owner_block_id) as ShadowLedgerStatusRow | undefined;
  if (!ledger || ledger.failed_count > 0) {
    throw new BlockDocumentCutoverError(
      "shadow_ledger_failed",
      `Card ${row.owner_block_id} has failed or missing shadow ledger state`,
    );
  }
  if (
    ledger.unfinished_count > 0 ||
    ledger.last_source_revision !== card.revision ||
    ledger.latest_job_status !== "applied" ||
    ledger.latest_job_source_revision !== card.revision ||
    ledger.applied_document_head_seq !== row.head_seq
  ) {
    throw new BlockDocumentCutoverError(
      "shadow_ledger_not_drained",
      `Card ${row.owner_block_id} shadow ledger has not reached Document head ${row.head_seq}`,
    );
  }
};

const readMaterialization = (
  database: Database.Database,
  documentId: string,
): MaterializationRow | null => {
  const row = database.prepare(`
    SELECT generation, projected_seq, nfm, plain_text, preview, block_tree_json
    FROM document_materializations
    WHERE document_id = ?
  `).get(documentId) as MaterializationRow | undefined;
  return row ?? null;
};

const assertContentAndProjectionParity = (
  database: Database.Database,
  row: OwnedDocumentRow,
  card: LegacyCardContentRow,
): CardDocumentMaterialization => {
  const loaded = loadLegacyShadowBlockDocument(database, row.document_id);
  let materialization: CardDocumentMaterialization;
  try {
    materialization = materializeCardDocument(loaded.document);
  } finally {
    loaded.document.destroy();
  }

  let expectedNfm: string;
  try {
    expectedNfm = canonicalizeNfmForBlockDocument(card.description);
  } catch (error) {
    throw new BlockDocumentCutoverError(
      "content_parity_failed",
      `Legacy NFM for Card ${row.owner_block_id} is invalid`,
      { cause: error },
    );
  }
  if (
    materialization.title !== card.title ||
    materialization.nfm !== expectedNfm
  ) {
    throw new BlockDocumentCutoverError(
      "content_parity_failed",
      `Card ${row.owner_block_id} title/body diverges from its Document`,
    );
  }

  const projection = readMaterialization(database, row.document_id);
  if (
    !projection ||
    projection.generation !== row.generation ||
    projection.projected_seq !== row.head_seq ||
    projection.nfm !== materialization.nfm ||
    projection.plain_text !== materialization.plainText ||
    projection.preview !== materialization.preview ||
    projection.block_tree_json !== JSON.stringify(materialization.blockTree)
  ) {
    throw new BlockDocumentCutoverError(
      "projection_parity_failed",
      `Document ${row.document_id} materialization is stale`,
    );
  }
  return materialization;
};

const assertNoForeignBodyReferences = (
  row: OwnedDocumentRow,
  materialization: CardDocumentMaterialization,
): void => {
  const foreignReference = materialization.references.find(
    isLegacyForeignBodyReference,
  );
  if (!foreignReference) return;
  throw new BlockDocumentCutoverError(
    "foreign_body_reference",
    `Document ${row.document_id} contains a legacy foreign-body reference`,
  );
};

interface LegacyForeignBodyParticipantRow {
  readonly host_block_id: string;
  readonly reference_kind: "legacy_card_projection" | "legacy_database_query";
}

/**
 * Legacy projection editors mutate both the host snapshot and the projected
 * Card snapshot. Until BF-05 replaces them with reference-only Blocks, every
 * participant must remain on the same legacy authority side: the host, a
 * directly referenced target, and every possible row of a dynamic Project
 * query. Query rules are mutable renderer configuration, so fencing the whole
 * source Project is the only safe pre-migration boundary.
 */
const assertNotLegacyForeignBodyParticipant = (
  database: Database.Database,
  row: OwnedDocumentRow,
): void => {
  const participant = database.prepare(`
    SELECT
      host_owner.id AS host_block_id,
      json_extract(reference.value, '$.kind') AS reference_kind
    FROM documents host_document
    INNER JOIN block_documents host_ownership
      ON host_ownership.document_id = host_document.id
    INNER JOIN blocks host_owner
      ON host_owner.id = host_ownership.block_id
      AND host_owner.project_id = host_ownership.project_id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = host_document.id
      AND materialization.generation = host_document.generation
      AND materialization.projected_seq = host_document.head_seq
    INNER JOIN json_each(materialization.references_json) reference
    WHERE host_document.authority = 'legacy_shadow'
      AND host_document.readiness = 'ready'
      AND (
        (
          json_extract(reference.value, '$.kind') = 'legacy_card_projection'
          AND json_extract(reference.value, '$.targetBlockId') = ?
        )
        OR (
          json_extract(reference.value, '$.kind') = 'legacy_database_query'
          AND json_extract(reference.value, '$.projectHint') = ?
        )
      )
    ORDER BY host_owner.project_id, host_owner.id
    LIMIT 1
  `).get(
    row.owner_block_id,
    row.project_id,
  ) as LegacyForeignBodyParticipantRow | undefined;
  if (!participant) return;

  throw new BlockDocumentCutoverError(
    "foreign_body_reference",
    participant.reference_kind === "legacy_card_projection"
      ? `Card ${row.owner_block_id} is projected by legacy host ${participant.host_block_id}`
      : `Card ${row.owner_block_id} can be projected by legacy query host ${participant.host_block_id}`,
  );
};

export const cutoverCardDocumentToPrimary = (
  database: Database.Database,
  input: CutoverCardDocumentInput,
): OwnedBlockDocumentDescriptor => {
  const projectId = requireIdentity(input.projectId, "projectId");
  const ownerBlockId = requireIdentity(input.ownerBlockId, "ownerBlockId");
  const cutover = database.transaction((): OwnedBlockDocumentDescriptor => {
    const storeEpoch = readStoreEpoch(database);
    const row = readOwnedDocumentRow(database, projectId, ownerBlockId);
    if (row.owner_type !== "card" || row.owner_lifecycle === "deleted") {
      throw new BlockDocumentCutoverError(
        "owner_not_writable",
        `Block ${ownerBlockId} is not a retained Card`,
      );
    }
    if (row.readiness !== "ready") {
      throw new BlockDocumentCutoverError(
        "document_not_ready",
        `Document ${row.document_id} is ${row.readiness}`,
      );
    }
    if (row.generation !== input.expectedGeneration) {
      throw new BlockDocumentCutoverError(
        "document_generation_mismatch",
        `Document ${row.document_id} generation is ${row.generation}`,
      );
    }
    if (row.authority === "ydoc_primary") {
      return toDescriptor(row, storeEpoch);
    }
    if (row.head_seq !== input.expectedHeadSeq) {
      throw new BlockDocumentCutoverError(
        "document_head_mismatch",
        `Document ${row.document_id} head is ${row.head_seq}`,
      );
    }

    const card = readLegacyCardContent(database, row);
    assertShadowLedgerDrained(database, row, card);
    const materialization = assertContentAndProjectionParity(
      database,
      row,
      card,
    );
    assertNoForeignBodyReferences(row, materialization);
    assertNotLegacyForeignBodyParticipant(database, row);

    const now = new Date().toISOString();
    const updated = database.prepare(`
      UPDATE documents
      SET authority = 'ydoc_primary', updated_at = ?
      WHERE id = ? AND generation = ? AND head_seq = ?
        AND readiness = 'ready' AND authority = 'legacy_shadow'
    `).run(
      now,
      row.document_id,
      row.generation,
      row.head_seq,
    );
    if (updated.changes !== 1) {
      throw new BlockDocumentCutoverError(
        "document_head_mismatch",
        `Document ${row.document_id} changed during cutover`,
      );
    }
    return toDescriptor(
      { ...row, authority: "ydoc_primary" },
      storeEpoch,
    );
  });
  return cutover.immediate();
};

/**
 * Monotonically cut over every retained, ready Card that no longer embeds a
 * foreign body. Archived Cards are read-only but keep the same owned
 * Document authority; deleting their compatibility row before this cutover
 * would otherwise strand that Document on legacy authority. A crash may stop
 * between Cards; rerunning is idempotent and can only advance legacy_shadow
 * to ydoc_primary.
 */
export const cutoverEligibleCardDocumentsToPrimary = (
  database: Database.Database,
  ownerBlockIds?: readonly string[],
): CutoverEligibleCardDocumentsResult => {
  const normalizedOwnerIds = ownerBlockIds
    ? Array.from(new Set(
        ownerBlockIds.map((ownerBlockId) =>
          requireIdentity(ownerBlockId, "ownerBlockIds entry"),
        ),
      ))
    : null;
  if (normalizedOwnerIds?.length === 0) {
    return {
      cutoverDocumentIds: [],
      alreadyPrimary: 0,
      deferredForeignReferences: 0,
    };
  }

  const ownerFilter = normalizedOwnerIds
    ? `AND owner.id IN (${normalizedOwnerIds.map(() => "?").join(", ")})`
    : "";
  const candidates = database.prepare(`
    SELECT
      owner.id AS owner_block_id,
      owner.project_id,
      document.id AS document_id,
      document.generation,
      document.head_seq,
      document.authority
    FROM blocks owner
    INNER JOIN cards card
      ON card.id = owner.id AND card.project_id = owner.project_id
    INNER JOIN block_documents ownership ON ownership.block_id = owner.id
    INNER JOIN documents document ON document.id = ownership.document_id
    WHERE owner.type = 'card'
      AND owner.lifecycle IN ('active', 'archived')
      AND document.readiness = 'ready'
      ${ownerFilter}
    ORDER BY owner.project_id, owner.id
  `).all(...(normalizedOwnerIds ?? [])) as readonly {
    readonly owner_block_id: string;
    readonly project_id: string;
    readonly document_id: string;
    readonly generation: number;
    readonly head_seq: number;
    readonly authority: DocumentAuthority;
  }[];

  const cutoverDocumentIds: string[] = [];
  let alreadyPrimary = 0;
  let deferredForeignReferences = 0;
  for (const candidate of candidates) {
    if (candidate.authority === "ydoc_primary") {
      alreadyPrimary += 1;
      continue;
    }
    try {
      const descriptor = cutoverCardDocumentToPrimary(database, {
        projectId: candidate.project_id,
        ownerBlockId: candidate.owner_block_id,
        expectedGeneration: candidate.generation,
        expectedHeadSeq: candidate.head_seq,
      });
      cutoverDocumentIds.push(descriptor.documentId);
    } catch (error) {
      if (
        error instanceof BlockDocumentCutoverError &&
        error.code === "foreign_body_reference"
      ) {
        deferredForeignReferences += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    cutoverDocumentIds,
    alreadyPrimary,
    deferredForeignReferences,
  };
};
