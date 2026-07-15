import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { JsonValue } from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { readNodexAgentSigningKey } from "./nodex-agent-signing-key";

const ETAG_PREFIX = "nxe1";
const ETAG_DIGEST_BYTES = 32;
const ETAG_DIGEST_CHARACTERS = 43;
const ETAG_PATTERN = new RegExp(
  `^${ETAG_PREFIX}\\.[A-Za-z0-9_-]{${ETAG_DIGEST_CHARACTERS}}$`,
);

export const NodexAgentGuardKindSchema = z.enum([
  "title",
  "document_body",
  "document_block",
  "document_subtree",
  "database_value",
  "view_placement",
]);

export type NodexAgentGuardKind = z.infer<typeof NodexAgentGuardKindSchema>;

const NodexAgentEtagStateSchema = z.strictObject({
  kind: NodexAgentGuardKindSchema,
  projectId: z.string().trim().min(1).max(512),
  subject: z.array(z.string().trim().min(1).max(512)).min(1).max(8),
  state: z.record(z.string().min(1).max(128), z.json()),
});

export interface NodexAgentEtagState {
  readonly kind: NodexAgentGuardKind;
  readonly projectId: string;
  readonly subject: readonly string[];
  readonly state: Readonly<Record<string, JsonValue>>;
}

export type NodexAgentEtagErrorCode =
  | "invalid_etag"
  | "etag_mismatch"
  | "etag_unavailable";

export class NodexAgentEtagError extends Error {
  public constructor(
    public readonly code: NodexAgentEtagErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NodexAgentEtagError";
  }
}

function compareCanonicalKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCanonicalKeys(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function requireStoreEpoch(database: Database.Database): string {
  const storeEpoch = readBlockStoreEpoch(database);
  if (storeEpoch) return storeEpoch;
  throw new NodexAgentEtagError(
    "etag_unavailable",
    "Nodex Agent ETag store epoch is unavailable",
  );
}

function requireSigningKey(database: Database.Database): Buffer {
  const key = readNodexAgentSigningKey(database);
  if (key) return key;
  throw new NodexAgentEtagError(
    "etag_unavailable",
    "Nodex Agent ETag signing key is unavailable",
  );
}

function createDigest(
  database: Database.Database,
  input: NodexAgentEtagState,
): Buffer {
  const parsed = NodexAgentEtagStateSchema.parse(input);
  const tuple: JsonValue = [
    1,
    parsed.kind,
    parsed.projectId,
    requireStoreEpoch(database),
    parsed.subject,
    canonicalize(parsed.state),
  ];
  return createHmac("sha256", requireSigningKey(database))
    .update(JSON.stringify(tuple))
    .digest();
}

function decodeSuppliedDigest(etag: string): Buffer {
  if (!ETAG_PATTERN.test(etag)) {
    throw new NodexAgentEtagError(
      "invalid_etag",
      "Nodex Agent ETag is malformed",
    );
  }
  const encodedDigest = etag.slice(ETAG_PREFIX.length + 1);
  const digest = Buffer.from(encodedDigest, "base64url");
  if (
    digest.byteLength === ETAG_DIGEST_BYTES
    && digest.toString("base64url") === encodedDigest
  ) {
    return digest;
  }
  throw new NodexAgentEtagError(
    "invalid_etag",
    "Nodex Agent ETag is malformed",
  );
}

export function mintNodexAgentEtag(
  database: Database.Database,
  input: NodexAgentEtagState,
): string {
  const digest = createDigest(database, input).toString("base64url");
  return `${ETAG_PREFIX}.${digest}`;
}

export function assertNodexAgentEtag(
  database: Database.Database,
  supplied: string,
  expectedCurrent: NodexAgentEtagState,
): void {
  const suppliedDigest = decodeSuppliedDigest(supplied);
  const expectedDigest = createDigest(database, expectedCurrent);
  if (timingSafeEqual(suppliedDigest, expectedDigest)) return;
  throw new NodexAgentEtagError(
    "etag_mismatch",
    "Nodex Agent ETag no longer matches current state",
  );
}
