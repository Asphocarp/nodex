import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { JsonValue } from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { readNodexAgentSigningKey } from "./nodex-agent-signing-key";

const CURSOR_PREFIX = "nxc1";
const MAX_CURSOR_LENGTH = 16_384;
const CURSOR_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const NodexAgentCursorPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("cursor"),
  projectId: z.string().trim().min(1).max(512),
  storeEpoch: z.string().trim().min(1).max(512),
  subject: z.array(z.string().trim().min(1).max(512)).min(1).max(8),
  offset: z.number().int().nonnegative(),
  state: z.record(z.string().min(1).max(128), z.json()),
});

export type NodexAgentCursorPayload = z.infer<typeof NodexAgentCursorPayloadSchema>;

export interface MintNodexAgentCursorInput {
  readonly projectId: string;
  readonly subject: readonly string[];
  readonly offset: number;
  readonly state: Readonly<Record<string, JsonValue>>;
}

export interface DecodeNodexAgentCursorExpectation {
  readonly projectId: string;
  readonly subject: readonly string[];
}

export type NodexAgentCursorErrorCode =
  | "invalid_cursor"
  | "cursor_scope_mismatch"
  | "store_epoch_mismatch"
  | "cursor_unavailable";

export class NodexAgentCursorError extends Error {
  public constructor(
    public readonly code: NodexAgentCursorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NodexAgentCursorError";
  }
}

function requireSigningKey(database: Database.Database): Buffer {
  const key = readNodexAgentSigningKey(database);
  if (key) return key;
  throw new NodexAgentCursorError(
    "cursor_unavailable",
    "Nodex Agent cursor signing key is unavailable",
  );
}

function sign(database: Database.Database, encodedPayload: string): Buffer {
  return createHmac("sha256", requireSigningKey(database))
    .update(`${CURSOR_PREFIX}.${encodedPayload}`)
    .digest();
}

function sameSubject(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function mintNodexAgentCursor(
  database: Database.Database,
  input: MintNodexAgentCursorInput,
): string {
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) {
    throw new NodexAgentCursorError(
      "cursor_unavailable",
      "Nodex Agent cursor store epoch is unavailable",
    );
  }
  const payload = NodexAgentCursorPayloadSchema.parse({
    version: 1,
    kind: "cursor",
    projectId: input.projectId,
    storeEpoch,
    subject: input.subject,
    offset: input.offset,
    state: input.state,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(database, encodedPayload).toString("base64url");
  const cursor = `${CURSOR_PREFIX}.${encodedPayload}.${signature}`;
  if (cursor.length <= MAX_CURSOR_LENGTH) return cursor;
  throw new NodexAgentCursorError(
    "invalid_cursor",
    "Nodex Agent cursor is too large",
  );
}

export function decodeNodexAgentCursor(
  database: Database.Database,
  cursor: string,
  expected: DecodeNodexAgentCursorExpectation,
): NodexAgentCursorPayload {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    throw new NodexAgentCursorError(
      "invalid_cursor",
      "Nodex Agent cursor is malformed",
    );
  }
  const parts = cursor.split(".");
  if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX || !parts[1] || !parts[2]) {
    throw new NodexAgentCursorError(
      "invalid_cursor",
      "Nodex Agent cursor is malformed",
    );
  }

  if (!CURSOR_SIGNATURE_PATTERN.test(parts[2])) {
    throw new NodexAgentCursorError(
      "invalid_cursor",
      "Nodex Agent cursor signature is malformed",
    );
  }
  const suppliedSignature = Buffer.from(parts[2], "base64url");
  const expectedSignature = sign(database, parts[1]);
  if (
    suppliedSignature.byteLength !== expectedSignature.byteLength
    || suppliedSignature.toString("base64url") !== parts[2]
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new NodexAgentCursorError(
      "invalid_cursor",
      "Nodex Agent cursor signature is invalid",
    );
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new NodexAgentCursorError(
      "invalid_cursor",
      "Nodex Agent cursor payload is malformed",
    );
  }
  const parsed = NodexAgentCursorPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new NodexAgentCursorError(
      "invalid_cursor",
      "Nodex Agent cursor payload is invalid",
    );
  }
  if (
    parsed.data.projectId !== expected.projectId
    || !sameSubject(parsed.data.subject, expected.subject)
  ) {
    throw new NodexAgentCursorError(
      "cursor_scope_mismatch",
      "Nodex Agent cursor belongs to another Project or query",
    );
  }

  const currentStoreEpoch = readBlockStoreEpoch(database);
  if (!currentStoreEpoch || parsed.data.storeEpoch !== currentStoreEpoch) {
    throw new NodexAgentCursorError(
      "store_epoch_mismatch",
      "Nodex Agent cursor belongs to another store epoch",
    );
  }
  return parsed.data;
}
