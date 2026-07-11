import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  createCardDocumentGenesis,
  materializeCardDocument,
  type CardDocumentMaterialization,
} from "../../shared/block-documents/block-document-codec";
import { translateLegacyNfmIntoCardDocument } from "../../shared/block-documents/legacy-nfm-shadow-translator";
import { createUuidV7FromTimestamp } from "../../shared/card-id";
import { parseNfm } from "../../shared/nfm/parser";
import { serializeNfm } from "../../shared/nfm/serializer";
import {
  applyLegacyShadowDocumentUpdate,
  initializeCardDocumentGenesis,
  loadLegacyShadowBlockDocument,
} from "./block-document-store";
import {
  claimNextLegacyCardShadowJob,
  markLegacyCardShadowJobApplied,
  markLegacyCardShadowJobFailed,
  markLegacyCardShadowJobSuperseded,
  readLegacyCardShadowHead,
  type ClaimLegacyCardShadowJobOptions,
  type LegacyCardShadowJob,
} from "./legacy-card-shadow-outbox";

const SHADOW_PROCESSOR_SESSION_ID = "legacy-card-shadow-processor";
const MAX_FAILURE_MESSAGE_LENGTH = 2_000;
const DEFAULT_DRAIN_LIMIT = 100;

interface LegacyCardSourceRow {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string;
  readonly revision: number;
  readonly archived: number;
  readonly created: string;
}

interface LegacyCardDocumentRow {
  readonly document_id: string;
  readonly document_project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
  readonly genesis_source_revision: number | null;
  readonly owner_block_id: string;
  readonly owner_project_id: string;
  readonly owner_type: string;
  readonly owner_lifecycle: "active" | "archived" | "deleted";
}

interface ClaimedJobFenceRow {
  readonly status: string;
  readonly claim_token: string | null;
}

export type LegacyCardShadowProcessingOutcome =
  | "applied"
  | "superseded"
  | "failed";

export interface LegacyCardShadowProcessingResult {
  readonly jobId: string;
  readonly cardId: string;
  readonly sourceEventSeq: number;
  readonly outcome: LegacyCardShadowProcessingOutcome;
  readonly documentHeadSeq: number | null;
  readonly documentChanged: boolean;
  readonly error: string | null;
}

export interface DrainLegacyCardShadowJobsOptions {
  readonly maxJobs?: number;
  readonly claim?: Omit<ClaimLegacyCardShadowJobOptions, "claimToken">;
  readonly createClaimToken?: (index: number) => string;
}

export interface LegacyCardShadowDrainResult {
  readonly exhausted: boolean;
  readonly results: readonly LegacyCardShadowProcessingResult[];
}

export interface LegacyCardShadowProcessorProbeResult {
  readonly processedJobs: number;
  readonly appliedJobs: number;
  readonly supersededJobs: number;
  readonly failedJobs: number;
  readonly pendingJobs: number;
  readonly processingJobs: number;
  readonly currentCards: number;
  readonly readyCurrentCardDocuments: number;
  readonly allCurrentCardsReady: boolean;
  readonly allCurrentCardContentInParity: boolean;
}

export class LegacyCardShadowProcessorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LegacyCardShadowProcessorError";
  }
}

const assertPositiveInteger = (value: number, field: string): number => {
  if (Number.isInteger(value) && value > 0) return value;
  throw new LegacyCardShadowProcessorError(`${field} must be a positive integer`);
};

const requireClaimToken = (job: LegacyCardShadowJob): string => {
  if (job.status === "processing" && job.claimToken) return job.claimToken;
  throw new LegacyCardShadowProcessorError(
    `Legacy shadow job ${job.id} is not a claimed processing job`,
  );
};

const toFailureMessage = (error: unknown): string => {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_FAILURE_MESSAGE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 3)}...`;
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database.prepare(`
    SELECT store_epoch
    FROM block_store_metadata
    WHERE id = 1
  `).get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new LegacyCardShadowProcessorError("Block store epoch is missing");
};

const readCardSource = (
  database: Database.Database,
  cardId: string,
): LegacyCardSourceRow | null => {
  const row = database.prepare(`
    SELECT id, project_id, title, description, revision, archived, created
    FROM cards
    WHERE id = ?
  `).get(cardId) as LegacyCardSourceRow | undefined;
  return row ?? null;
};

const readCardDocument = (
  database: Database.Database,
  documentId: string,
): LegacyCardDocumentRow => {
  const row = database.prepare(`
    SELECT
      document.id AS document_id,
      document.project_id AS document_project_id,
      document.generation,
      document.head_seq,
      document.readiness,
      document.authority,
      document.genesis_source_revision,
      owner.id AS owner_block_id,
      owner.project_id AS owner_project_id,
      owner.type AS owner_type,
      owner.lifecycle AS owner_lifecycle
    FROM documents document
    INNER JOIN block_documents ownership ON ownership.document_id = document.id
    INNER JOIN blocks owner ON owner.id = ownership.block_id
    WHERE document.id = ?
  `).get(documentId) as LegacyCardDocumentRow | undefined;
  if (row) return row;
  throw new LegacyCardShadowProcessorError(
    `Legacy shadow Document ${documentId} is missing its owner`,
  );
};

const assertClaimFence = (
  database: Database.Database,
  job: LegacyCardShadowJob,
  claimToken: string,
): void => {
  const row = database.prepare(`
    SELECT status, claim_token
    FROM legacy_card_shadow_jobs
    WHERE id = ?
  `).get(job.id) as ClaimedJobFenceRow | undefined;
  if (row?.status === "processing" && row.claim_token === claimToken) return;
  throw new LegacyCardShadowProcessorError(
    `Legacy shadow job ${job.id} is no longer owned by claim ${claimToken}`,
  );
};

const assertLatestSourceMatchesJob = (
  job: LegacyCardShadowJob,
  source: LegacyCardSourceRow | null,
  document: LegacyCardDocumentRow,
): void => {
  if (document.document_id !== job.documentId) {
    throw new LegacyCardShadowProcessorError(
      `Job ${job.id} points at unexpected Document ${document.document_id}`,
    );
  }
  if (document.owner_block_id !== job.cardId || document.owner_type !== "card") {
    throw new LegacyCardShadowProcessorError(
      `Document ${job.documentId} is not owned by Card ${job.cardId}`,
    );
  }
  if (document.authority !== "legacy_shadow") {
    throw new LegacyCardShadowProcessorError(
      `Document ${job.documentId} has authority ${document.authority}`,
    );
  }
  if (document.readiness === "failed") {
    throw new LegacyCardShadowProcessorError(
      `Document ${job.documentId} is in failed readiness`,
    );
  }
  if (
    document.generation !== job.expectedDocumentGeneration
    || document.head_seq !== job.expectedDocumentHeadSeq
    || document.readiness !== job.expectedDocumentReadiness
    || document.authority !== job.expectedDocumentAuthority
  ) {
    throw new LegacyCardShadowProcessorError(
      `Document ${job.documentId} no longer matches job ${job.id}'s expected head`,
    );
  }

  if (job.operation === "delete") {
    if (!source && document.owner_lifecycle === "deleted") return;
    throw new LegacyCardShadowProcessorError(
      `Delete job ${job.id} still has a live Card or non-deleted Block`,
    );
  }
  if (!source) {
    throw new LegacyCardShadowProcessorError(
      `Legacy source Card ${job.cardId} disappeared before ${job.operation}`,
    );
  }
  const expectedLifecycle = source.archived === 1 ? "archived" : "active";
  if (
    source.revision !== job.sourceRevision
    || source.project_id !== job.projectId
    || document.document_project_id !== source.project_id
    || document.owner_project_id !== source.project_id
    || document.owner_lifecycle !== expectedLifecycle
  ) {
    throw new LegacyCardShadowProcessorError(
      `Legacy source Card ${job.cardId} no longer matches job ${job.id}`,
    );
  }
  if (
    document.readiness === "pending_genesis"
    && document.genesis_source_revision !== source.revision
  ) {
    throw new LegacyCardShadowProcessorError(
      `Document ${job.documentId} genesis revision is stale`,
    );
  }
};

const createDeterministicBlockIdAllocator = (
  card: LegacyCardSourceRow,
  job: LegacyCardShadowJob,
): (() => string) => {
  const timestamp = new Date(card.created).getTime();
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new LegacyCardShadowProcessorError(
      `Card ${card.id} has an invalid creation timestamp`,
    );
  }
  let sequence = 0;
  return (): string => {
    const currentSequence = sequence;
    sequence += 1;
    const random = createHash("sha256")
      .update(`${card.id}\u0000${job.id}\u0000${currentSequence}`)
      .digest()
      .subarray(0, 16);
    return createUuidV7FromTimestamp(timestamp, currentSequence, random);
  };
};

const normalizeLegacyNfm = (nfm: string): string => serializeNfm(parseNfm(nfm));

const assertContentParity = (
  source: LegacyCardSourceRow,
  materialization: CardDocumentMaterialization,
): void => {
  const normalizedNfm = normalizeLegacyNfm(source.description);
  if (
    materialization.title === source.title
    && materialization.nfm === normalizedNfm
  ) {
    return;
  }
  throw new LegacyCardShadowProcessorError(
    `Document for Card ${source.id} failed normalized title/NFM parity`,
  );
};

const persistMaterialization = (
  database: Database.Database,
  documentId: string,
  generation: number,
  headSeq: number,
  materialization: CardDocumentMaterialization,
): void => {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO document_materializations (
      document_id, generation, projected_seq, nfm, plain_text,
      preview, block_tree_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET
      generation = excluded.generation,
      projected_seq = excluded.projected_seq,
      nfm = excluded.nfm,
      plain_text = excluded.plain_text,
      preview = excluded.preview,
      block_tree_json = excluded.block_tree_json,
      updated_at = excluded.updated_at
  `).run(
    documentId,
    generation,
    headSeq,
    materialization.nfm,
    materialization.plainText,
    materialization.preview,
    JSON.stringify(materialization.blockTree),
    now,
  );
};

const loadPersistedMaterialization = (
  database: Database.Database,
  documentId: string,
): {
  readonly generation: number;
  readonly headSeq: number;
  readonly materialization: CardDocumentMaterialization;
} => {
  const loaded = loadLegacyShadowBlockDocument(database, documentId);
  try {
    return {
      generation: loaded.head.generation,
      headSeq: loaded.head.headSeq,
      materialization: materializeCardDocument(loaded.document),
    };
  } finally {
    loaded.document.destroy();
  }
};

const applyLatestSource = (
  database: Database.Database,
  job: LegacyCardShadowJob,
  source: LegacyCardSourceRow,
  document: LegacyCardDocumentRow,
): { readonly headSeq: number; readonly changed: boolean } => {
  const allocateBlockId = createDeterministicBlockIdAllocator(source, job);
  const storeEpoch = readStoreEpoch(database);

  if (document.readiness === "pending_genesis") {
    const genesis = createCardDocumentGenesis({
      documentId: job.documentId,
      title: source.title,
      nfm: source.description,
      allocateBlockId,
    });
    try {
      const ack = initializeCardDocumentGenesis(database, {
        documentId: job.documentId,
        storeEpoch,
        generation: document.generation,
        updateId: job.id,
        clientSessionId: SHADOW_PROCESSOR_SESSION_ID,
        update: genesis.update,
      });
      const persisted = loadPersistedMaterialization(database, job.documentId);
      assertContentParity(source, persisted.materialization);
      persistMaterialization(
        database,
        job.documentId,
        persisted.generation,
        persisted.headSeq,
        persisted.materialization,
      );
      return { headSeq: ack.headSeq, changed: true };
    } finally {
      genesis.document.destroy();
    }
  }

  const loaded = loadLegacyShadowBlockDocument(database, job.documentId);
  let translation: ReturnType<typeof translateLegacyNfmIntoCardDocument>;
  try {
    translation = translateLegacyNfmIntoCardDocument({
      document: loaded.document,
      authority: loaded.authority,
      readiness: "ready",
      title: source.title,
      nfm: source.description,
      allocateBlockId,
    });
  } finally {
    loaded.document.destroy();
  }

  let headSeq = document.head_seq;
  if (translation.changed) {
    const ack = applyLegacyShadowDocumentUpdate(database, {
      documentId: job.documentId,
      storeEpoch,
      generation: document.generation,
      updateId: job.id,
      clientSessionId: SHADOW_PROCESSOR_SESSION_ID,
      baseHeadSeq: document.head_seq,
      touchedBlockIds: [],
      update: translation.update,
    });
    headSeq = ack.headSeq;
  }

  const persisted = loadPersistedMaterialization(database, job.documentId);
  if (persisted.headSeq !== headSeq) {
    throw new LegacyCardShadowProcessorError(
      `Persisted Document ${job.documentId} head changed during shadow translation`,
    );
  }
  assertContentParity(source, persisted.materialization);
  persistMaterialization(
    database,
    job.documentId,
    persisted.generation,
    persisted.headSeq,
    persisted.materialization,
  );
  return { headSeq, changed: translation.changed };
};

const processClaimedJobTransaction = (
  database: Database.Database,
  job: LegacyCardShadowJob,
  claimToken: string,
): LegacyCardShadowProcessingResult => {
  assertClaimFence(database, job, claimToken);
  const head = readLegacyCardShadowHead(database, job.cardId);
  if (!head) {
    throw new LegacyCardShadowProcessorError(
      `Legacy shadow head for Card ${job.cardId} is missing`,
    );
  }
  if (head.lastEventSeq > job.sourceEventSeq) {
    markLegacyCardShadowJobSuperseded(database, job);
    return {
      jobId: job.id,
      cardId: job.cardId,
      sourceEventSeq: job.sourceEventSeq,
      outcome: "superseded",
      documentHeadSeq: null,
      documentChanged: false,
      error: null,
    };
  }
  if (
    head.lastEventSeq !== job.sourceEventSeq
    || head.sourceRevision !== job.sourceRevision
    || head.operation !== job.operation
  ) {
    throw new LegacyCardShadowProcessorError(
      `Legacy shadow head for Card ${job.cardId} does not match job ${job.id}`,
    );
  }

  const source = readCardSource(database, job.cardId);
  const document = readCardDocument(database, job.documentId);
  assertLatestSourceMatchesJob(job, source, document);
  if (job.operation === "delete") {
    markLegacyCardShadowJobApplied(database, job, document.head_seq);
    return {
      jobId: job.id,
      cardId: job.cardId,
      sourceEventSeq: job.sourceEventSeq,
      outcome: "applied",
      documentHeadSeq: document.head_seq,
      documentChanged: false,
      error: null,
    };
  }
  if (!source) {
    throw new LegacyCardShadowProcessorError(
      `Legacy source Card ${job.cardId} is missing`,
    );
  }

  const applied = applyLatestSource(database, job, source, document);
  markLegacyCardShadowJobApplied(database, job, applied.headSeq);
  return {
    jobId: job.id,
    cardId: job.cardId,
    sourceEventSeq: job.sourceEventSeq,
    outcome: "applied",
    documentHeadSeq: applied.headSeq,
    documentChanged: applied.changed,
    error: null,
  };
};

export const processClaimedLegacyCardShadowJob = (
  database: Database.Database,
  job: LegacyCardShadowJob,
): LegacyCardShadowProcessingResult => {
  const claimToken = requireClaimToken(job);
  const process = database.transaction(() =>
    processClaimedJobTransaction(database, job, claimToken),
  );
  try {
    return process.immediate();
  } catch (error) {
    const failure = toFailureMessage(error);
    try {
      markLegacyCardShadowJobFailed(database, job, failure);
    } catch (fenceError) {
      throw new LegacyCardShadowProcessorError(
        `Could not fail legacy shadow job ${job.id} after processing rollback`,
        { cause: fenceError },
      );
    }
    return {
      jobId: job.id,
      cardId: job.cardId,
      sourceEventSeq: job.sourceEventSeq,
      outcome: "failed",
      documentHeadSeq: null,
      documentChanged: false,
      error: failure,
    };
  }
};

export const drainLegacyCardShadowJobs = (
  database: Database.Database,
  options: DrainLegacyCardShadowJobsOptions = {},
): LegacyCardShadowDrainResult => {
  const maxJobs = assertPositiveInteger(
    options.maxJobs ?? DEFAULT_DRAIN_LIMIT,
    "maxJobs",
  );
  const results: LegacyCardShadowProcessingResult[] = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const job = claimNextLegacyCardShadowJob(database, {
      ...options.claim,
      claimToken: options.createClaimToken?.(index),
    });
    if (!job) return { exhausted: true, results };
    results.push(processClaimedLegacyCardShadowJob(database, job));
  }

  const remaining = database.prepare(`
    SELECT 1
    FROM legacy_card_shadow_jobs
    WHERE status = 'pending'
    LIMIT 1
  `).get();
  return { exhausted: remaining === undefined, results };
};

const countJobsByStatus = (
  database: Database.Database,
  status: "pending" | "processing" | "failed",
): number => {
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM legacy_card_shadow_jobs
    WHERE status = ?
  `).get(status) as { readonly count: number };
  return row.count;
};

const verifyCurrentCardParity = (
  database: Database.Database,
): {
  readonly currentCards: number;
  readonly readyDocuments: number;
  readonly allInParity: boolean;
} => {
  const cards = database.prepare(`
    SELECT id, project_id, title, description, revision, archived, created
    FROM cards
    ORDER BY id
  `).all() as readonly LegacyCardSourceRow[];
  let readyDocuments = 0;
  let allInParity = true;
  for (const card of cards) {
    const document = readCardDocument(database, `document:${card.id}`);
    if (
      document.readiness !== "ready"
      || document.authority !== "legacy_shadow"
    ) {
      allInParity = false;
      continue;
    }
    readyDocuments += 1;
    const loaded = loadPersistedMaterialization(database, document.document_id);
    try {
      assertContentParity(card, loaded.materialization);
    } catch {
      allInParity = false;
      continue;
    }
    const projection = database.prepare(`
      SELECT generation, projected_seq, nfm
      FROM document_materializations
      WHERE document_id = ?
    `).get(document.document_id) as
      | { readonly generation: number; readonly projected_seq: number; readonly nfm: string }
      | undefined;
    if (
      projection?.generation !== loaded.generation
      || projection.projected_seq !== loaded.headSeq
      || projection.nfm !== loaded.materialization.nfm
    ) {
      allInParity = false;
    }
  }
  return {
    currentCards: cards.length,
    readyDocuments,
    allInParity,
  };
};

/** Runtime-friendly probe used by the Electron SQLite harness. */
export const runLegacyCardShadowProcessorProbe = (
  database: Database.Database,
  maxJobs = 10_000,
): LegacyCardShadowProcessorProbeResult => {
  const drain = drainLegacyCardShadowJobs(database, { maxJobs });
  const parity = verifyCurrentCardParity(database);
  const appliedJobs = drain.results.filter(
    (result) => result.outcome === "applied",
  ).length;
  const supersededJobs = drain.results.filter(
    (result) => result.outcome === "superseded",
  ).length;
  const failedJobs = countJobsByStatus(database, "failed");
  const pendingJobs = countJobsByStatus(database, "pending");
  const processingJobs = countJobsByStatus(database, "processing");
  return {
    processedJobs: drain.results.length,
    appliedJobs,
    supersededJobs,
    failedJobs,
    pendingJobs,
    processingJobs,
    currentCards: parity.currentCards,
    readyCurrentCardDocuments: parity.readyDocuments,
    allCurrentCardsReady:
      drain.exhausted
      && failedJobs === 0
      && pendingJobs === 0
      && processingJobs === 0
      && parity.readyDocuments === parity.currentCards,
    allCurrentCardContentInParity: parity.allInParity,
  };
};
