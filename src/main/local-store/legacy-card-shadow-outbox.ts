import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type LegacyCardShadowOperation = "insert" | "update" | "delete";
export type LegacyCardShadowJobStatus =
  | "pending"
  | "processing"
  | "applied"
  | "superseded"
  | "failed";

export interface LegacyCardShadowJob {
  readonly id: string;
  readonly cardId: string;
  readonly sourceEventSeq: number;
  readonly projectId: string;
  readonly previousProjectId: string | null;
  readonly documentId: string;
  readonly expectedDocumentGeneration: number;
  readonly expectedDocumentHeadSeq: number;
  readonly expectedDocumentReadiness: "pending_genesis" | "ready" | "failed";
  readonly expectedDocumentAuthority: "legacy_shadow";
  readonly sourceRevision: number;
  readonly operation: LegacyCardShadowOperation;
  readonly status: LegacyCardShadowJobStatus;
  readonly attemptCount: number;
  readonly claimToken: string | null;
  readonly claimExpiresAt: string | null;
}

interface LegacyCardShadowJobRow {
  readonly id: string;
  readonly card_id: string;
  readonly source_event_seq: number;
  readonly project_id: string;
  readonly previous_project_id: string | null;
  readonly document_id: string;
  readonly expected_document_generation: number;
  readonly expected_document_head_seq: number;
  readonly expected_document_readiness: "pending_genesis" | "ready" | "failed";
  readonly expected_document_authority: "legacy_shadow";
  readonly source_revision: number;
  readonly operation: LegacyCardShadowOperation;
  readonly status: LegacyCardShadowJobStatus;
  readonly attempt_count: number;
  readonly claim_token: string | null;
  readonly claim_expires_at: string | null;
}

export interface ClaimLegacyCardShadowJobOptions {
  readonly claimToken?: string;
  readonly now?: Date;
  readonly leaseMs?: number;
}

export class LegacyCardShadowOutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyCardShadowOutboxError";
  }
}

const readPositiveInteger = (value: number, field: string): number => {
  if (Number.isInteger(value) && value > 0) return value;
  throw new LegacyCardShadowOutboxError(`${field} must be a positive integer`);
};

const requireIdentity = (value: string, field: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new LegacyCardShadowOutboxError(`${field} must be non-empty`);
};

const toJob = (row: LegacyCardShadowJobRow): LegacyCardShadowJob => ({
  id: row.id,
  cardId: row.card_id,
  sourceEventSeq: row.source_event_seq,
  projectId: row.project_id,
  previousProjectId: row.previous_project_id,
  documentId: row.document_id,
  expectedDocumentGeneration: row.expected_document_generation,
  expectedDocumentHeadSeq: row.expected_document_head_seq,
  expectedDocumentReadiness: row.expected_document_readiness,
  expectedDocumentAuthority: row.expected_document_authority,
  sourceRevision: row.source_revision,
  operation: row.operation,
  status: row.status,
  attemptCount: row.attempt_count,
  claimToken: row.claim_token,
  claimExpiresAt: row.claim_expires_at,
});

const SELECT_JOB_COLUMNS = `
  id, card_id, source_event_seq, project_id, previous_project_id,
  document_id, expected_document_generation, expected_document_head_seq,
  expected_document_readiness, expected_document_authority,
  source_revision, operation, status, attempt_count,
  claim_token, claim_expires_at
`;

export const claimNextLegacyCardShadowJob = (
  database: Database.Database,
  options: ClaimLegacyCardShadowJobOptions = {},
): LegacyCardShadowJob | null => {
  const claimToken = requireIdentity(
    options.claimToken ?? `legacy-shadow-claim:${randomUUID()}`,
    "claimToken",
  );
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new LegacyCardShadowOutboxError("now must be a valid Date");
  }
  const leaseMs = readPositiveInteger(options.leaseMs ?? 30_000, "leaseMs");
  const claimedAt = now.toISOString();
  const claimExpiresAt = new Date(now.getTime() + leaseMs).toISOString();

  const claim = database.transaction((): LegacyCardShadowJob | null => {
    database.prepare(`
      UPDATE legacy_card_shadow_jobs
      SET status = 'pending', claim_token = NULL, claimed_at = NULL,
          claim_expires_at = NULL, updated_at = ?
      WHERE status = 'processing' AND claim_expires_at <= ?
    `).run(claimedAt, claimedAt);

    const candidate = database.prepare(`
      SELECT ${SELECT_JOB_COLUMNS}
      FROM legacy_card_shadow_jobs job
      WHERE job.status = 'pending'
        AND NOT EXISTS (
          SELECT 1
          FROM legacy_card_shadow_jobs predecessor
          WHERE predecessor.card_id = job.card_id
            AND predecessor.source_event_seq < job.source_event_seq
            AND predecessor.status NOT IN ('applied', 'superseded')
        )
      ORDER BY job.enqueued_at ASC, job.card_id ASC, job.source_event_seq ASC
      LIMIT 1
    `).get() as LegacyCardShadowJobRow | undefined;
    if (!candidate) return null;

    const update = database.prepare(`
      UPDATE legacy_card_shadow_jobs
      SET status = 'processing', claim_token = ?, claimed_at = ?,
          claim_expires_at = ?, attempt_count = attempt_count + 1,
          updated_at = ?
      WHERE id = ? AND status = 'pending'
        AND NOT EXISTS (
          SELECT 1
          FROM legacy_card_shadow_jobs active
          WHERE active.card_id = legacy_card_shadow_jobs.card_id
            AND active.status = 'processing'
        )
    `).run(
      claimToken,
      claimedAt,
      claimExpiresAt,
      claimedAt,
      candidate.id,
    );
    if (update.changes !== 1) return null;

    const claimed = database.prepare(`
      SELECT ${SELECT_JOB_COLUMNS}
      FROM legacy_card_shadow_jobs
      WHERE id = ?
    `).get(candidate.id) as LegacyCardShadowJobRow | undefined;
    if (!claimed) {
      throw new LegacyCardShadowOutboxError(
        `Claimed legacy shadow job disappeared: ${candidate.id}`,
      );
    }
    return toJob(claimed);
  });
  return claim.immediate();
};

const finishClaimedJob = (
  database: Database.Database,
  input: {
    readonly jobId: string;
    readonly claimToken: string;
    readonly status: "applied" | "superseded" | "failed";
    readonly appliedDocumentHeadSeq?: number;
    readonly error?: string;
    readonly now?: Date;
  },
): void => {
  const jobId = requireIdentity(input.jobId, "jobId");
  const claimToken = requireIdentity(input.claimToken, "claimToken");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new LegacyCardShadowOutboxError("now must be a valid Date");
  }
  if (
    input.status === "applied" &&
    (!Number.isInteger(input.appliedDocumentHeadSeq) ||
      (input.appliedDocumentHeadSeq ?? -1) < 0)
  ) {
    throw new LegacyCardShadowOutboxError(
      "Applied jobs require a non-negative Document head",
    );
  }
  if (input.status === "failed" && !input.error?.trim()) {
    throw new LegacyCardShadowOutboxError("Failed jobs require an error");
  }

  const timestamp = now.toISOString();
  const result = database.prepare(`
    UPDATE legacy_card_shadow_jobs
    SET status = ?, claim_token = NULL, claimed_at = NULL,
        claim_expires_at = NULL, applied_document_head_seq = ?,
        last_error = ?, completed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'processing' AND claim_token = ?
  `).run(
    input.status,
    input.status === "applied" ? input.appliedDocumentHeadSeq : null,
    input.status === "failed" ? input.error?.trim() : null,
    timestamp,
    timestamp,
    jobId,
    claimToken,
  );
  if (result.changes === 1) return;
  throw new LegacyCardShadowOutboxError(
    `Legacy shadow job ${jobId} is not owned by claim ${claimToken}`,
  );
};

export const markLegacyCardShadowJobApplied = (
  database: Database.Database,
  job: Pick<LegacyCardShadowJob, "id" | "claimToken">,
  appliedDocumentHeadSeq: number,
): void => {
  if (!job.claimToken) {
    throw new LegacyCardShadowOutboxError("Applied job has no claim token");
  }
  finishClaimedJob(database, {
    jobId: job.id,
    claimToken: job.claimToken,
    status: "applied",
    appliedDocumentHeadSeq,
  });
};

export const markLegacyCardShadowJobSuperseded = (
  database: Database.Database,
  job: Pick<LegacyCardShadowJob, "id" | "claimToken">,
): void => {
  if (!job.claimToken) {
    throw new LegacyCardShadowOutboxError("Superseded job has no claim token");
  }
  finishClaimedJob(database, {
    jobId: job.id,
    claimToken: job.claimToken,
    status: "superseded",
  });
};

export const markLegacyCardShadowJobFailed = (
  database: Database.Database,
  job: Pick<LegacyCardShadowJob, "id" | "claimToken">,
  error: string,
): void => {
  if (!job.claimToken) {
    throw new LegacyCardShadowOutboxError("Failed job has no claim token");
  }
  finishClaimedJob(database, {
    jobId: job.id,
    claimToken: job.claimToken,
    status: "failed",
    error,
  });
};

export const readLegacyCardShadowHead = (
  database: Database.Database,
  cardId: string,
): {
  readonly lastEventSeq: number;
  readonly sourceRevision: number;
  readonly operation: LegacyCardShadowOperation;
} | null => {
  const row = database.prepare(`
    SELECT last_event_seq, last_source_revision, last_operation
    FROM legacy_card_shadow_heads
    WHERE card_id = ?
  `).get(requireIdentity(cardId, "cardId")) as
    | {
        readonly last_event_seq: number;
        readonly last_source_revision: number;
        readonly last_operation: LegacyCardShadowOperation;
      }
    | undefined;
  return row
    ? {
        lastEventSeq: row.last_event_seq,
        sourceRevision: row.last_source_revision,
        operation: row.last_operation,
      }
    : null;
};
