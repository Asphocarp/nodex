import type Database from "better-sqlite3";
import {
  BlockDocumentStoreError,
  compactBlockDocument,
  type CompactBlockDocumentResult,
} from "./block-document-store";

export const DEFAULT_BLOCK_DOCUMENT_COMPACTION_POLICY = {
  minimumUpdateCount: 128,
  minimumUpdateBytes: 2 * 1024 * 1024,
  maximumDocuments: 8,
  maximumTailBytes: 32 * 1024 * 1024,
  scanLimit: 128,
} as const satisfies BlockDocumentCompactionPolicy;

const MAXIMUM_DOCUMENTS_PER_BATCH = 64;
const MAXIMUM_SCAN_LIMIT = 512;
const MAXIMUM_BYTE_BUDGET = 512 * 1024 * 1024;

export interface BlockDocumentCompactionPolicy {
  readonly minimumUpdateCount: number;
  readonly minimumUpdateBytes: number;
  readonly maximumDocuments: number;
  readonly maximumTailBytes: number;
  readonly scanLimit: number;
}

export interface BlockDocumentCompactionCandidate {
  readonly documentId: string;
  readonly projectId: string;
  readonly ownerBlockId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly updateCount: number;
  readonly updateBytes: number;
  readonly oldestCommittedAt: string;
  readonly newestCommittedAt: string;
}

export interface CompactEligibleBlockDocumentsInput {
  readonly storeEpoch: string;
  readonly policy?: Partial<BlockDocumentCompactionPolicy>;
}

export interface CompactEligibleBlockDocumentsResult {
  readonly storeEpoch: string;
  readonly selectedDocumentCount: number;
  readonly selectedUpdateCount: number;
  readonly selectedUpdateBytes: number;
  readonly documents: readonly CompactBlockDocumentResult[];
}

interface CandidateRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly owner_block_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly update_count: number;
  readonly update_bytes: number;
  readonly oldest_committed_at: string;
  readonly newest_committed_at: string;
}

const requireSafeInteger = (
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number => {
  if (
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  ) {
    return value;
  }
  throw new BlockDocumentStoreError(
    "invalid_document_update",
    `${field} must be an integer between ${minimum} and ${maximum}`,
  );
};

const normalizePolicy = (
  policy: Partial<BlockDocumentCompactionPolicy> = {},
): BlockDocumentCompactionPolicy => {
  const normalized = {
    ...DEFAULT_BLOCK_DOCUMENT_COMPACTION_POLICY,
    ...policy,
  };
  const maximumDocuments = requireSafeInteger(
    normalized.maximumDocuments,
    "maximumDocuments",
    1,
    MAXIMUM_DOCUMENTS_PER_BATCH,
  );
  const scanLimit = requireSafeInteger(
    normalized.scanLimit,
    "scanLimit",
    maximumDocuments,
    MAXIMUM_SCAN_LIMIT,
  );
  return {
    minimumUpdateCount: requireSafeInteger(
      normalized.minimumUpdateCount,
      "minimumUpdateCount",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    minimumUpdateBytes: requireSafeInteger(
      normalized.minimumUpdateBytes,
      "minimumUpdateBytes",
      1,
      MAXIMUM_BYTE_BUDGET,
    ),
    maximumDocuments,
    maximumTailBytes: requireSafeInteger(
      normalized.maximumTailBytes,
      "maximumTailBytes",
      1,
      MAXIMUM_BYTE_BUDGET,
    ),
    scanLimit,
  };
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row) return row.store_epoch;
  throw new BlockDocumentStoreError(
    "store_not_initialized",
    "Block document store metadata is missing",
  );
};

const assertStoreEpoch = (
  database: Database.Database,
  expectedStoreEpoch: string,
): string => {
  const actualStoreEpoch = readStoreEpoch(database);
  if (expectedStoreEpoch === actualStoreEpoch) return actualStoreEpoch;
  throw new BlockDocumentStoreError(
    "store_epoch_mismatch",
    `Document compaction belongs to store epoch ${expectedStoreEpoch}; current epoch is ${actualStoreEpoch}`,
  );
};

const toCandidate = (row: CandidateRow): BlockDocumentCompactionCandidate => ({
  documentId: row.document_id,
  projectId: row.project_id,
  ownerBlockId: row.owner_block_id,
  generation: row.generation,
  headSeq: row.head_seq,
  updateCount: row.update_count,
  updateBytes: row.update_bytes,
  oldestCommittedAt: row.oldest_committed_at,
  newestCommittedAt: row.newest_committed_at,
});

export const selectBlockDocumentCompactionBatch = (
  candidates: readonly BlockDocumentCompactionCandidate[],
  policyInput: Partial<BlockDocumentCompactionPolicy> = {},
): readonly BlockDocumentCompactionCandidate[] => {
  const policy = normalizePolicy(policyInput);
  const selected: BlockDocumentCompactionCandidate[] = [];
  let selectedBytes = 0;

  for (const candidate of candidates) {
    if (selected.length >= policy.maximumDocuments) break;
    const exceedsBudget =
      selectedBytes + candidate.updateBytes > policy.maximumTailBytes;
    if (exceedsBudget && selected.length > 0) continue;
    selected.push(candidate);
    selectedBytes += candidate.updateBytes;
  }

  return selected;
};

export const listBlockDocumentCompactionCandidates = (
  database: Database.Database,
  policyInput: Partial<BlockDocumentCompactionPolicy> = {},
): readonly BlockDocumentCompactionCandidate[] => {
  const policy = normalizePolicy(policyInput);
  const rows = database
    .prepare(
      `
      SELECT
        document.id AS document_id,
        document.project_id,
        ownership.block_id AS owner_block_id,
        document.generation,
        document.head_seq,
        COUNT(update_row.seq) AS update_count,
        COALESCE(SUM(length(update_row.update_blob)), 0) AS update_bytes,
        MIN(update_row.committed_at) AS oldest_committed_at,
        MAX(update_row.committed_at) AS newest_committed_at
      FROM documents document
      JOIN block_documents ownership
        ON ownership.document_id = document.id
       AND ownership.project_id = document.project_id
      JOIN blocks owner
        ON owner.id = ownership.block_id
       AND owner.project_id = document.project_id
      JOIN document_updates update_row
        ON update_row.document_id = document.id
       AND update_row.generation = document.generation
      WHERE document.readiness = 'ready'
      GROUP BY
        document.id, document.project_id, ownership.block_id,
        document.generation, document.head_seq
      HAVING COUNT(update_row.seq) >= ?
        OR COALESCE(SUM(length(update_row.update_blob)), 0) >= ?
      ORDER BY
        MIN(update_row.committed_at) ASC,
        COALESCE(SUM(length(update_row.update_blob)), 0) DESC,
        document.id ASC
      LIMIT ?
    `,
    )
    .all(
      policy.minimumUpdateCount,
      policy.minimumUpdateBytes,
      policy.scanLimit,
    ) as readonly CandidateRow[];
  return rows.map(toCandidate);
};

/**
 * This function must run inside the process-wide mutation FIFO. Each selected
 * Document compacts in its own immediate transaction, so a corrupt candidate
 * cannot partially prune its payload while already completed Documents remain
 * valid maintenance progress.
 */
export const compactEligibleBlockDocuments = (
  database: Database.Database,
  input: CompactEligibleBlockDocumentsInput,
): CompactEligibleBlockDocumentsResult => {
  const storeEpoch = assertStoreEpoch(database, input.storeEpoch);
  const policy = normalizePolicy(input.policy);
  const candidates = selectBlockDocumentCompactionBatch(
    listBlockDocumentCompactionCandidates(database, policy),
    policy,
  );
  const documents = candidates.map((candidate) =>
    compactBlockDocument(database, {
      documentId: candidate.documentId,
      expectedGeneration: candidate.generation,
      expectedHeadSeq: candidate.headSeq,
    }),
  );
  return {
    storeEpoch,
    selectedDocumentCount: candidates.length,
    selectedUpdateCount: candidates.reduce(
      (total, candidate) => total + candidate.updateCount,
      0,
    ),
    selectedUpdateBytes: candidates.reduce(
      (total, candidate) => total + candidate.updateBytes,
      0,
    ),
    documents,
  };
};
