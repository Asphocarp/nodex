import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  JsonValue,
  RecoveryAction,
  ToolErrorCode,
  ToolFailure,
} from "../../shared/nodex-agent-tools";
import {
  decodeNodexAgentToken,
  mintNodexAgentToken,
  NodexAgentTokenError,
  type NodexAgentTokenKind,
} from "../local-store/nodex-agent-token-codec";

export const NODEX_AGENT_RESPONSE_MAX_BYTES = 256 * 1024;

export class NodexAgentReadError extends Error {
  public constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly recovery: RecoveryAction,
    public readonly details?: ToolFailure["error"]["details"],
  ) {
    super(message);
    this.name = "NodexAgentReadError";
  }
}

export function readFailure(error: unknown): { readonly ok: false; readonly error: ToolFailure["error"] } {
  const normalized = error instanceof NodexAgentReadError
    ? error
    : new NodexAgentReadError(
      "internal_error",
      error instanceof Error ? error.message : "Nodex Agent read failed",
      false,
      "none",
    );
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      recovery: normalized.recovery,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  };
}

export function requireProject(database: Database.Database, projectId: string): string {
  const row = database.prepare("SELECT name FROM projects WHERE id = ? LIMIT 1")
    .get(projectId) as { readonly name: string } | undefined;
  if (row) return row.name;
  throw new NodexAgentReadError(
    "not_found",
    `Project ${projectId} was not found`,
    false,
    "start_new_task",
    { resourceId: projectId, domainCode: "project_not_found" },
  );
}

export function readProjectChangeLogSeq(
  database: Database.Database,
  projectId: string,
): number {
  const row = database.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log WHERE project_id = ?",
  ).get(projectId) as { readonly seq: number };
  return row.seq;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function nodexAgentFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function parseJsonValue(value: string, label: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    throw new NodexAgentReadError(
      "internal_error",
      `${label} contains invalid JSON`,
      false,
      "none",
      { domainCode: "corrupt_json" },
    );
  }
}

export function mintRevision(
  database: Database.Database,
  input: {
    readonly kind: Exclude<NodexAgentTokenKind, "cursor">;
    readonly projectId: string;
    readonly subject: readonly string[];
    readonly state: Readonly<Record<string, JsonValue>>;
  },
): string {
  return mintNodexAgentToken(database, input);
}

export function readCursorState(
  database: Database.Database,
  input: {
    readonly token: string | undefined;
    readonly projectId: string;
    readonly subject: readonly string[];
    readonly expected: Readonly<Record<string, JsonValue>>;
    readonly recovery?: RecoveryAction;
  },
): { readonly offset: number } {
  if (!input.token) return { offset: 0 };
  try {
    const payload = decodeNodexAgentToken(database, input.token, {
      kind: "cursor",
      projectId: input.projectId,
      subject: input.subject,
    });
    for (const [key, value] of Object.entries(input.expected)) {
      if (JSON.stringify(payload.state[key]) === JSON.stringify(value)) continue;
      throw new NodexAgentReadError(
        "cursor_stale",
        "The cursor no longer matches the requested Project snapshot",
        false,
        input.recovery ?? "restart_search",
      );
    }
    const offset = payload.state.offset;
    if (typeof offset === "number" && Number.isInteger(offset) && offset >= 0) {
      return { offset };
    }
    throw new NodexAgentReadError(
      "cursor_stale",
      "The cursor does not contain a valid page position",
      false,
      input.recovery ?? "restart_search",
    );
  } catch (error) {
    if (error instanceof NodexAgentReadError) throw error;
    if (error instanceof NodexAgentTokenError) {
      throw new NodexAgentReadError(
        "cursor_stale",
        error.message,
        false,
        input.recovery ?? "restart_search",
      );
    }
    throw error;
  }
}

export function mintCursor(
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly subject: readonly string[];
    readonly offset: number;
    readonly state: Readonly<Record<string, JsonValue>>;
  },
): string {
  return mintNodexAgentToken(database, {
    kind: "cursor",
    projectId: input.projectId,
    subject: input.subject,
    state: { ...input.state, offset: input.offset },
  });
}

export function toBlockLocation(row: {
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly parent_block_id?: string | null;
}):
  | { readonly kind: "space" }
  | { readonly kind: "document"; readonly documentId: string; readonly parentBlockId?: string }
  | { readonly kind: "database"; readonly databaseBlockId: string } {
  if (row.location_kind === "space") return { kind: "space" };
  if (row.location_kind === "database" && row.containing_database_id) {
    return { kind: "database", databaseBlockId: row.containing_database_id };
  }
  if (row.location_kind === "document" && row.containing_document_id) {
    return {
      kind: "document",
      documentId: row.containing_document_id,
      ...(row.parent_block_id ? { parentBlockId: row.parent_block_id } : {}),
    };
  }
  throw new NodexAgentReadError(
    "internal_error",
    "Block location coordinates are inconsistent",
    false,
    "none",
    { domainCode: "invalid_block_location" },
  );
}

export function assertResponseSize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") <= NODEX_AGENT_RESPONSE_MAX_BYTES) {
    return;
  }
  throw new NodexAgentReadError(
    "result_too_large",
    "The requested representation exceeds the dynamic-tool response budget",
    false,
    "use_block_representation",
  );
}
