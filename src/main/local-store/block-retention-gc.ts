import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import {
  getOwnedDocumentSchemaRegistration,
  getOwnedDocumentSchemaRegistrationForSchema,
  getRegisteredBlockDocumentSchemaAdapter,
  inspectRegisteredOwnedBlockDocument,
  listBlockDocumentSchemaAdapters,
  type RegisteredBlockDocumentSchemaAdapter,
} from "../../shared/block-documents/document-schema-adapters";
import { parsePortableCanvasScene } from "../../shared/block-documents/canvas-scene";
import { MAX_CARD_DOCUMENT_STATE_BYTES } from "../../shared/block-documents/contracts";
import type { BlockDocumentReference } from "../../shared/block-documents/derived-records";
import { parseProjectSessionTabConfig } from "../../shared/schemas/project-sessions";
import { readCanvasSceneAuthoritySnapshot } from "./canvas-scene-authority-reader";

export const BLOCK_RETENTION_GC_POLICY_VERSION = 1 as const;

export interface BlockRetentionGcPolicy {
  readonly version: typeof BLOCK_RETENTION_GC_POLICY_VERSION;
  /** Tombstones remain restorable until they fall outside this newest-N set. */
  readonly retainNewestDeletedBlocks: number;
  readonly maxCandidates: number;
  readonly maxEvidenceSamplesPerBlocker: number;
  /** A larger retained history must be compacted/indexed before GC can prove reachability. */
  readonly maxRetainedDocumentVersionsToInspect: number;
}

export const DEFAULT_BLOCK_RETENTION_GC_POLICY: BlockRetentionGcPolicy = {
  version: BLOCK_RETENTION_GC_POLICY_VERSION,
  retainNewestDeletedBlocks: 10_000,
  maxCandidates: 100,
  maxEvidenceSamplesPerBlocker: 8,
  maxRetainedDocumentVersionsToInspect: 10_000,
};

export type BlockRetentionGcBlockerKind =
  | "policy_newest_tombstone"
  | "block_not_found"
  | "block_not_deleted"
  | "project_scope_mismatch"
  | "ownership_corrupt"
  | "live_contained_block"
  | "top_level_placement"
  | "projection_unverifiable"
  | "current_document_content"
  | "block_tree_reference"
  | "database_view_reference"
  | "canvas_card_reference"
  | "pending_recovery_artifact"
  | "retained_recovery_artifact"
  | "retained_document_version"
  | "retained_block_mutation"
  | "retained_change_log"
  | "retained_relocation"
  | "active_database_membership"
  | "database_view_position"
  | "active_database_dependent"
  | "session_target"
  | "session_state_corrupt"
  | "card_behavior_evidence"
  | "store_foreign_key_corrupt"
  | "unclassified_foreign_key_root";

export interface BlockRetentionGcEvidence {
  readonly source: string;
  readonly identity: string;
  readonly relation: string;
  readonly status?: string;
  readonly documentId?: string;
}

export interface BlockRetentionGcBlocker {
  readonly kind: BlockRetentionGcBlockerKind;
  readonly count: number;
  readonly samples: readonly BlockRetentionGcEvidence[];
}

export interface BlockRetentionGcCandidate {
  readonly rootBlockId: string;
  readonly projectId: string;
  readonly blockType: string | null;
  readonly deletedAt: string | null;
  readonly closureBlockIds: readonly string[];
  readonly ownedDocumentIds: readonly string[];
  readonly collectible: boolean;
  readonly blockers: readonly BlockRetentionGcBlocker[];
}

export interface BlockRetentionGcPlan {
  readonly version: typeof BLOCK_RETENTION_GC_POLICY_VERSION;
  readonly projectId: string;
  readonly policy: BlockRetentionGcPolicy;
  readonly deletedBlockCount: number;
  readonly retainedNewestBlockIds: readonly string[];
  readonly candidates: readonly BlockRetentionGcCandidate[];
}

export interface PlanBlockRetentionGcInput {
  readonly projectId: string;
  readonly rootBlockIds?: readonly string[];
  readonly policy?: Partial<BlockRetentionGcPolicy>;
}

interface BlockRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly updated_at: string;
}

interface OwnedDocumentRow {
  readonly block_id: string;
  readonly document_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly readiness: string;
  readonly authority: string;
}

interface BlockDocumentOwnershipRow {
  readonly block_id: string;
  readonly document_id: string;
  readonly project_id: string;
}

interface GcClosure {
  readonly blockIds: Set<string>;
  readonly documentIds: Set<string>;
  readonly ownerBlockIds: Set<string>;
}

interface BlockerCollector {
  readonly add: (
    kind: BlockRetentionGcBlockerKind,
    evidence: BlockRetentionGcEvidence,
  ) => void;
  readonly addAggregate: (
    kind: BlockRetentionGcBlockerKind,
    count: number,
    evidence: BlockRetentionGcEvidence,
  ) => void;
  readonly finish: () => readonly BlockRetentionGcBlocker[];
}

const MAX_RETAINED_TOMBSTONES = 100_000;
const MAX_GC_CANDIDATES = 1_000;
const MAX_EVIDENCE_SAMPLES = 100;
const MAX_RETAINED_DOCUMENT_VERSIONS_TO_INSPECT = 100_000;
const MAX_ID_LENGTH = 512;

const KNOWN_INBOUND_AUTHORITY_TABLES = new Set([
  "block_asset_refs",
  "block_documents",
  "block_properties",
  "block_relocation_members",
  "block_relocations",
  "block_search_units",
  "blocks",
  "canvas_card_references",
  "canvas_scene_elements",
  "canvas_scene_file_refs",
  "canvas_scene_files",
  "canvas_scene_mutation_receipts",
  "canvas_scenes",
  "card_read_model",
  "database_capabilities",
  "database_memberships",
  "database_view_positions",
  "document_block_index",
  "document_materializations",
  "document_recovery_artifacts",
  "document_snapshots",
  "document_update_receipts",
  "document_updates",
  "document_versions",
  "recurrence_exceptions",
  "reminder_receipts",
  "reminder_snoozes",
  "scheduled_card_index",
  "top_level_block_placements",
]);

const DOCUMENT_BEARING_BLOCK_TYPES = new Set(
  listBlockDocumentSchemaAdapters().map((adapter) => adapter.ownerType),
);

const requireIdentity = (value: string, label: string): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new TypeError(`${label} must be a canonical bounded identity`);
};

const requireCount = (
  value: number,
  label: string,
  maximum: number,
  minimum = 0,
): number => {
  if (Number.isSafeInteger(value) && value >= minimum && value <= maximum) {
    return value;
  }
  throw new TypeError(
    `${label} must be a safe integer between ${minimum} and ${maximum}`,
  );
};

const normalizePolicy = (
  input: Partial<BlockRetentionGcPolicy> | undefined,
): BlockRetentionGcPolicy => {
  if (
    input?.version !== undefined &&
    input.version !== BLOCK_RETENTION_GC_POLICY_VERSION
  ) {
    throw new TypeError("Unsupported Block retention GC policy version");
  }
  return {
    version: BLOCK_RETENTION_GC_POLICY_VERSION,
    retainNewestDeletedBlocks: requireCount(
      input?.retainNewestDeletedBlocks ??
        DEFAULT_BLOCK_RETENTION_GC_POLICY.retainNewestDeletedBlocks,
      "retainNewestDeletedBlocks",
      MAX_RETAINED_TOMBSTONES,
    ),
    maxCandidates: requireCount(
      input?.maxCandidates ?? DEFAULT_BLOCK_RETENTION_GC_POLICY.maxCandidates,
      "maxCandidates",
      MAX_GC_CANDIDATES,
      1,
    ),
    maxEvidenceSamplesPerBlocker: requireCount(
      input?.maxEvidenceSamplesPerBlocker ??
        DEFAULT_BLOCK_RETENTION_GC_POLICY.maxEvidenceSamplesPerBlocker,
      "maxEvidenceSamplesPerBlocker",
      MAX_EVIDENCE_SAMPLES,
      1,
    ),
    maxRetainedDocumentVersionsToInspect: requireCount(
      input?.maxRetainedDocumentVersionsToInspect ??
        DEFAULT_BLOCK_RETENTION_GC_POLICY.maxRetainedDocumentVersionsToInspect,
      "maxRetainedDocumentVersionsToInspect",
      MAX_RETAINED_DOCUMENT_VERSIONS_TO_INSPECT,
      1,
    ),
  };
};

const uniqueIdentities = (
  values: readonly string[],
  label: string,
  maximum: number,
): readonly string[] => {
  if (values.length > maximum) {
    throw new TypeError(`${label} exceeds the bounded count`);
  }
  const normalized = values.map((value) => requireIdentity(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must contain unique identities`);
  }
  return normalized;
};

const placeholders = (count: number): string =>
  Array.from({ length: count }, () => "?").join(", ");

const createBlockerCollector = (maximumSamples: number): BlockerCollector => {
  const entries = new Map<
    BlockRetentionGcBlockerKind,
    {
      readonly keys: Set<string>;
      readonly samples: BlockRetentionGcEvidence[];
      count: number;
    }
  >();
  const addSample = (
    kind: BlockRetentionGcBlockerKind,
    count: number,
    evidence: BlockRetentionGcEvidence,
    dedupeKey: string,
  ): void => {
    const current =
      entries.get(kind) ?? {
        keys: new Set<string>(),
        samples: [],
        count: 0,
      };
    if (current.keys.has(dedupeKey)) return;
    current.keys.add(dedupeKey);
    current.count += count;
    if (current.samples.length < maximumSamples) {
      current.samples.push(evidence);
    }
    entries.set(kind, current);
  };
  return {
    add: (kind, evidence) =>
      addSample(kind, 1, evidence, JSON.stringify(evidence)),
    addAggregate: (kind, count, evidence) => {
      if (!Number.isSafeInteger(count) || count <= 0) return;
      addSample(
        kind,
        count,
        evidence,
        `aggregate:${JSON.stringify(evidence)}`,
      );
    },
    finish: () =>
      [...entries.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, value]) => ({
          kind,
          count: value.count,
          samples: value.samples,
        })),
  };
};

const readJson = (serialized: string, label: string): unknown => {
  try {
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new TypeError(`Stored ${label} is invalid JSON`, { cause: error });
  }
};

const readIdentityArray = (
  serialized: string,
  label: string,
): readonly string[] => {
  const value = readJson(serialized, label);
  if (!Array.isArray(value)) {
    throw new TypeError(`Stored ${label} is not an array`);
  }
  return uniqueIdentities(
    value.map((entry) => {
      if (typeof entry === "string") return entry;
      throw new TypeError(`Stored ${label} contains a non-string identity`);
    }),
    label,
    100_000,
  );
};

const readBlockTreeIds = (
  value: unknown,
  label: string,
): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const ids: string[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (
      depth > 64 ||
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new TypeError(`${label} contains an invalid Block tree`);
    }
    const record = candidate as {
      readonly id?: unknown;
      readonly children?: unknown;
    };
    if (typeof record.id !== "string" || !Array.isArray(record.children)) {
      throw new TypeError(`${label} contains an invalid Block node`);
    }
    ids.push(requireIdentity(record.id, `${label}.id`));
    record.children.forEach((child) => visit(child, depth + 1));
  };
  value.forEach((block) => visit(block, 1));
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} contains duplicate Block identities`);
  }
  return ids;
};

const parseBlockReferences = (
  serialized: string,
): readonly BlockDocumentReference[] => {
  const value = readJson(serialized, "Block Document references");
  if (!Array.isArray(value)) {
    throw new TypeError("Stored Block Document references are not an array");
  }
  return value.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new TypeError("Stored Block Document reference is invalid");
    }
    const reference = candidate as Readonly<Record<string, unknown>>;
    const kind = reference.kind;
    const sourceBlockId = reference.sourceBlockId;
    if (typeof kind !== "string" || typeof sourceBlockId !== "string") {
      throw new TypeError("Stored Block Document reference identity is invalid");
    }
    requireIdentity(sourceBlockId, "reference.sourceBlockId");
    if (kind === "block" || kind === "legacy_card_projection") {
      if (typeof reference.targetBlockId !== "string") {
        throw new TypeError("Stored Block target reference is invalid");
      }
      requireIdentity(reference.targetBlockId, "reference.targetBlockId");
      return reference as unknown as BlockDocumentReference;
    }
    if (kind === "database_view") {
      if (typeof reference.databaseViewId !== "string") {
        throw new TypeError("Stored Database View reference is invalid");
      }
      requireIdentity(reference.databaseViewId, "reference.databaseViewId");
      return reference as unknown as BlockDocumentReference;
    }
    if (kind === "thread") {
      if (typeof reference.targetThreadId !== "string") {
        throw new TypeError("Stored Thread reference is invalid");
      }
      requireIdentity(reference.targetThreadId, "reference.targetThreadId");
      return reference as unknown as BlockDocumentReference;
    }
    if (kind === "legacy_database_query") {
      if (typeof reference.projectHint !== "string") {
        throw new TypeError("Stored legacy Database query is invalid");
      }
      return reference as unknown as BlockDocumentReference;
    }
    throw new TypeError(`Stored Block Document reference kind is unsupported`);
  });
};

const readBlock = (
  database: Database.Database,
  blockId: string,
): BlockRow | null =>
  (database
    .prepare(
      `
      SELECT id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id, updated_at
      FROM blocks WHERE id = ?
    `,
    )
    .get(blockId) as BlockRow | undefined) ?? null;

const readOwnedDocument = (
  database: Database.Database,
  blockId: string,
): OwnedDocumentRow | null =>
  (database
    .prepare(
      `
      SELECT ownership.block_id, ownership.document_id, ownership.project_id,
        document.generation, document.head_seq, document.schema_key,
        document.schema_version, document.readiness, document.authority
      FROM block_documents ownership
      INNER JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      WHERE ownership.block_id = ?
    `,
    )
    .get(blockId) as OwnedDocumentRow | undefined) ?? null;

const readBlockDocumentOwnership = (
  database: Database.Database,
  blockId: string,
): BlockDocumentOwnershipRow | null =>
  (database
    .prepare(
      `SELECT block_id, document_id, project_id
       FROM block_documents WHERE block_id = ?`,
    )
    .get(blockId) as BlockDocumentOwnershipRow | undefined) ?? null;

const registeredAdapter = (
  ownerType: string,
  document: OwnedDocumentRow,
): RegisteredBlockDocumentSchemaAdapter =>
  getRegisteredBlockDocumentSchemaAdapter({
    ownerType,
    schemaKey: document.schema_key,
    schemaVersion: document.schema_version,
  });

const buildGcClosure = (
  database: Database.Database,
  projectId: string,
  root: BlockRow,
  collector: BlockerCollector,
): GcClosure => {
  const closure: GcClosure = {
    blockIds: new Set([root.id]),
    documentIds: new Set(),
    ownerBlockIds: new Set(),
  };
  const pending = [root];
  while (pending.length > 0) {
    const block = pending.pop();
    if (!block) continue;
    const ownership = readBlockDocumentOwnership(database, block.id);
    if (!ownership) {
      if (DOCUMENT_BEARING_BLOCK_TYPES.has(block.type)) {
        collector.add("ownership_corrupt", {
          source: "block_documents",
          identity: block.id,
          relation: "document_bearing_block_has_no_ownership",
        });
      }
      continue;
    }
    const document = readOwnedDocument(database, block.id);
    if (!document) {
      collector.add("ownership_corrupt", {
        source: "block_documents",
        identity: block.id,
        relation: "owned_document_missing_or_scope_mismatch",
        documentId: ownership.document_id,
      });
      continue;
    }
    if (
      ownership.project_id !== projectId ||
      document.project_id !== projectId ||
      closure.documentIds.has(document.document_id)
    ) {
      collector.add("ownership_corrupt", {
        source: "block_documents",
        identity: block.id,
        relation: "owned_document_scope_or_cycle",
        documentId: document.document_id,
      });
      continue;
    }
    try {
      registeredAdapter(block.type, document);
    } catch {
      collector.add("ownership_corrupt", {
        source: "block_documents",
        identity: block.id,
        relation: "unregistered_owner_schema",
        documentId: document.document_id,
      });
    }
    closure.documentIds.add(document.document_id);
    closure.ownerBlockIds.add(block.id);
    const contained = database
      .prepare(
        `
        SELECT id, project_id, type, lifecycle, location_kind,
          containing_document_id, containing_database_id, updated_at
        FROM blocks
        WHERE containing_document_id = ? AND project_id = ?
        ORDER BY id
      `,
      )
      .all(document.document_id, projectId) as readonly BlockRow[];
    for (const child of contained) {
      if (child.lifecycle !== "deleted") {
        collector.add("live_contained_block", {
          source: "blocks",
          identity: child.id,
          relation: "contained_by_owned_document",
          status: child.lifecycle,
          documentId: document.document_id,
        });
        continue;
      }
      if (closure.blockIds.has(child.id)) continue;
      closure.blockIds.add(child.id);
      pending.push(child);
    }
  }
  return closure;
};

const addProjectionFailure = (
  collector: BlockerCollector,
  documentId: string,
  relation: string,
): void => {
  collector.add("projection_unverifiable", {
    source: "documents",
    identity: documentId,
    relation,
    documentId,
  });
};

const analyzeDocumentProjectionRoots = (
  database: Database.Database,
  closure: GcClosure,
  databaseViewIds: ReadonlySet<string>,
  collector: BlockerCollector,
): void => {
  const documents = database
    .prepare(
      `
      SELECT document.id, document.generation, document.head_seq,
        document.project_id,
        document.schema_key, document.schema_version,
        document.readiness, document.authority, document.sync_engine,
        owner.id AS owner_block_id, owner.type AS owner_type
      FROM documents document
      INNER JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      INNER JOIN blocks owner
        ON owner.id = ownership.block_id
        AND owner.project_id = ownership.project_id
      ORDER BY document.id
    `,
    )
    .all() as readonly {
    readonly id: string;
    readonly project_id: string;
    readonly generation: number;
    readonly head_seq: number;
    readonly schema_key: string;
    readonly schema_version: number;
    readonly readiness: string;
    readonly authority: string;
    readonly sync_engine: "yjs" | "canvas_scene";
    readonly owner_block_id: string;
    readonly owner_type: string;
  }[];
  for (const document of documents) {
    if (closure.documentIds.has(document.id)) continue;
    let registration;
    try {
      registration = getOwnedDocumentSchemaRegistration({
        ownerType: document.owner_type,
        schemaKey: document.schema_key,
        schemaVersion: document.schema_version,
      });
    } catch {
      addProjectionFailure(collector, document.id, "unregistered_schema");
      continue;
    }
    if (
      document.readiness !== "ready" ||
      document.authority !== "ydoc_primary" ||
      registration.syncEngine !== document.sync_engine
    ) {
      addProjectionFailure(collector, document.id, "document_not_primary_ready");
      continue;
    }
    if (registration.contentModel === "block_tree") {
      const materialization = database
        .prepare(
          `
          SELECT generation, projected_seq, schema_version,
            block_tree_json, references_json
          FROM document_materializations WHERE document_id = ?
        `,
        )
        .get(document.id) as
        | {
            readonly generation: number;
            readonly projected_seq: number;
            readonly schema_version: number;
            readonly block_tree_json: string;
            readonly references_json: string;
          }
        | undefined;
      if (
        !materialization ||
        materialization.generation !== document.generation ||
        materialization.projected_seq !== document.head_seq ||
        materialization.schema_version !== document.schema_version
      ) {
        addProjectionFailure(collector, document.id, "block_tree_projection_stale");
        continue;
      }
      try {
        const blockIds = readBlockTreeIds(
          readJson(materialization.block_tree_json, "Block tree"),
          `Document ${document.id} Block tree`,
        );
        for (const blockId of blockIds) {
          if (!closure.blockIds.has(blockId)) continue;
          collector.add("current_document_content", {
            source: "document_materializations",
            identity: blockId,
            relation: "current_block_tree_contains_candidate",
            documentId: document.id,
          });
        }
        const references = parseBlockReferences(
          materialization.references_json,
        );
        for (const reference of references) {
          if (
            (reference.kind === "block" ||
              reference.kind === "legacy_card_projection") &&
            closure.blockIds.has(reference.targetBlockId)
          ) {
            collector.add("block_tree_reference", {
              source: "document_materializations",
              identity: reference.sourceBlockId,
              relation: reference.kind,
              documentId: document.id,
            });
          }
          if (
            reference.kind === "database_view" &&
            databaseViewIds.has(reference.databaseViewId)
          ) {
            collector.add("database_view_reference", {
              source: "document_materializations",
              identity: reference.sourceBlockId,
              relation: "database_view",
              documentId: document.id,
            });
          }
        }
      } catch {
        addProjectionFailure(collector, document.id, "block_tree_projection_corrupt");
      }
      continue;
    }
    try {
      const authority = readCanvasSceneAuthoritySnapshot(database, {
        documentId: document.id,
        generation: document.generation,
        headSeq: document.head_seq,
        schemaVersion: document.schema_version,
      });
      const rows = database
        .prepare(
          `
          SELECT source_element_id, target_block_id
          FROM canvas_card_references
          WHERE document_id = ? AND project_id = ?
            AND document_generation = ? AND projected_seq = ?
          ORDER BY source_element_id
        `,
        )
        .all(
          document.id,
          document.project_id,
          document.generation,
          document.head_seq,
        ) as readonly {
        readonly source_element_id: string;
        readonly target_block_id: string;
      }[];
      const projected = authority.scene.cardReferences
        .map((reference) => ({
          source_element_id: reference.sourceElementId,
          target_block_id: reference.targetBlockId,
        }))
        .sort((left, right) =>
          left.source_element_id.localeCompare(right.source_element_id),
        );
      if (JSON.stringify(rows) !== JSON.stringify(projected)) {
        addProjectionFailure(collector, document.id, "canvas_reference_index_stale");
        continue;
      }
      for (const reference of rows) {
        if (!closure.blockIds.has(reference.target_block_id)) continue;
        collector.add("canvas_card_reference", {
          source: "canvas_card_references",
          identity: reference.source_element_id,
          relation: "target_block",
          documentId: document.id,
        });
      }
    } catch {
      addProjectionFailure(collector, document.id, "canvas_projection_corrupt");
    }
  }
};

const readDatabaseViewIds = (
  database: Database.Database,
  projectId: string,
  blockIds: ReadonlySet<string>,
): ReadonlySet<string> => {
  if (blockIds.size === 0) return new Set();
  const ids = [...blockIds];
  return new Set(
    (
      database
        .prepare(
          `
          SELECT id FROM database_views
          WHERE project_id = ? AND database_block_id IN (${placeholders(ids.length)})
        `,
        )
        .all(projectId, ...ids) as readonly { readonly id: string }[]
    ).map((row) => row.id),
  );
};

const analyzeRecoveryRoots = (
  database: Database.Database,
  projectId: string,
  closure: GcClosure,
  collector: BlockerCollector,
): void => {
  const rows = database
    .prepare(
      `
      SELECT id, document_id, status,
        touched_block_ids_json, derived_touched_block_ids_json
      FROM document_recovery_artifacts
      WHERE project_id = ?
      ORDER BY id
    `,
    )
    .all(projectId) as readonly {
    readonly id: string;
    readonly document_id: string;
    readonly status: "pending" | "resolved" | "discarded";
    readonly touched_block_ids_json: string;
    readonly derived_touched_block_ids_json: string | null;
  }[];
  for (const row of rows) {
    let touched: readonly string[];
    try {
      touched = [
        ...readIdentityArray(
          row.touched_block_ids_json,
          "recovery touched Block IDs",
        ),
        ...(row.derived_touched_block_ids_json
          ? readIdentityArray(
              row.derived_touched_block_ids_json,
              "recovery derived Block IDs",
            )
          : []),
      ];
    } catch {
      addProjectionFailure(collector, row.document_id, "recovery_evidence_corrupt");
      continue;
    }
    if (
      !closure.documentIds.has(row.document_id) &&
      !touched.some((blockId) => closure.blockIds.has(blockId))
    ) {
      continue;
    }
    collector.add(
      row.status === "pending"
        ? "pending_recovery_artifact"
        : "retained_recovery_artifact",
      {
        source: "document_recovery_artifacts",
        identity: row.id,
        relation: "document_or_touched_block",
        status: row.status,
        documentId: row.document_id,
      },
    );
  }
};

const intersects = (
  values: readonly string[],
  candidates: ReadonlySet<string>,
): boolean => values.some((value) => candidates.has(value));

const byteArraysEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index]);

const sha256 = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const analyzeHistoricalDocumentVersionRoots = (
  database: Database.Database,
  closure: GcClosure,
  databaseViewIds: ReadonlySet<string>,
  policy: BlockRetentionGcPolicy,
  collector: BlockerCollector,
): void => {
  const versionCount = (
    database.prepare("SELECT COUNT(*) AS count FROM document_versions").get() as {
      readonly count: number;
    }
  ).count;
  if (versionCount > policy.maxRetainedDocumentVersionsToInspect) {
    collector.addAggregate("projection_unverifiable", versionCount, {
      source: "document_versions",
      identity: String(versionCount),
      relation: "retained_history_exceeds_bounded_scan_policy",
    });
    return;
  }
  const versions = database
    .prepare(
      `
      SELECT version_id, document_id, project_id, schema_key, schema_version,
        checkpoint_format, full_update_blob, state_vector, checkpoint_hash,
        byte_length
      FROM document_versions
      ORDER BY version_id
    `,
    )
    .all() as readonly {
    readonly version_id: string;
    readonly document_id: string;
    readonly project_id: string;
    readonly schema_key: string;
    readonly schema_version: number;
    readonly checkpoint_format: "yjs_update_v1" | "canvas_scene_json_v1";
    readonly full_update_blob: Buffer;
    readonly state_vector: Buffer;
    readonly checkpoint_hash: string;
    readonly byte_length: number;
  }[];
  for (const version of versions) {
    const corrupt = (relation: string): void => {
      collector.add("projection_unverifiable", {
        source: "document_versions",
        identity: version.version_id,
        relation,
        documentId: version.document_id,
      });
    };
    let registration;
    try {
      registration = getOwnedDocumentSchemaRegistrationForSchema({
        schemaKey: version.schema_key,
        schemaVersion: version.schema_version,
      });
    } catch {
      corrupt("historical_schema_unregistered");
      continue;
    }
    if (
      version.byte_length < 1 ||
      version.byte_length !== version.full_update_blob.byteLength ||
      version.byte_length > MAX_CARD_DOCUMENT_STATE_BYTES ||
      !/^[a-f0-9]{64}$/u.test(version.checkpoint_hash) ||
      sha256(version.full_update_blob) !== version.checkpoint_hash
    ) {
      corrupt("historical_checkpoint_metadata_corrupt");
      continue;
    }
    if (version.checkpoint_format === "canvas_scene_json_v1") {
      if (
        version.state_vector.byteLength !== 0 ||
        registration.syncEngine !== "canvas_scene"
      ) {
        corrupt("historical_checkpoint_format_corrupt");
        continue;
      }
      try {
        const scene = parsePortableCanvasScene(
          JSON.parse(version.full_update_blob.toString("utf8")) as unknown,
        );
        for (const reference of scene.cardReferences) {
          if (!closure.blockIds.has(reference.targetBlockId)) continue;
          collector.add("canvas_card_reference", {
            source: "document_versions",
            identity: version.version_id,
            relation: `historical_canvas:${reference.sourceElementId}`,
            documentId: version.document_id,
          });
        }
      } catch {
        corrupt("historical_checkpoint_schema_corrupt");
      }
      continue;
    }
    if (registration.syncEngine !== "yjs") {
      corrupt("historical_checkpoint_format_corrupt");
      continue;
    }
    let adapter: RegisteredBlockDocumentSchemaAdapter;
    try {
      adapter = getRegisteredBlockDocumentSchemaAdapter({
        ownerType: registration.ownerType,
        schemaKey: version.schema_key,
        schemaVersion: version.schema_version,
      });
    } catch {
      corrupt("historical_schema_unregistered");
      continue;
    }
    const document = new Y.Doc({ guid: version.document_id });
    try {
      try {
        Y.applyUpdate(
          document,
          version.full_update_blob,
          "block-retention-gc-history",
        );
      } catch {
        corrupt("historical_checkpoint_update_corrupt");
        continue;
      }
      if (
        document.store.pendingStructs !== null ||
        document.store.pendingDs !== null ||
        !byteArraysEqual(Y.encodeStateVector(document), version.state_vector)
      ) {
        corrupt("historical_checkpoint_causality_corrupt");
        continue;
      }
      try {
        const materialization = inspectRegisteredOwnedBlockDocument(document, {
          ownerType: adapter.ownerType,
          schemaKey: version.schema_key,
          schemaVersion: version.schema_version,
        }).materialization;
        for (const blockId of readBlockTreeIds(
          materialization.blockTree,
          `Document version ${version.version_id} Block tree`,
        )) {
          if (!closure.blockIds.has(blockId)) continue;
          collector.add("retained_document_version", {
            source: "document_versions",
            identity: version.version_id,
            relation: "historical_block_identity",
            documentId: version.document_id,
          });
        }
        for (const reference of materialization.references) {
          if (
            (reference.kind === "block" ||
              reference.kind === "legacy_card_projection") &&
            closure.blockIds.has(reference.targetBlockId)
          ) {
            collector.add("block_tree_reference", {
              source: "document_versions",
              identity: version.version_id,
              relation: `historical_${reference.kind}`,
              documentId: version.document_id,
            });
          }
          if (
            reference.kind === "database_view" &&
            databaseViewIds.has(reference.databaseViewId)
          ) {
            collector.add("database_view_reference", {
              source: "document_versions",
              identity: version.version_id,
              relation: "historical_database_view",
              documentId: version.document_id,
            });
          }
        }
      } catch {
        corrupt("historical_checkpoint_schema_corrupt");
      }
    } finally {
      document.destroy();
    }
  }
};

const analyzeImmutableEvidenceRoots = (
  database: Database.Database,
  projectId: string,
  closure: GcClosure,
  collector: BlockerCollector,
): void => {
  const versions = database
    .prepare(
      `SELECT version_id, document_id FROM document_versions WHERE project_id = ?`,
    )
    .all(projectId) as readonly {
    readonly version_id: string;
    readonly document_id: string;
  }[];
  for (const version of versions) {
    if (!closure.documentIds.has(version.document_id)) continue;
    collector.add("retained_document_version", {
      source: "document_versions",
      identity: version.version_id,
      relation: "document_checkpoint",
      documentId: version.document_id,
    });
  }

  const mutations = database
    .prepare(
      `
      SELECT mutation_id, outcome, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json
      FROM block_mutations WHERE project_id = ?
      ORDER BY mutation_id
    `,
    )
    .all(projectId) as readonly {
    readonly mutation_id: string;
    readonly outcome: string;
    readonly target_block_ids_json: string;
    readonly affected_document_ids_json: string;
    readonly affected_database_block_ids_json: string;
  }[];
  for (const mutation of mutations) {
    try {
      const blockIds = readIdentityArray(
        mutation.target_block_ids_json,
        "mutation target Block IDs",
      );
      const documentIds = readIdentityArray(
        mutation.affected_document_ids_json,
        "mutation affected Document IDs",
      );
      const databaseIds = readIdentityArray(
        mutation.affected_database_block_ids_json,
        "mutation affected Database IDs",
      );
      if (
        !intersects(blockIds, closure.blockIds) &&
        !intersects(documentIds, closure.documentIds) &&
        !intersects(databaseIds, closure.blockIds)
      ) {
        continue;
      }
      collector.add("retained_block_mutation", {
        source: "block_mutations",
        identity: mutation.mutation_id,
        relation: "affected_identity",
        status: mutation.outcome,
      });
    } catch {
      collector.add("retained_block_mutation", {
        source: "block_mutations",
        identity: mutation.mutation_id,
        relation: "corrupt_evidence",
        status: mutation.outcome,
      });
    }
  }

  const changes = database
    .prepare(
      `
      SELECT seq, kind, block_ids_json, document_ids_json,
        database_block_ids_json
      FROM change_log WHERE project_id = ?
      ORDER BY seq
    `,
    )
    .all(projectId) as readonly {
    readonly seq: number;
    readonly kind: string;
    readonly block_ids_json: string;
    readonly document_ids_json: string;
    readonly database_block_ids_json: string;
  }[];
  for (const change of changes) {
    try {
      if (
        !intersects(
          readIdentityArray(change.block_ids_json, "change Block IDs"),
          closure.blockIds,
        ) &&
        !intersects(
          readIdentityArray(change.document_ids_json, "change Document IDs"),
          closure.documentIds,
        ) &&
        !intersects(
          readIdentityArray(change.database_block_ids_json, "change Database IDs"),
          closure.blockIds,
        )
      ) {
        continue;
      }
      collector.add("retained_change_log", {
        source: "change_log",
        identity: String(change.seq),
        relation: "affected_identity",
        status: change.kind,
      });
    } catch {
      collector.add("retained_change_log", {
        source: "change_log",
        identity: String(change.seq),
        relation: "corrupt_evidence",
        status: change.kind,
      });
    }
  }

  const relocations = database
    .prepare(
      `
      SELECT relocation.id, relocation.source_document_id,
        relocation.target_document_id, relocation.target_parent_block_id,
        relocation.target_before_block_id, member.block_id
      FROM block_relocations relocation
      LEFT JOIN block_relocation_members member
        ON member.relocation_id = relocation.id
      WHERE relocation.project_id = ? OR relocation.target_project_id = ?
      ORDER BY relocation.id, member.block_id
    `,
    )
    .all(projectId, projectId) as readonly {
    readonly id: string;
    readonly source_document_id: string;
    readonly target_document_id: string | null;
    readonly target_parent_block_id: string | null;
    readonly target_before_block_id: string | null;
    readonly block_id: string | null;
  }[];
  for (const relocation of relocations) {
    if (
      !closure.documentIds.has(relocation.source_document_id) &&
      !(relocation.target_document_id
        ? closure.documentIds.has(relocation.target_document_id)
        : false) &&
      !(relocation.target_parent_block_id
        ? closure.blockIds.has(relocation.target_parent_block_id)
        : false) &&
      !(relocation.target_before_block_id
        ? closure.blockIds.has(relocation.target_before_block_id)
        : false) &&
      !(relocation.block_id
        ? closure.blockIds.has(relocation.block_id)
        : false)
    ) {
      continue;
    }
    collector.add("retained_relocation", {
      source: "block_relocations",
      identity: relocation.id,
      relation: "document_block_or_anchor",
    });
  }
};

const analyzeRelationalRoots = (
  database: Database.Database,
  projectId: string,
  closure: GcClosure,
  databaseViewIds: ReadonlySet<string>,
  collector: BlockerCollector,
): void => {
  const blockIds = [...closure.blockIds];
  if (blockIds.length === 0) return;
  const inBlocks = placeholders(blockIds.length);
  const placements = database
    .prepare(
      `SELECT block_id FROM top_level_block_placements
       WHERE project_id = ? AND block_id IN (${inBlocks})`,
    )
    .all(projectId, ...blockIds) as readonly { readonly block_id: string }[];
  for (const row of placements) {
    collector.add("top_level_placement", {
      source: "top_level_block_placements",
      identity: row.block_id,
      relation: "placed_tombstone",
    });
  }
  const activeMemberships = database
    .prepare(
      `
      SELECT id, card_block_id FROM database_memberships
      WHERE project_id = ? AND removed_at IS NULL
        AND card_block_id IN (${inBlocks})
    `,
    )
    .all(projectId, ...blockIds) as readonly {
    readonly id: string;
    readonly card_block_id: string;
  }[];
  for (const row of activeMemberships) {
    collector.add("active_database_membership", {
      source: "database_memberships",
      identity: row.id,
      relation: "active_card_membership",
      status: row.card_block_id,
    });
  }
  const positions = database
    .prepare(
      `
      SELECT view_id, block_id FROM database_view_positions
      WHERE project_id = ? AND block_id IN (${inBlocks})
    `,
    )
    .all(projectId, ...blockIds) as readonly {
    readonly view_id: string;
    readonly block_id: string;
  }[];
  for (const row of positions) {
    collector.add("database_view_position", {
      source: "database_view_positions",
      identity: `${row.view_id}/${row.block_id}`,
      relation: "view_position",
    });
  }
  const databaseDependents = database
    .prepare(
      `
      SELECT capability.block_id,
        capability.is_primary,
        (SELECT COUNT(*) FROM database_properties property
          WHERE property.database_block_id = capability.block_id
            AND property.lifecycle = 'active') AS active_properties,
        (SELECT COUNT(*) FROM database_views view
          WHERE view.database_block_id = capability.block_id
            AND view.lifecycle = 'active') AS active_views,
        (SELECT COUNT(*) FROM database_memberships membership
          WHERE membership.database_block_id = capability.block_id
            AND membership.removed_at IS NULL) AS active_memberships
      FROM database_capabilities capability
      WHERE capability.project_id = ? AND capability.block_id IN (${inBlocks})
    `,
    )
    .all(projectId, ...blockIds) as readonly {
    readonly block_id: string;
    readonly is_primary: number;
    readonly active_properties: number;
    readonly active_views: number;
    readonly active_memberships: number;
  }[];
  for (const row of databaseDependents) {
    for (const [relation, count] of [
      ["primary_capability", row.is_primary],
      ["active_properties", row.active_properties],
      ["active_views", row.active_views],
      ["active_memberships", row.active_memberships],
    ] as const) {
      collector.addAggregate("active_database_dependent", count, {
        source: "database_capabilities",
        identity: row.block_id,
        relation,
      });
    }
  }
  const externalIndexRows = database
    .prepare(
      `
      SELECT document_id, block_id FROM document_block_index
      WHERE block_id IN (${inBlocks})
    `,
    )
    .all(...blockIds) as readonly {
    readonly document_id: string;
    readonly block_id: string;
  }[];
  for (const row of externalIndexRows) {
    if (closure.documentIds.has(row.document_id)) continue;
    collector.add("current_document_content", {
      source: "document_block_index",
      identity: row.block_id,
      relation: "current_external_index",
      documentId: row.document_id,
    });
  }

  analyzeSessionRoots(
    database,
    projectId,
    closure,
    databaseViewIds,
    collector,
  );
  analyzeCardBehaviorRoots(database, projectId, closure, collector);
};

const analyzeSessionRoots = (
  database: Database.Database,
  projectId: string,
  closure: GcClosure,
  databaseViewIds: ReadonlySet<string>,
  collector: BlockerCollector,
): void => {
  const tabs = database
    .prepare(
      `
      SELECT tab.id, tab.kind, tab.config_json,
        tab.project_id, session.project_id AS session_project_id
      FROM project_session_tabs tab
      INNER JOIN project_sessions session ON session.id = tab.session_id
      WHERE session.archived = 0
      ORDER BY tab.id
    `,
    )
    .all() as readonly {
    readonly id: string;
    readonly kind: string;
    readonly config_json: string;
    readonly project_id: string;
    readonly session_project_id: string | null;
  }[];
  for (const tab of tabs) {
    try {
      if (
        tab.session_project_id !== null &&
        tab.session_project_id !== tab.project_id
      ) {
        throw new TypeError("Session tab host Project scope diverges");
      }
      const config = parseProjectSessionTabConfig(
        tab.kind,
        readJson(tab.config_json, `session tab ${tab.id} config`),
      );
      if (
        tab.kind === "card_stage" &&
        "cardId" in config &&
        closure.blockIds.has(config.cardId)
      ) {
        if (config.projectId !== projectId) {
          throw new TypeError("Card tab target Project scope diverges");
        }
        collector.add("session_target", {
          source: "project_session_tabs",
          identity: tab.id,
          relation: "card_stage",
        });
      }
      if (tab.kind !== "db_view" || !("view" in config)) continue;
      const databaseViewId =
        "databaseViewId" in config ? config.databaseViewId : undefined;
      if (databaseViewId && databaseViewIds.has(databaseViewId)) {
        if (config.projectId !== projectId) {
          throw new TypeError("Database tab target Project scope diverges");
        }
        collector.add("session_target", {
          source: "project_session_tabs",
          identity: tab.id,
          relation: "database_view",
        });
        continue;
      }
      if (databaseViewId) continue;
      const primaryViews = database
        .prepare(
          `
          SELECT id FROM database_views
          WHERE project_id = ? AND is_primary = 1 AND lifecycle = 'active'
          ORDER BY id
        `,
        )
        .all(config.projectId) as readonly { readonly id: string }[];
      if (primaryViews.length !== 1) {
        throw new TypeError("Legacy DB tab cannot resolve one primary View");
      }
      if (databaseViewIds.has(primaryViews[0]?.id ?? "")) {
        collector.add("session_target", {
          source: "project_session_tabs",
          identity: tab.id,
          relation: "legacy_primary_database_view",
        });
      }
    } catch {
      collector.add("session_state_corrupt", {
        source: "project_session_tabs",
        identity: tab.id,
        relation: "unverifiable_active_tab_config",
      });
    }
  }
};

const addRowsAsBlockers = (
  rows: readonly { readonly identity: string; readonly relation: string }[],
  kind: BlockRetentionGcBlockerKind,
  source: string,
  collector: BlockerCollector,
): void => {
  for (const row of rows) {
    collector.add(kind, {
      source,
      identity: row.identity,
      relation: row.relation,
    });
  }
};

const analyzeCardBehaviorRoots = (
  database: Database.Database,
  projectId: string,
  closure: GcClosure,
  collector: BlockerCollector,
): void => {
  const ids = [...closure.blockIds];
  if (ids.length === 0) return;
  const inBlocks = placeholders(ids.length);
  const behaviors = database
    .prepare(
      `SELECT CAST(id AS TEXT) AS identity, 'recurrence_exception' AS relation
       FROM recurrence_exceptions
       WHERE project_id = ? AND card_id IN (${inBlocks})
       UNION ALL
       SELECT CAST(id AS TEXT), 'reminder_receipt' FROM reminder_receipts
       WHERE project_id = ? AND card_id IN (${inBlocks})
       UNION ALL
       SELECT CAST(id AS TEXT), 'reminder_snooze' FROM reminder_snoozes
       WHERE project_id = ? AND card_id IN (${inBlocks})`,
    )
    .all(projectId, ...ids, projectId, ...ids, projectId, ...ids) as readonly {
    readonly identity: string;
    readonly relation: string;
  }[];
  addRowsAsBlockers(
    behaviors,
    "card_behavior_evidence",
    "card_behavior_records",
    collector,
  );
};

interface ForeignKeyListRow {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string;
}

const quoteSqlIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const analyzeUnknownInboundForeignKey = (
  database: Database.Database,
  projectId: string,
  tableName: string,
  foreignKey: readonly ForeignKeyListRow[],
  closure: GcClosure,
  collector: BlockerCollector,
): void => {
  const referencedTable = foreignKey[0]?.table;
  if (
    referencedTable !== "blocks" &&
    referencedTable !== "documents" &&
    referencedTable !== "block_documents"
  ) {
    return;
  }
  const projectColumn = foreignKey.find((column) => column.to === "project_id")
    ?.from;
  const identityColumns = foreignKey.flatMap((column) => {
    if (
      referencedTable === "blocks" &&
      column.to === "id"
    ) {
      return [{ column: column.from, identities: closure.blockIds }];
    }
    if (
      referencedTable === "documents" &&
      column.to === "id"
    ) {
      return [{ column: column.from, identities: closure.documentIds }];
    }
    if (
      referencedTable === "block_documents" &&
      column.to === "block_id"
    ) {
      return [{ column: column.from, identities: closure.ownerBlockIds }];
    }
    if (
      referencedTable === "block_documents" &&
      column.to === "document_id"
    ) {
      return [{ column: column.from, identities: closure.documentIds }];
    }
    return [];
  });
  const populatedIdentityColumns = identityColumns.filter(
    ({ identities }) => identities.size > 0,
  );
  if (identityColumns.length === 0) {
    collector.add("unclassified_foreign_key_root", {
      source: tableName,
      identity: tableName,
      relation: `unsupported_fk_shape:${referencedTable}`,
    });
    return;
  }
  if (populatedIdentityColumns.length === 0) return;
  const bindings: string[] = [];
  const identityPredicates = populatedIdentityColumns.map(
    ({ column, identities }) => {
      bindings.push(...identities);
      return `${quoteSqlIdentifier(column)} IN (${placeholders(identities.size)})`;
    },
  );
  if (projectColumn) bindings.push(projectId);
  const predicate = `(${identityPredicates.join(" OR ")})${
    projectColumn ? ` AND ${quoteSqlIdentifier(projectColumn)} = ?` : ""
  }`;
  const count = (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM ${quoteSqlIdentifier(tableName)} WHERE ${predicate}`,
      )
      .get(...bindings) as { readonly count: number }
  ).count;
  if (count === 0) return;
  const sampleColumn = populatedIdentityColumns[0]?.column;
  if (!sampleColumn) return;
  const sample = database
    .prepare(
      `SELECT CAST(${quoteSqlIdentifier(sampleColumn)} AS TEXT) AS identity
       FROM ${quoteSqlIdentifier(tableName)}
       WHERE ${predicate}
       ORDER BY ${quoteSqlIdentifier(sampleColumn)}
       LIMIT 1`,
    )
    .get(...bindings) as { readonly identity: string | null } | undefined;
  collector.addAggregate("unclassified_foreign_key_root", count, {
    source: tableName,
    identity: sample?.identity ?? tableName,
    relation: `matching_inbound_fk:${referencedTable}`,
  });
};

const analyzeStoreIntegrity = (
  database: Database.Database,
  projectId: string,
  closure: GcClosure,
  collector: BlockerCollector,
): void => {
  const foreignKeyViolations = database.pragma(
    "foreign_key_check",
  ) as readonly {
    readonly table: string;
    readonly rowid: number | null;
    readonly parent: string;
    readonly fkid: number;
  }[];
  for (const violation of foreignKeyViolations) {
    collector.add("store_foreign_key_corrupt", {
      source: violation.table,
      identity: String(violation.rowid ?? violation.fkid),
      relation: `missing_parent:${violation.parent}`,
    });
  }
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as readonly { readonly name: string }[];
  for (const table of tables) {
    if (KNOWN_INBOUND_AUTHORITY_TABLES.has(table.name)) continue;
    const foreignKeys = database
      .prepare(`PRAGMA foreign_key_list(${quoteSqlIdentifier(table.name)})`)
      .all() as readonly ForeignKeyListRow[];
    const groups = new Map<number, ForeignKeyListRow[]>();
    for (const foreignKey of foreignKeys) {
      if (
        foreignKey.table !== "blocks" &&
        foreignKey.table !== "documents" &&
        foreignKey.table !== "block_documents"
      ) {
        continue;
      }
      const current = groups.get(foreignKey.id) ?? [];
      current.push(foreignKey);
      groups.set(foreignKey.id, current);
    }
    for (const foreignKey of groups.values()) {
      analyzeUnknownInboundForeignKey(
        database,
        projectId,
        table.name,
        foreignKey,
        closure,
        collector,
      );
    }
  }
};

const planCandidate = (
  database: Database.Database,
  projectId: string,
  rootBlockId: string,
  retainedNewestBlockIds: ReadonlySet<string>,
  policy: BlockRetentionGcPolicy,
): BlockRetentionGcCandidate => {
  const collector = createBlockerCollector(
    policy.maxEvidenceSamplesPerBlocker,
  );
  const root = readBlock(database, rootBlockId);
  if (!root) {
    collector.add("block_not_found", {
      source: "blocks",
      identity: rootBlockId,
      relation: "missing_root",
    });
    const blockers = collector.finish();
    return {
      rootBlockId,
      projectId,
      blockType: null,
      deletedAt: null,
      closureBlockIds: [],
      ownedDocumentIds: [],
      collectible: false,
      blockers,
    };
  }
  if (root.project_id !== projectId) {
    collector.add("project_scope_mismatch", {
      source: "blocks",
      identity: root.id,
      relation: "another_project",
      status: root.project_id,
    });
  }
  if (root.lifecycle !== "deleted") {
    collector.add("block_not_deleted", {
      source: "blocks",
      identity: root.id,
      relation: "lifecycle",
      status: root.lifecycle,
    });
  }
  const closure =
    root.project_id === projectId && root.lifecycle === "deleted"
      ? buildGcClosure(database, projectId, root, collector)
      : {
          blockIds: new Set([root.id]),
          documentIds: new Set<string>(),
          ownerBlockIds: new Set<string>(),
        };
  for (const blockId of closure.blockIds) {
    if (!retainedNewestBlockIds.has(blockId)) continue;
    collector.add("policy_newest_tombstone", {
      source: "blocks",
      identity: blockId,
      relation: "newest_count_retention",
    });
  }
  const databaseViewIds = readDatabaseViewIds(
    database,
    projectId,
    closure.blockIds,
  );
  analyzeStoreIntegrity(database, projectId, closure, collector);
  analyzeDocumentProjectionRoots(
    database,
    closure,
    databaseViewIds,
    collector,
  );
  analyzeRecoveryRoots(database, projectId, closure, collector);
  analyzeHistoricalDocumentVersionRoots(
    database,
    closure,
    databaseViewIds,
    policy,
    collector,
  );
  analyzeImmutableEvidenceRoots(database, projectId, closure, collector);
  analyzeRelationalRoots(
    database,
    projectId,
    closure,
    databaseViewIds,
    collector,
  );
  const blockers = collector.finish();
  return {
    rootBlockId,
    projectId,
    blockType: root.type,
    deletedAt: root.updated_at,
    closureBlockIds: [...closure.blockIds].sort(),
    ownedDocumentIds: [...closure.documentIds].sort(),
    collectible: blockers.length === 0,
    blockers,
  };
};

export const planBlockRetentionGc = (
  database: Database.Database,
  input: PlanBlockRetentionGcInput,
): BlockRetentionGcPlan => {
  const projectId = requireIdentity(input.projectId, "projectId");
  const policy = normalizePolicy(input.policy);
  const project = database
    .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
    .get(projectId);
  if (!project) throw new TypeError(`Project does not exist: ${projectId}`);
  const deletedBlockCount = (
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM blocks WHERE project_id = ? AND lifecycle = 'deleted'",
      )
      .get(projectId) as { readonly count: number }
  ).count;
  const retainedNewestBlockIds = (
    database
      .prepare(
        `
        SELECT id FROM blocks
        WHERE project_id = ? AND lifecycle = 'deleted'
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      )
      .all(projectId, policy.retainNewestDeletedBlocks) as readonly {
      readonly id: string;
    }[]
  ).map((row) => row.id);
  const requested = input.rootBlockIds
    ? uniqueIdentities(input.rootBlockIds, "rootBlockIds", policy.maxCandidates)
    : (
        database
          .prepare(
            `
            SELECT id FROM blocks
            WHERE project_id = ? AND lifecycle = 'deleted'
              AND id NOT IN (
                SELECT id FROM blocks
                WHERE project_id = ? AND lifecycle = 'deleted'
                ORDER BY updated_at DESC, id DESC
                LIMIT ?
              )
            ORDER BY updated_at, id
            LIMIT ?
          `,
          )
          .all(
            projectId,
            projectId,
            policy.retainNewestDeletedBlocks,
            policy.maxCandidates,
          ) as readonly { readonly id: string }[]
      ).map((row) => row.id);
  const retained = new Set(retainedNewestBlockIds);
  return {
    version: BLOCK_RETENTION_GC_POLICY_VERSION,
    projectId,
    policy,
    deletedBlockCount,
    retainedNewestBlockIds,
    candidates: requested.map((rootBlockId) =>
      planCandidate(database, projectId, rootBlockId, retained, policy),
    ),
  };
};
