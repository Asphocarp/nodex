import type Database from "better-sqlite3";
import {
  BLOCK_RETENTION_GC_POLICY_VERSION,
  planBlockRetentionGc,
  type BlockRetentionGcBlockerKind,
  type BlockRetentionGcCandidate,
  type BlockRetentionGcPlan,
  type BlockRetentionGcPolicy,
} from "./block-retention-gc";

export const BLOCK_RETENTION_MAINTENANCE_VERSION = 1 as const;

export type BlockRetentionMaintenanceFaultPoint =
  | "after_evidence_prune"
  | "after_replan"
  | "after_identity_retirement"
  | "after_ownership_delete"
  | "after_block_delete"
  | "after_document_delete"
  | "before_candidate_commit";

export interface MaintainBlockRetentionInput {
  readonly projectId: string;
  /** Optional exact roots for operator recovery; ordinary passes use policy selection. */
  readonly rootBlockIds?: readonly string[];
  readonly policy?: Partial<BlockRetentionGcPolicy>;
}

export interface BlockRetentionEvidenceDisposition {
  /** Physical history rows whose owning Document is being collected. */
  readonly prunedDocumentVersionIds: readonly string[];
  /** Resolved/discarded recovery rows wholly owned by the collected closure. */
  readonly prunedRecoveryArtifactIds: readonly string[];
  /** Immutable receipts retained byte-for-byte after their reachability expires. */
  readonly releasedBlockMutationIds: readonly string[];
  /** Immutable audit rows retained byte-for-byte after their reachability expires. */
  readonly releasedChangeLogSeqs: readonly number[];
}

export type BlockRetentionMaintenanceCandidateResult =
  | {
      readonly status: "collected";
      readonly rootBlockId: string;
      readonly retiredBlockIds: readonly string[];
      readonly deletedBlockIds: readonly string[];
      readonly deletedDocumentIds: readonly string[];
      readonly evidence: BlockRetentionEvidenceDisposition;
    }
  | {
      /** This selected descendant was collected with an earlier/later owner root. */
      readonly status: "covered";
      readonly rootBlockId: string;
      readonly collectedByRootBlockId: string;
    }
  | {
      readonly status: "retained";
      readonly rootBlockId: string;
      readonly reason:
        | "reachability_blocked"
        | "unsafe_retained_evidence"
        | "post_prune_replan_blocked";
      readonly candidate: BlockRetentionGcCandidate;
    }
  | {
      readonly status: "failed";
      readonly rootBlockId: string;
      readonly code: "transaction_failed";
      readonly message: string;
    };

export interface BlockRetentionMaintenanceResult {
  readonly version: typeof BLOCK_RETENTION_MAINTENANCE_VERSION;
  readonly policyVersion: typeof BLOCK_RETENTION_GC_POLICY_VERSION;
  readonly projectId: string;
  readonly policy: BlockRetentionGcPolicy;
  readonly deletedBlockCount: number;
  readonly retainedNewestBlockIds: readonly string[];
  readonly selectedRootBlockIds: readonly string[];
  readonly candidates: readonly BlockRetentionMaintenanceCandidateResult[];
}

export interface MaintainBlockRetentionOptions {
  readonly now?: () => string;
  readonly faultInjector?: (
    point: BlockRetentionMaintenanceFaultPoint,
    rootBlockId: string,
  ) => void;
}

interface RecoveryArtifactRow {
  readonly id: string;
  readonly project_id: string;
  readonly document_id: string;
  readonly status: "pending" | "resolved" | "discarded";
  readonly touched_block_ids_json: string;
  readonly derived_touched_block_ids_json: string | null;
}

interface ImmutableAttributionRow {
  readonly identity: string;
  readonly project_id: string;
  readonly block_ids_json: string;
  readonly document_ids_json: string;
  readonly database_block_ids_json: string;
}

interface EvidencePlan {
  readonly documentVersionIds: readonly string[];
  readonly recoveryArtifactIds: readonly string[];
  readonly mutationIds: readonly string[];
  readonly changeLogSeqs: readonly number[];
}

const INITIAL_PRUNABLE_BLOCKERS = new Set<BlockRetentionGcBlockerKind>([
  "retained_recovery_artifact",
  "retained_document_version",
  "retained_block_mutation",
  "retained_change_log",
]);

const RELEASED_HISTORY_BLOCKERS = new Set<BlockRetentionGcBlockerKind>([
  "retained_block_mutation",
  "retained_change_log",
]);

const MAX_ID_LENGTH = 512;

class RetainCandidate extends Error {
  readonly reason: Extract<
    BlockRetentionMaintenanceCandidateResult,
    { readonly status: "retained" }
  >["reason"];
  readonly candidate: BlockRetentionGcCandidate;

  constructor(
    reason: RetainCandidate["reason"],
    candidate: BlockRetentionGcCandidate,
  ) {
    super(`Block retention candidate ${candidate.rootBlockId} remains retained`);
    this.name = "RetainCandidate";
    this.reason = reason;
    this.candidate = candidate;
  }
}

const placeholders = (count: number): string =>
  Array.from({ length: count }, () => "?").join(", ");

const requireIdentity = (value: unknown, label: string): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value !== value.trim()
  ) {
    throw new TypeError(`${label} contains an invalid identity`);
  }
  return value;
};

const requireCanonicalTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("retiredAt must be a canonical ISO timestamp");
  }
  return value;
};

const readIdentityArray = (
  serialized: string,
  label: string,
): readonly string[] => {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new TypeError(`${label} is invalid JSON`, { cause: error });
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} is not an array`);
  }
  const identities = value.map((entry) => requireIdentity(entry, label));
  if (new Set(identities).size !== identities.length) {
    throw new TypeError(`${label} contains duplicate identities`);
  }
  return identities;
};

const readImmutableIdentitySet = (
  serialized: string,
  label: string,
): readonly string[] => {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new TypeError(`${label} is invalid JSON`, { cause: error });
  }
  if (!Array.isArray(value)) throw new TypeError(`${label} is not an array`);
  return [
    ...new Set(value.map((entry) => requireIdentity(entry, label))),
  ];
};

const intersects = (
  values: readonly string[],
  identities: ReadonlySet<string>,
): boolean => values.some((value) => identities.has(value));

const hasOnlyBlockers = (
  candidate: BlockRetentionGcCandidate,
  allowed: ReadonlySet<BlockRetentionGcBlockerKind>,
): boolean => candidate.blockers.every((blocker) => allowed.has(blocker.kind));

const readCandidate = (
  database: Database.Database,
  projectId: string,
  rootBlockId: string,
  policy: BlockRetentionGcPolicy,
): BlockRetentionGcCandidate => {
  const candidate = planBlockRetentionGc(database, {
    projectId,
    rootBlockIds: [rootBlockId],
    policy,
  }).candidates[0];
  if (!candidate) {
    throw new Error(`Retention planner omitted ${rootBlockId}`);
  }
  return candidate;
};

const readPrunableDocumentVersions = (
  database: Database.Database,
  candidate: BlockRetentionGcCandidate,
): readonly string[] => {
  if (candidate.ownedDocumentIds.length === 0) return [];
  return (
    database
      .prepare(
        `SELECT version_id
         FROM document_versions
         WHERE project_id = ?
           AND document_id IN (${placeholders(candidate.ownedDocumentIds.length)})
         ORDER BY version_id`,
      )
      .all(candidate.projectId, ...candidate.ownedDocumentIds) as readonly {
      readonly version_id: string;
    }[]
  ).map((row) => row.version_id);
};

const readPrunableRecoveryArtifacts = (
  database: Database.Database,
  candidate: BlockRetentionGcCandidate,
): readonly string[] | null => {
  const blockIds = new Set(candidate.closureBlockIds);
  const documentIds = new Set(candidate.ownedDocumentIds);
  const rows = database
    .prepare(
      `SELECT id, project_id, document_id, status,
         touched_block_ids_json, derived_touched_block_ids_json
       FROM document_recovery_artifacts
       ORDER BY project_id, id`,
    )
    .all() as readonly RecoveryArtifactRow[];
  const prunable: string[] = [];
  for (const row of rows) {
    let touched: readonly string[];
    let derived: readonly string[];
    try {
      touched = readIdentityArray(
        row.touched_block_ids_json,
        `Recovery artifact ${row.id} touched Block IDs`,
      );
      derived = row.derived_touched_block_ids_json
        ? readIdentityArray(
            row.derived_touched_block_ids_json,
            `Recovery artifact ${row.id} derived Block IDs`,
          )
        : [];
    } catch {
      return null;
    }
    const touchesClosure =
      documentIds.has(row.document_id) ||
      intersects(touched, blockIds) ||
      intersects(derived, blockIds);
    if (!touchesClosure) continue;
    if (
      row.project_id !== candidate.projectId ||
      row.status === "pending" ||
      !documentIds.has(row.document_id) ||
      touched.some((blockId) => !blockIds.has(blockId)) ||
      derived.some((blockId) => !blockIds.has(blockId))
    ) {
      return null;
    }
    prunable.push(row.id);
  }
  return prunable;
};

const readImmutableAttributionRows = (
  database: Database.Database,
  table: "block_mutations" | "change_log",
): readonly ImmutableAttributionRow[] => {
  if (table === "block_mutations") {
    return database
      .prepare(
        `SELECT mutation_id AS identity, project_id,
           target_block_ids_json AS block_ids_json,
           affected_document_ids_json AS document_ids_json,
           affected_database_block_ids_json AS database_block_ids_json
         FROM block_mutations
         ORDER BY project_id, mutation_id`,
      )
      .all() as readonly ImmutableAttributionRow[];
  }
  return database
    .prepare(
      `SELECT CAST(seq AS TEXT) AS identity, project_id,
         block_ids_json, document_ids_json, database_block_ids_json
       FROM change_log
       ORDER BY project_id, seq`,
    )
    .all() as readonly ImmutableAttributionRow[];
};

const readReleasedImmutableAttribution = (
  database: Database.Database,
  candidate: BlockRetentionGcCandidate,
  table: "block_mutations" | "change_log",
): readonly string[] | null => {
  const blockIds = new Set(candidate.closureBlockIds);
  const documentIds = new Set(candidate.ownedDocumentIds);
  const released: string[] = [];
  for (const row of readImmutableAttributionRows(database, table)) {
    let blocks: readonly string[];
    let documents: readonly string[];
    let databases: readonly string[];
    try {
      blocks = readImmutableIdentitySet(
        row.block_ids_json,
        `${table} ${row.identity} Block IDs`,
      );
      documents = readImmutableIdentitySet(
        row.document_ids_json,
        `${table} ${row.identity} Document IDs`,
      );
      databases = readImmutableIdentitySet(
        row.database_block_ids_json,
        `${table} ${row.identity} Database IDs`,
      );
    } catch {
      return null;
    }
    const externalDatabaseIds = new Set(
      databases.filter((databaseBlockId) => !blockIds.has(databaseBlockId)),
    );
    const authorityBlocks = blocks.filter(
      (blockId) => !externalDatabaseIds.has(blockId),
    );
    const relevant =
      intersects(authorityBlocks, blockIds) ||
      intersects(documents, documentIds) ||
      intersects(databases, blockIds);
    if (!relevant) continue;
    if (row.project_id !== candidate.projectId) {
      return null;
    }
    released.push(row.identity);
  }
  return released;
};

const readEvidencePlan = (
  database: Database.Database,
  candidate: BlockRetentionGcCandidate,
): EvidencePlan | null => {
  const recoveryArtifactIds = readPrunableRecoveryArtifacts(
    database,
    candidate,
  );
  if (!recoveryArtifactIds) return null;
  const mutationIds = readReleasedImmutableAttribution(
    database,
    candidate,
    "block_mutations",
  );
  if (!mutationIds) return null;
  const changeLogSeqStrings = readReleasedImmutableAttribution(
    database,
    candidate,
    "change_log",
  );
  if (!changeLogSeqStrings) return null;
  const changeLogSeqs = changeLogSeqStrings.map((value) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new TypeError(`Change log sequence is invalid: ${value}`);
    }
    return parsed;
  });
  return {
    documentVersionIds: readPrunableDocumentVersions(database, candidate),
    recoveryArtifactIds,
    mutationIds,
    changeLogSeqs,
  };
};

const deleteExactRows = (
  database: Database.Database,
  table: "document_versions" | "document_recovery_artifacts",
  identityColumn: "version_id" | "id",
  identities: readonly string[],
): void => {
  if (identities.length === 0) return;
  const deleted = database
    .prepare(
      `DELETE FROM ${table}
       WHERE ${identityColumn} IN (${placeholders(identities.length)})`,
    )
    .run(...identities);
  if (deleted.changes !== identities.length) {
    throw new Error(`${table} changed while pruning retention evidence`);
  }
};

const assertReleasedHistoryMatchesPlan = (
  candidate: BlockRetentionGcCandidate,
  evidence: EvidencePlan,
): void => {
  if (!hasOnlyBlockers(candidate, RELEASED_HISTORY_BLOCKERS)) {
    throw new RetainCandidate("post_prune_replan_blocked", candidate);
  }
  const blockerKinds = new Set(candidate.blockers.map((blocker) => blocker.kind));
  if (
    (blockerKinds.has("retained_block_mutation") &&
      evidence.mutationIds.length === 0) ||
    (blockerKinds.has("retained_change_log") &&
      evidence.changeLogSeqs.length === 0)
  ) {
    throw new RetainCandidate("post_prune_replan_blocked", candidate);
  }
};

const collectCandidateClosure = (
  database: Database.Database,
  candidate: BlockRetentionGcCandidate,
  options: MaintainBlockRetentionOptions,
): {
  readonly retiredBlockIds: readonly string[];
  readonly deletedBlockIds: readonly string[];
  readonly deletedDocumentIds: readonly string[];
} => {
  const blockIds = [...candidate.closureBlockIds].sort();
  const documentIds = [...candidate.ownedDocumentIds].sort();
  if (blockIds.length === 0) {
    throw new Error("Retention candidate has an empty Block closure");
  }
  const retiredAt = requireCanonicalTimestamp(
    options.now?.() ?? new Date().toISOString(),
  );
  const retired = database
    .prepare(
      `INSERT INTO retired_block_identities (
         block_id, project_id, block_type, retention_root_block_id, retired_at
       )
       SELECT id, project_id, type, ?, ?
       FROM blocks
       WHERE project_id = ? AND lifecycle = 'deleted'
         AND id IN (${placeholders(blockIds.length)})`,
    )
    .run(
      candidate.rootBlockId,
      retiredAt,
      candidate.projectId,
      ...blockIds,
    );
  if (retired.changes !== blockIds.length) {
    throw new Error("Retention Block identities changed before retirement");
  }
  options.faultInjector?.("after_identity_retirement", candidate.rootBlockId);
  if (documentIds.length > 0) {
    const ownerships = database
      .prepare(
        `DELETE FROM block_documents
         WHERE project_id = ?
           AND block_id IN (${placeholders(blockIds.length)})
           AND document_id IN (${placeholders(documentIds.length)})`,
      )
      .run(candidate.projectId, ...blockIds, ...documentIds);
    if (ownerships.changes !== documentIds.length) {
      throw new Error("Retention ownership topology changed during collection");
    }
  }
  options.faultInjector?.("after_ownership_delete", candidate.rootBlockId);
  const blocks = database
    .prepare(
      `DELETE FROM blocks
       WHERE project_id = ? AND lifecycle = 'deleted'
         AND id IN (${placeholders(blockIds.length)})`,
    )
    .run(candidate.projectId, ...blockIds);
  if (blocks.changes !== blockIds.length) {
    throw new Error("Retention Block closure changed during collection");
  }
  options.faultInjector?.("after_block_delete", candidate.rootBlockId);
  if (documentIds.length > 0) {
    const documents = database
      .prepare(
        `DELETE FROM documents
         WHERE project_id = ? AND id IN (${placeholders(documentIds.length)})`,
      )
      .run(candidate.projectId, ...documentIds);
    if (documents.changes !== documentIds.length) {
      throw new Error("Retention Document closure changed during collection");
    }
  }
  options.faultInjector?.("after_document_delete", candidate.rootBlockId);
  return {
    retiredBlockIds: blockIds,
    deletedBlockIds: blockIds,
    deletedDocumentIds: documentIds,
  };
};

const maintainCandidate = (
  database: Database.Database,
  projectId: string,
  rootBlockId: string,
  policy: BlockRetentionGcPolicy,
  options: MaintainBlockRetentionOptions,
): BlockRetentionMaintenanceCandidateResult => {
  try {
    return database
      .transaction((): BlockRetentionMaintenanceCandidateResult => {
        const initial = readCandidate(database, projectId, rootBlockId, policy);
        if (
          !initial.collectible &&
          !hasOnlyBlockers(initial, INITIAL_PRUNABLE_BLOCKERS)
        ) {
          return {
            status: "retained",
            rootBlockId,
            reason: "reachability_blocked",
            candidate: initial,
          };
        }
        const evidence = readEvidencePlan(database, initial);
        if (!evidence) {
          return {
            status: "retained",
            rootBlockId,
            reason: "unsafe_retained_evidence",
            candidate: initial,
          };
        }
        deleteExactRows(
          database,
          "document_recovery_artifacts",
          "id",
          evidence.recoveryArtifactIds,
        );
        deleteExactRows(
          database,
          "document_versions",
          "version_id",
          evidence.documentVersionIds,
        );
        options.faultInjector?.("after_evidence_prune", rootBlockId);

        const replanned = readCandidate(database, projectId, rootBlockId, policy);
        assertReleasedHistoryMatchesPlan(replanned, evidence);
        options.faultInjector?.("after_replan", rootBlockId);
        const deleted = collectCandidateClosure(database, replanned, options);
        options.faultInjector?.("before_candidate_commit", rootBlockId);
        return {
          status: "collected",
          rootBlockId,
          ...deleted,
          evidence: {
            prunedDocumentVersionIds: evidence.documentVersionIds,
            prunedRecoveryArtifactIds: evidence.recoveryArtifactIds,
            releasedBlockMutationIds: evidence.mutationIds,
            releasedChangeLogSeqs: evidence.changeLogSeqs,
          },
        };
      })
      .immediate();
  } catch (error) {
    if (error instanceof RetainCandidate) {
      return {
        status: "retained",
        rootBlockId,
        reason: error.reason,
        candidate: error.candidate,
      };
    }
    return {
      status: "failed",
      rootBlockId,
      code: "transaction_failed",
      message:
        "Block retention maintenance failed and rolled the candidate back",
    };
  }
};

/**
 * Applies the newest-N tombstone policy one root at a time. Every candidate is
 * its own IMMEDIATE transaction: attributable expiring evidence and the Block
 * closure commit together, or both remain untouched. A compact global retired
 * identity is inserted before each physical Block delete, so application IDs
 * remain non-reusable after collection. Immutable mutation and change rows are
 * never rewritten or deleted, so exact retry and audit replay remain valid.
 */
export const maintainBlockRetention = (
  database: Database.Database,
  input: MaintainBlockRetentionInput,
  options: MaintainBlockRetentionOptions = {},
): BlockRetentionMaintenanceResult => {
  const initialPlan: BlockRetentionGcPlan = planBlockRetentionGc(database, {
    projectId: input.projectId,
    ...(input.rootBlockIds ? { rootBlockIds: input.rootBlockIds } : {}),
    policy: input.policy,
  });
  const selectedRootBlockIds = initialPlan.candidates.map(
    (candidate) => candidate.rootBlockId,
  );
  const candidates: BlockRetentionMaintenanceCandidateResult[] = [];
  const collectedByBlockId = new Map<string, string>();
  for (const rootBlockId of selectedRootBlockIds) {
    const collectedByRootBlockId = collectedByBlockId.get(rootBlockId);
    if (collectedByRootBlockId) {
      candidates.push({
        status: "covered",
        rootBlockId,
        collectedByRootBlockId,
      });
      continue;
    }
    const candidate = maintainCandidate(
      database,
      initialPlan.projectId,
      rootBlockId,
      initialPlan.policy,
      options,
    );
    candidates.push(candidate);
    if (candidate.status !== "collected") continue;
    for (const deletedBlockId of candidate.deletedBlockIds) {
      collectedByBlockId.set(deletedBlockId, rootBlockId);
    }
    for (const [index, previous] of candidates.entries()) {
      if (
        previous.rootBlockId === rootBlockId ||
        !candidate.deletedBlockIds.includes(previous.rootBlockId) ||
        previous.status === "collected"
      ) {
        continue;
      }
      candidates[index] = {
        status: "covered",
        rootBlockId: previous.rootBlockId,
        collectedByRootBlockId: rootBlockId,
      };
    }
  }
  return {
    version: BLOCK_RETENTION_MAINTENANCE_VERSION,
    policyVersion: BLOCK_RETENTION_GC_POLICY_VERSION,
    projectId: initialPlan.projectId,
    policy: initialPlan.policy,
    deletedBlockCount: initialPlan.deletedBlockCount,
    retainedNewestBlockIds: initialPlan.retainedNewestBlockIds,
    selectedRootBlockIds,
    candidates,
  };
};
