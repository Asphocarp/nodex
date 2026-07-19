import type Database from "better-sqlite3";
import {
  PAGE_HISTORY_CONTRACT_VERSION,
  DEFAULT_PAGE_HISTORY_PAGE_SIZE,
  MAX_PAGE_HISTORY_PAGE_SIZE,
  type PageBlockMutationHistoryEntry,
  type PageBlockRelocationHistoryEntry,
  type PageDocumentVersionHistoryEntry,
  type PageHistoryCursor,
  type PageHistoryDisplay,
  type PageHistoryEntry,
  type PageHistoryEvidence,
  type PageHistoryPage,
  type ListPageHistoryRequest,
} from "../../shared/page-history";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";

const MAX_SCOPE_ID_LENGTH = 512;
const MAX_SCOPE_ARRAY_BYTES = 256 * 1024;
const MAX_EVIDENCE_JSON_BYTES = 256 * 1024;
const MAX_EVIDENCE_DEPTH = 16;
const MAX_EVIDENCE_NODES = 2_048;
const MAX_EVIDENCE_KEY_LENGTH = 256;
const MAX_EVIDENCE_STRING_LENGTH = 16_384;
const MAX_IDENTIFIER_ARRAY_LENGTH = 1_024;
const MAX_ACTOR_LABEL_LENGTH = 120;

export type PageHistoryStoreErrorCode =
  "invalid_page_history_request" | "page_not_found" | "page_history_corrupt";

export class PageHistoryStoreError extends Error {
  readonly code: PageHistoryStoreErrorCode;

  constructor(code: PageHistoryStoreErrorCode, message: string) {
    super(message);
    this.name = "PageHistoryStoreError";
    this.code = code;
  }
}

interface PageScopeRow {
  readonly block_id: string;
  readonly block_type: string;
  readonly library_id: string;
  readonly storage_project_id: string;
  readonly document_id: string | null;
  readonly document_project_id: string | null;
  readonly document_generation: number | null;
  readonly document_readiness: string | null;
}

interface PageScope {
  readonly libraryId: string;
  readonly storageProjectId: string;
  readonly pageId: string;
  readonly documentId: string;
  readonly documentGeneration: number;
}

interface StoredVersionRow {
  readonly version_id: string;
  readonly document_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly base_head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly cause: string;
  readonly label: string | null;
  readonly actor_json: string | null;
  readonly revision_kind: string;
  readonly source_mutation_id: string | null;
  readonly source_change_seq: number | null;
  readonly pinned: number;
  readonly checkpoint_hash: string;
  readonly byte_length: number;
  readonly created_at: string;
}

interface StoredChangeRow {
  readonly seq: number;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly kind: string;
  readonly operation_id: string | null;
  readonly block_ids_json: string | null;
  readonly document_ids_json: string | null;
  readonly database_block_ids_json: string | null;
  readonly payload_json: string | null;
  readonly committed_at: string;
  readonly mutation_id: string | null;
  readonly mutation_project_id: string | null;
  readonly mutation_store_epoch: string | null;
  readonly mutation_kind: string | null;
  readonly mutation_actor_json: string | null;
  readonly mutation_request_hash: string | null;
  readonly mutation_target_block_ids_json: string | null;
  readonly mutation_document_ids_json: string | null;
  readonly mutation_database_block_ids_json: string | null;
  readonly mutation_field_intents_json: string | null;
  readonly mutation_outcome: string | null;
  readonly mutation_change_log_seq: number | null;
  readonly relocation_id: string | null;
  readonly relocation_project_id: string | null;
  readonly relocation_store_epoch: string | null;
  readonly relocation_status: string | null;
  readonly relocation_source_document_id: string | null;
  readonly relocation_target_document_id: string | null;
  readonly relocation_root_block_ids_json: string | null;
  readonly relocation_result_json: string | null;
  readonly relocation_change_log_seq: number | null;
  readonly relocation_committed_at: string | null;
}

type PortableObject = Readonly<Record<string, unknown>>;

type ParsedEvidence<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: "missing_ledger" | "malformed_evidence";
    };

interface MutationEvidence {
  readonly mutationId: string;
  readonly mutationKind: string;
  readonly actorLabel: string | null;
  readonly affectedBlockCount: number;
  readonly fieldIntentCount: number;
  readonly payload: PortableObject;
}

interface RelocationEvidence {
  readonly relocationId: string;
  readonly direction: PageBlockRelocationHistoryEntry["direction"];
  readonly movedBlockCount: number;
}

const requireBoundedString = (value: string, field: string): string => {
  if (
    value.length > 0 &&
    value.length <= MAX_SCOPE_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new PageHistoryStoreError(
    "invalid_page_history_request",
    `${field} must be a non-empty bounded string`,
  );
};

const isCanonicalTimestamp = (value: string): boolean =>
  value.length <= 256 &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

const requireCanonicalTimestamp = (value: string, field: string): string => {
  if (isCanonicalTimestamp(value)) return value;
  throw new PageHistoryStoreError(
    "invalid_page_history_request",
    `${field} must be a canonical ISO timestamp`,
  );
};

const requireStoredTimestamp = (value: string, field: string): string => {
  if (isCanonicalTimestamp(value)) return value;
  throw new PageHistoryStoreError(
    "page_history_corrupt",
    `${field} is not a canonical ISO timestamp`,
  );
};

const requireSafeInteger = (
  value: number,
  field: string,
  minimum: number,
): number => {
  if (Number.isSafeInteger(value) && value >= minimum) return value;
  throw new PageHistoryStoreError(
    "invalid_page_history_request",
    `${field} must be a safe integer >= ${minimum}`,
  );
};

const isBoundedStoredString = (
  value: string,
  maximumLength = MAX_SCOPE_ID_LENGTH,
): boolean =>
  value.length > 0 && value.length <= maximumLength && value === value.trim();

const truncateDisplay = (value: string, maximumLength: number): string => {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, maximumLength - 1)}…`;
};

const isPortableWithinBounds = (root: unknown): boolean => {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value: root, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_EVIDENCE_NODES || current.depth > MAX_EVIDENCE_DEPTH) {
      return false;
    }
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (typeof current.value === "string") {
      if (current.value.length > MAX_EVIDENCE_STRING_LENGTH) return false;
      continue;
    }
    if (typeof current.value !== "object") return false;
    if (Array.isArray(current.value)) {
      for (const value of current.value) {
        pending.push({ value, depth: current.depth + 1 });
      }
      continue;
    }
    const entries = Object.entries(current.value);
    for (const [key, value] of entries) {
      if (key.length === 0 || key.length > MAX_EVIDENCE_KEY_LENGTH)
        return false;
      pending.push({ value, depth: current.depth + 1 });
    }
  }
  return true;
};

const parseBoundedJson = (serialized: string | null): unknown | null => {
  if (serialized === null) return null;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return isPortableWithinBounds(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const asObject = (value: unknown): PortableObject | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as PortableObject;
};

const asArray = (value: unknown): readonly unknown[] | null =>
  Array.isArray(value) ? value : null;

const parseObject = (serialized: string | null): PortableObject | null =>
  asObject(parseBoundedJson(serialized));

const parseArray = (serialized: string | null): readonly unknown[] | null =>
  asArray(parseBoundedJson(serialized));

const parseStringArray = (
  serialized: string | null,
): readonly string[] | null => {
  const parsed = parseArray(serialized);
  if (!parsed || parsed.length > MAX_IDENTIFIER_ARRAY_LENGTH) return null;
  if (
    !parsed.every(
      (value) =>
        typeof value === "string" &&
        isBoundedStoredString(value, MAX_SCOPE_ID_LENGTH),
    )
  ) {
    return null;
  }
  const strings = parsed as readonly string[];
  return new Set(strings).size === strings.length ? strings : null;
};

const sameStringSet = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
};

const readObjectString = (
  value: PortableObject,
  key: string,
  maximumLength = MAX_SCOPE_ID_LENGTH,
): string | null => {
  const candidate = value[key];
  if (typeof candidate !== "string") return null;
  return isBoundedStoredString(candidate, maximumLength) ? candidate : null;
};

const readActorLabel = (actor: PortableObject): string | null => {
  for (const key of ["displayName", "name", "label", "kind"] as const) {
    const value = actor[key];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    return truncateDisplay(value, MAX_ACTOR_LABEL_LENGTH);
  }
  return null;
};

const unavailableEvidence = (
  reason: Extract<
    PageHistoryEvidence,
    { readonly status: "unavailable" }
  >["reason"],
): PageHistoryEvidence => ({ status: "unavailable", reason });

const unknownDisplay = (
  actorLabel: string | null = null,
): PageHistoryDisplay => ({
  category: "unknown",
  title: "Page change",
  detail: "Stored evidence is unavailable or cannot be displayed safely.",
  actorLabel,
});

const readPageScope = (
  database: Database.Database,
  requestingProjectId: string,
  pageId: string,
): PageScope => {
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId: requestingProjectId,
    resource: { kind: "page", pageId },
    action: "read",
  });
  if (!authorization.allowed) {
    throw new PageHistoryStoreError(
      "page_not_found",
      `Page is not available to Project: ${pageId}`,
    );
  }
  const row = database
    .prepare(
      `
      SELECT
        block.id AS block_id,
        block.type AS block_type,
        page.library_id,
        block.project_id AS storage_project_id,
        ownership.document_id,
        document.project_id AS document_project_id,
        document.generation AS document_generation,
        document.readiness AS document_readiness
      FROM pages page
      INNER JOIN blocks block ON block.id = page.block_id
      LEFT JOIN block_documents ownership
        ON ownership.block_id = block.id
        AND ownership.project_id = block.project_id
      LEFT JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      WHERE block.id = ?
    `,
    )
    .get(pageId) as PageScopeRow | undefined;
  if (!row || row.block_type !== "page") {
    throw new PageHistoryStoreError(
      "page_not_found",
      `Page does not exist: ${pageId}`,
    );
  }
  if (
    row.document_id === null ||
    row.document_project_id !== row.storage_project_id ||
    row.library_id !== authorization.libraryId ||
    row.document_readiness !== "ready" ||
    row.document_generation === null ||
    !Number.isSafeInteger(row.document_generation) ||
    row.document_generation < 1
  ) {
    throw new PageHistoryStoreError(
      "page_history_corrupt",
      `Page ${pageId} has no current ready owned Document`,
    );
  }
  return {
    libraryId: row.library_id,
    storageProjectId: row.storage_project_id,
    pageId,
    documentId: row.document_id,
    documentGeneration: row.document_generation,
  };
};

const normalizeCursor = (
  cursor: PageHistoryCursor | undefined,
): PageHistoryCursor | undefined => {
  if (!cursor) return undefined;
  requireCanonicalTimestamp(cursor.occurredAt, "before.occurredAt");
  if (cursor.source === "document_version") {
    requireBoundedString(cursor.versionId, "before.versionId");
    return cursor;
  }
  if (cursor.source === "change_log") {
    requireSafeInteger(cursor.changeSeq, "before.changeSeq", 1);
    return cursor;
  }
  throw new PageHistoryStoreError(
    "invalid_page_history_request",
    "before.source is unsupported",
  );
};

const readVersionRows = (
  database: Database.Database,
  scope: PageScope,
  cursor: PageHistoryCursor | undefined,
  limit: number,
): readonly StoredVersionRow[] => {
  const beforeSql = (() => {
    if (!cursor) return { sql: "", parameters: [] as readonly unknown[] };
    if (cursor.source === "change_log") {
      return {
        sql: "AND version.created_at < ?",
        parameters: [cursor.occurredAt] as readonly unknown[],
      };
    }
    return {
      sql: `AND (
        version.created_at < ?
        OR (version.created_at = ? AND version.version_id < ?)
      )`,
      parameters: [
        cursor.occurredAt,
        cursor.occurredAt,
        cursor.versionId,
      ] as readonly unknown[],
    };
  })();
  return database
    .prepare(
      `
      SELECT
        version.version_id, version.document_id, version.project_id,
        version.generation, version.base_head_seq, version.schema_key,
        version.schema_version, version.cause, version.label,
        version.revision_kind, version.source_mutation_id,
        version.source_change_seq, version.pinned,
        CASE
          WHEN length(CAST(version.actor_json AS BLOB)) <= ${MAX_EVIDENCE_JSON_BYTES}
          THEN version.actor_json
          ELSE NULL
        END AS actor_json,
        version.checkpoint_hash, version.byte_length, version.created_at
      FROM document_versions version
      WHERE version.project_id = ? AND version.document_id = ?
      ${beforeSql.sql}
      ORDER BY version.created_at DESC, version.version_id DESC
      LIMIT ?
    `,
    )
    .all(
      scope.storageProjectId,
      scope.documentId,
      ...beforeSql.parameters,
      limit,
    ) as readonly StoredVersionRow[];
};

const boundedJsonColumn = (column: string, maximumBytes: number): string => `
  CASE
    WHEN length(CAST(${column} AS BLOB)) <= ${maximumBytes}
    THEN ${column}
    ELSE NULL
  END
`;

const readChangeRows = (
  database: Database.Database,
  scope: PageScope,
  cursor: PageHistoryCursor | undefined,
  limit: number,
): readonly StoredChangeRow[] => {
  const beforeSql = (() => {
    if (!cursor) return { sql: "", parameters: [] as readonly unknown[] };
    if (cursor.source === "document_version") {
      return {
        sql: "AND change.committed_at <= ?",
        parameters: [cursor.occurredAt] as readonly unknown[],
      };
    }
    return {
      sql: `AND (
        change.committed_at < ?
        OR (change.committed_at = ? AND change.seq < ?)
      )`,
      parameters: [
        cursor.occurredAt,
        cursor.occurredAt,
        cursor.changeSeq,
      ] as readonly unknown[],
    };
  })();
  const scopedBlockIds = `CASE
    WHEN length(CAST(change.block_ids_json AS BLOB)) <= ${MAX_SCOPE_ARRAY_BYTES}
      AND json_valid(change.block_ids_json)
    THEN change.block_ids_json
    ELSE '[]'
  END`;
  const scopedDocumentIds = `CASE
    WHEN length(CAST(change.document_ids_json AS BLOB)) <= ${MAX_SCOPE_ARRAY_BYTES}
      AND json_valid(change.document_ids_json)
    THEN change.document_ids_json
    ELSE '[]'
  END`;
  return database
    .prepare(
      `
      SELECT
        change.seq, change.project_id, change.store_epoch, change.kind,
        change.operation_id,
        ${boundedJsonColumn("change.block_ids_json", MAX_SCOPE_ARRAY_BYTES)}
          AS block_ids_json,
        ${boundedJsonColumn("change.document_ids_json", MAX_SCOPE_ARRAY_BYTES)}
          AS document_ids_json,
        ${boundedJsonColumn("change.database_block_ids_json", MAX_SCOPE_ARRAY_BYTES)}
          AS database_block_ids_json,
        ${boundedJsonColumn("change.payload_json", MAX_EVIDENCE_JSON_BYTES)}
          AS payload_json,
        change.committed_at,
        mutation.mutation_id,
        mutation.project_id AS mutation_project_id,
        mutation.store_epoch AS mutation_store_epoch,
        mutation.mutation_kind,
        ${boundedJsonColumn("mutation.actor_json", MAX_EVIDENCE_JSON_BYTES)}
          AS mutation_actor_json,
        mutation.request_hash AS mutation_request_hash,
        ${boundedJsonColumn("mutation.target_block_ids_json", MAX_SCOPE_ARRAY_BYTES)}
          AS mutation_target_block_ids_json,
        ${boundedJsonColumn("mutation.affected_document_ids_json", MAX_SCOPE_ARRAY_BYTES)}
          AS mutation_document_ids_json,
        ${boundedJsonColumn("mutation.affected_database_block_ids_json", MAX_SCOPE_ARRAY_BYTES)}
          AS mutation_database_block_ids_json,
        ${boundedJsonColumn("mutation.field_intents_json", MAX_EVIDENCE_JSON_BYTES)}
          AS mutation_field_intents_json,
        mutation.outcome AS mutation_outcome,
        mutation.change_log_seq AS mutation_change_log_seq,
        relocation.id AS relocation_id,
        relocation.project_id AS relocation_project_id,
        relocation.store_epoch AS relocation_store_epoch,
        relocation.status AS relocation_status,
        relocation.source_document_id AS relocation_source_document_id,
        relocation.target_document_id AS relocation_target_document_id,
        ${boundedJsonColumn("relocation.root_block_ids_json", MAX_SCOPE_ARRAY_BYTES)}
          AS relocation_root_block_ids_json,
        ${boundedJsonColumn("relocation.result_json", MAX_EVIDENCE_JSON_BYTES)}
          AS relocation_result_json,
        relocation.change_log_seq AS relocation_change_log_seq,
        relocation.committed_at AS relocation_committed_at
      FROM change_log change
      LEFT JOIN block_mutations mutation
        ON mutation.change_log_seq = change.seq
        AND mutation.project_id = change.project_id
      LEFT JOIN block_relocations relocation
        ON relocation.change_log_seq = change.seq
        AND relocation.project_id = change.project_id
      WHERE change.project_id = ?
        AND change.kind IN ('block_mutation', 'block_relocation')
        AND NOT EXISTS (
          SELECT 1
          FROM document_versions version
          WHERE version.project_id = change.project_id
            AND version.document_id = ?
            AND version.source_change_seq = change.seq
        )
        AND (
          EXISTS (
            SELECT 1 FROM json_each(${scopedBlockIds}) scoped_block
            WHERE scoped_block.type = 'text' AND scoped_block.value = ?
          )
          OR EXISTS (
            SELECT 1 FROM json_each(${scopedDocumentIds}) scoped_document
            WHERE scoped_document.type = 'text' AND scoped_document.value = ?
          )
        )
      ${beforeSql.sql}
      ORDER BY change.committed_at DESC, change.seq DESC
      LIMIT ?
    `,
    )
    .all(
      scope.storageProjectId,
      scope.documentId,
      scope.pageId,
      scope.documentId,
      ...beforeSql.parameters,
      limit,
    ) as readonly StoredChangeRow[];
};

const decodeVersionEntry = (
  row: StoredVersionRow,
  scope: PageScope,
): PageDocumentVersionHistoryEntry => {
  const occurredAt = requireStoredTimestamp(
    row.created_at,
    `Document version ${row.version_id} timestamp`,
  );
  if (
    !isBoundedStoredString(row.version_id) ||
    row.document_id !== scope.documentId ||
    row.project_id !== scope.storageProjectId ||
    !Number.isSafeInteger(row.generation) ||
    row.generation < 1 ||
    !Number.isSafeInteger(row.base_head_seq) ||
    row.base_head_seq < 0 ||
    !isBoundedStoredString(row.schema_key, 128) ||
    !Number.isSafeInteger(row.schema_version) ||
    row.schema_version < 1 ||
    !isBoundedStoredString(row.cause, 128) ||
    (row.label !== null && row.label.length > 512) ||
    ![
      "automatic",
      "manual",
      "operation",
      "restore",
      "safety",
    ].includes(row.revision_kind) ||
    (row.source_mutation_id !== null &&
      !isBoundedStoredString(row.source_mutation_id)) ||
    (row.source_change_seq !== null &&
      (!Number.isSafeInteger(row.source_change_seq) ||
        row.source_change_seq < 1)) ||
    (row.pinned !== 0 && row.pinned !== 1) ||
    !/^[0-9a-f]{64}$/u.test(row.checkpoint_hash) ||
    !Number.isSafeInteger(row.byte_length) ||
    row.byte_length < 1
  ) {
    throw new PageHistoryStoreError(
      "page_history_corrupt",
      `Document version ${row.version_id} has invalid immutable metadata`,
    );
  }
  const actor = parseObject(row.actor_json);
  const actorLabel = actor ? readActorLabel(actor) : null;
  const evidence: PageHistoryEvidence = actor
    ? { status: "verified" }
    : unavailableEvidence("malformed_evidence");
  const revisionKind = row.revision_kind as PageDocumentVersionHistoryEntry[
    "versionMetadata"
  ]["revisionKind"];
  const display = (() => {
    if (revisionKind === "automatic") {
      return {
        category: "content" as const,
        title: "Edited Page",
        detail: "Automatic revision",
      };
    }
    if (revisionKind === "operation") {
      return {
        category: "content" as const,
        title: "Edited Page content",
        detail: row.label ?? row.cause,
      };
    }
    if (revisionKind === "restore") {
      return {
        category: "content" as const,
        title: row.cause === "before_restore"
          ? "Before restore"
          : "Restored Page content",
        detail: row.label ?? row.cause,
      };
    }
    if (revisionKind === "safety") {
      return {
        category: "checkpoint" as const,
        title: "Before editing",
        detail: "Safety revision",
      };
    }
    return {
      category: "checkpoint" as const,
      title: row.label ?? "Saved Page revision",
      detail: row.label ? "Named revision" : "Manual revision",
    };
  })();
  return {
    id: `document-version:${row.version_id}`,
    kind: "document_version",
    libraryId: scope.libraryId,
    pageId: scope.pageId,
    documentId: scope.documentId,
    occurredAt,
    display: { ...display, actorLabel },
    evidence,
    recovery:
      row.generation === scope.documentGeneration
        ? {
            kind: "restore_document_version",
            documentId: scope.documentId,
            versionId: row.version_id,
          }
        : {
            kind: "unavailable",
            reason: "document_generation_changed",
          },
    versionMetadata: {
      versionId: row.version_id,
      generation: row.generation,
      baseHeadSeq: row.base_head_seq,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
      cause: row.cause,
      label: row.label,
      revisionKind,
      sourceMutationId: row.source_mutation_id,
      sourceChangeSeq: row.source_change_seq,
      pinned: row.pinned === 1,
      checkpointHash: row.checkpoint_hash,
      byteLength: row.byte_length,
    },
  };
};

const decodeMutationEvidence = (
  row: StoredChangeRow,
): ParsedEvidence<MutationEvidence> => {
  if (row.mutation_id === null) return { ok: false, reason: "missing_ledger" };
  const actor = parseObject(row.mutation_actor_json);
  const payload = parseObject(row.payload_json);
  const fieldIntents = parseArray(row.mutation_field_intents_json);
  const changeBlockIds = parseStringArray(row.block_ids_json);
  const changeDocumentIds = parseStringArray(row.document_ids_json);
  const changeDatabaseIds = parseStringArray(row.database_block_ids_json);
  const mutationBlockIds = parseStringArray(row.mutation_target_block_ids_json);
  const mutationDocumentIds = parseStringArray(row.mutation_document_ids_json);
  const mutationDatabaseIds = parseStringArray(
    row.mutation_database_block_ids_json,
  );
  if (
    row.operation_id === null ||
    row.mutation_id !== row.operation_id ||
    row.mutation_project_id !== row.project_id ||
    row.mutation_store_epoch !== row.store_epoch ||
    row.mutation_outcome !== "committed" ||
    row.mutation_change_log_seq !== row.seq ||
    row.mutation_kind === null ||
    !isBoundedStoredString(row.mutation_kind, 128) ||
    row.mutation_request_hash === null ||
    !/^[0-9a-f]{64}$/u.test(row.mutation_request_hash) ||
    !actor ||
    !payload ||
    !fieldIntents ||
    !changeBlockIds ||
    !changeDocumentIds ||
    !changeDatabaseIds ||
    !mutationBlockIds ||
    !mutationDocumentIds ||
    !mutationDatabaseIds ||
    !sameStringSet(changeBlockIds, mutationBlockIds) ||
    !sameStringSet(changeDocumentIds, mutationDocumentIds) ||
    !sameStringSet(changeDatabaseIds, mutationDatabaseIds) ||
    readObjectString(payload, "requestHash", 64) !== row.mutation_request_hash
  ) {
    return { ok: false, reason: "malformed_evidence" };
  }
  return {
    ok: true,
    value: {
      mutationId: row.mutation_id,
      mutationKind: row.mutation_kind,
      actorLabel: readActorLabel(actor),
      affectedBlockCount: changeBlockIds.length,
      fieldIntentCount: fieldIntents.length,
      payload,
    },
  };
};

const readOperationKinds = (payload: PortableObject): readonly string[] => {
  const value = payload.operationKinds;
  if (!Array.isArray(value) || value.length > 256) return [];
  if (
    !value.every(
      (entry) => typeof entry === "string" && isBoundedStoredString(entry, 128),
    )
  ) {
    return [];
  }
  return value as readonly string[];
};

const mutationDisplay = (evidence: MutationEvidence): PageHistoryDisplay => {
  const base = { actorLabel: evidence.actorLabel };
  if (evidence.mutationKind === "page_lifecycle") {
    const operation = readObjectString(evidence.payload, "operation", 128);
    const labels: Readonly<
      Record<string, readonly [string, PageHistoryDisplay["category"]]>
    > = {
      create_page: ["Created Page", "lifecycle"],
      archive_page: ["Archived Page", "lifecycle"],
      unarchive_page: ["Unarchived Page", "lifecycle"],
      delete_page: ["Deleted Page", "lifecycle"],
      restore_page: ["Restored Page", "lifecycle"],
      move_page_in_library: ["Reordered Page in Library", "location"],
    };
    const label = operation ? labels[operation] : undefined;
    if (!label) return unknownDisplay(evidence.actorLabel);
    return { ...base, category: label[1], title: label[0], detail: null };
  }
  if (evidence.mutationKind === "property_batch") {
    return {
      ...base,
      category: "property",
      title: "Updated Page properties",
      detail: `${evidence.fieldIntentCount} field intent${
        evidence.fieldIntentCount === 1 ? "" : "s"
      }`,
    };
  }
  if (evidence.mutationKind === "database_operation") {
    const operationKinds = readOperationKinds(evidence.payload);
    if (
      operationKinds.some(
        (kind) => kind === "position_page" || kind === "position_pages",
      )
    ) {
      return {
        ...base,
        category: "database",
        title: "Reordered Page in a database View",
        detail: null,
      };
    }
    if (
      operationKinds.some((kind) =>
        kind === "transfer_page" || kind === "transfer_membership"
      )
    ) {
      return {
        ...base,
        category: "database",
        title: "Changed Page database membership",
        detail: null,
      };
    }
    return {
      ...base,
      category: "database",
      title: "Updated Page database values",
      detail: `${evidence.fieldIntentCount} field intent${
        evidence.fieldIntentCount === 1 ? "" : "s"
      }`,
    };
  }
  if (evidence.mutationKind === "document_operation_batch") {
    return {
      ...base,
      category: "content",
      title: "Edited Page content",
      detail: null,
    };
  }
  if (evidence.mutationKind === "replace_document_from_nfm") {
    return {
      ...base,
      category: "content",
      title: "Replaced Page content from NFM",
      detail: null,
    };
  }
  return unknownDisplay(evidence.actorLabel);
};

const decodeMutationEntry = (
  row: StoredChangeRow,
  scope: PageScope,
): PageBlockMutationHistoryEntry => {
  const evidence = decodeMutationEvidence(row);
  const occurredAt = requireStoredTimestamp(
    row.committed_at,
    `Change ${row.seq} timestamp`,
  );
  if (!Number.isSafeInteger(row.seq) || row.seq < 1) {
    throw new PageHistoryStoreError(
      "page_history_corrupt",
      "Change-log sequence is invalid",
    );
  }
  if (!evidence.ok) {
    return {
      id: `change:${row.seq}`,
      kind: "block_mutation",
      libraryId: scope.libraryId,
      pageId: scope.pageId,
      documentId: scope.documentId,
      occurredAt,
      display: unknownDisplay(),
      evidence: unavailableEvidence(evidence.reason),
      recovery: { kind: "unavailable", reason: "insufficient_evidence" },
      changeSeq: row.seq,
      mutationId: null,
      mutationKind: null,
      affectedBlockCount: null,
      fieldIntentCount: null,
    };
  }
  return {
    id: `change:${row.seq}`,
    kind: "block_mutation",
    libraryId: scope.libraryId,
    pageId: scope.pageId,
    documentId: scope.documentId,
    occurredAt,
    display: mutationDisplay(evidence.value),
    evidence: { status: "verified" },
    recovery: { kind: "unavailable", reason: "no_inverse_contract" },
    changeSeq: row.seq,
    mutationId: evidence.value.mutationId,
    mutationKind: evidence.value.mutationKind,
    affectedBlockCount: evidence.value.affectedBlockCount,
    fieldIntentCount: evidence.value.fieldIntentCount,
  };
};

const decodeRelocationEvidence = (
  row: StoredChangeRow,
  scope: PageScope,
): ParsedEvidence<RelocationEvidence> => {
  if (row.relocation_id === null)
    return { ok: false, reason: "missing_ledger" };
  const changeBlockIds = parseStringArray(row.block_ids_json);
  const changeDocumentIds = parseStringArray(row.document_ids_json);
  const rootBlockIds = parseStringArray(row.relocation_root_block_ids_json);
  const result = parseObject(row.relocation_result_json);
  if (
    row.operation_id === null ||
    row.relocation_id !== row.operation_id ||
    row.relocation_project_id !== row.project_id ||
    row.relocation_store_epoch !== row.store_epoch ||
    row.relocation_status !== "committed" ||
    row.relocation_change_log_seq !== row.seq ||
    row.relocation_committed_at !== row.committed_at ||
    row.relocation_source_document_id === null ||
    row.relocation_target_document_id === null ||
    !changeBlockIds ||
    !changeDocumentIds ||
    !rootBlockIds ||
    !result ||
    !changeDocumentIds.includes(row.relocation_source_document_id) ||
    !changeDocumentIds.includes(row.relocation_target_document_id) ||
    !rootBlockIds.every((blockId) => changeBlockIds.includes(blockId))
  ) {
    return { ok: false, reason: "malformed_evidence" };
  }
  const sourceIsPage = row.relocation_source_document_id === scope.documentId;
  const targetIsPage = row.relocation_target_document_id === scope.documentId;
  const direction: PageBlockRelocationHistoryEntry["direction"] =
    sourceIsPage && targetIsPage
      ? "within_page"
      : sourceIsPage
        ? "out_of_page"
        : targetIsPage
          ? "into_page"
          : "unknown";
  return {
    ok: true,
    value: {
      relocationId: row.relocation_id,
      direction,
      movedBlockCount: changeBlockIds.length,
    },
  };
};

const relocationDisplay = (
  evidence: RelocationEvidence,
): PageHistoryDisplay => {
  const title = (() => {
    if (evidence.direction === "into_page") return "Moved blocks into Page";
    if (evidence.direction === "out_of_page") return "Moved blocks out of Page";
    if (evidence.direction === "within_page") return "Moved blocks within Page";
    return "Moved Page blocks";
  })();
  return {
    category: "location",
    title,
    detail: `${evidence.movedBlockCount} block${
      evidence.movedBlockCount === 1 ? "" : "s"
    }`,
    actorLabel: null,
  };
};

const decodeRelocationEntry = (
  row: StoredChangeRow,
  scope: PageScope,
): PageBlockRelocationHistoryEntry => {
  const evidence = decodeRelocationEvidence(row, scope);
  const occurredAt = requireStoredTimestamp(
    row.committed_at,
    `Relocation change ${row.seq} timestamp`,
  );
  if (!Number.isSafeInteger(row.seq) || row.seq < 1) {
    throw new PageHistoryStoreError(
      "page_history_corrupt",
      "Relocation change-log sequence is invalid",
    );
  }
  if (!evidence.ok) {
    return {
      id: `change:${row.seq}`,
      kind: "block_relocation",
      libraryId: scope.libraryId,
      pageId: scope.pageId,
      documentId: scope.documentId,
      occurredAt,
      display: unknownDisplay(),
      evidence: unavailableEvidence(evidence.reason),
      recovery: { kind: "unavailable", reason: "insufficient_evidence" },
      changeSeq: row.seq,
      relocationId: null,
      direction: "unknown",
      movedBlockCount: null,
    };
  }
  return {
    id: `change:${row.seq}`,
    kind: "block_relocation",
    libraryId: scope.libraryId,
    pageId: scope.pageId,
    documentId: scope.documentId,
    occurredAt,
    display: relocationDisplay(evidence.value),
    evidence: { status: "verified" },
    recovery: { kind: "unavailable", reason: "no_inverse_contract" },
    changeSeq: row.seq,
    relocationId: evidence.value.relocationId,
    direction: evidence.value.direction,
    movedBlockCount: evidence.value.movedBlockCount,
  };
};

const decodeChangeEntry = (
  row: StoredChangeRow,
  scope: PageScope,
): PageBlockMutationHistoryEntry | PageBlockRelocationHistoryEntry => {
  if (row.project_id !== scope.storageProjectId) {
    throw new PageHistoryStoreError(
      "page_history_corrupt",
      `Change ${row.seq} escaped its Page storage scope`,
    );
  }
  if (row.kind === "block_mutation") return decodeMutationEntry(row, scope);
  if (row.kind === "block_relocation") return decodeRelocationEntry(row, scope);
  throw new PageHistoryStoreError(
    "page_history_corrupt",
    `Change ${row.seq} has an unsupported kind`,
  );
};

const entrySourceRank = (entry: PageHistoryEntry): number =>
  entry.kind === "document_version" ? 1 : 0;

const compareEntries = (
  left: PageHistoryEntry,
  right: PageHistoryEntry,
): number => {
  const timestampOrder = right.occurredAt.localeCompare(left.occurredAt);
  if (timestampOrder !== 0) return timestampOrder;
  const rankOrder = entrySourceRank(right) - entrySourceRank(left);
  if (rankOrder !== 0) return rankOrder;
  if (left.kind === "document_version" && right.kind === "document_version") {
    return right.versionMetadata.versionId.localeCompare(
      left.versionMetadata.versionId,
    );
  }
  if (left.kind !== "document_version" && right.kind !== "document_version") {
    return right.changeSeq - left.changeSeq;
  }
  return 0;
};

const cursorForEntry = (entry: PageHistoryEntry): PageHistoryCursor => {
  if (entry.kind === "document_version") {
    return {
      occurredAt: entry.occurredAt,
      source: "document_version",
      versionId: entry.versionMetadata.versionId,
    };
  }
  return {
    occurredAt: entry.occurredAt,
    source: "change_log",
    changeSeq: entry.changeSeq,
  };
};

const listPageHistoryAtSnapshot = (
  database: Database.Database,
  input: ListPageHistoryRequest,
): PageHistoryPage => {
  if (input.version !== PAGE_HISTORY_CONTRACT_VERSION) {
    throw new PageHistoryStoreError(
      "invalid_page_history_request",
      `Unsupported Page history contract version: ${input.version}`,
    );
  }
  const requestingProjectId = requireBoundedString(
    input.requestingProjectId,
    "requestingProjectId",
  );
  const pageId = requireBoundedString(input.pageId, "pageId");
  const pageSize =
    input.pageSize === undefined
      ? DEFAULT_PAGE_HISTORY_PAGE_SIZE
      : requireSafeInteger(input.pageSize, "pageSize", 1);
  if (pageSize > MAX_PAGE_HISTORY_PAGE_SIZE) {
    throw new PageHistoryStoreError(
      "invalid_page_history_request",
      `pageSize must not exceed ${MAX_PAGE_HISTORY_PAGE_SIZE}`,
    );
  }
  const cursor = normalizeCursor(input.before);
  const scope = readPageScope(database, requestingProjectId, pageId);
  const candidateLimit = pageSize + 1;
  const versions = readVersionRows(database, scope, cursor, candidateLimit).map(
    (row) => decodeVersionEntry(row, scope),
  );
  const changes = readChangeRows(database, scope, cursor, candidateLimit).map(
    (row) => decodeChangeEntry(row, scope),
  );
  const merged = [...versions, ...changes].sort(compareEntries);
  const entries = merged.slice(0, pageSize);
  return {
    version: PAGE_HISTORY_CONTRACT_VERSION,
    libraryId: scope.libraryId,
    pageId,
    documentId: scope.documentId,
    entries,
    nextCursor:
      merged.length > pageSize && entries.length > 0
        ? cursorForEntry(entries[entries.length - 1] as PageHistoryEntry)
        : null,
  };
};

/**
 * A page merges rows from independent immutable ledgers. Keep the Page scope,
 * both source queries, and the source-specific cursor decision on one SQLite
 * snapshot so a concurrent commit cannot appear in the page with a cursor
 * that predates it.
 */
export const listPageHistory = (
  database: Database.Database,
  input: ListPageHistoryRequest,
): PageHistoryPage =>
  database
    .transaction(() => listPageHistoryAtSnapshot(database, input))
    .deferred();
