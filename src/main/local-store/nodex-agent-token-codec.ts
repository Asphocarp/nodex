import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { JsonValue } from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "./block-store-metadata";

const TOKEN_PREFIX = "nxt1";
const MAX_TOKEN_LENGTH = 16_384;

export const NodexAgentTokenKindSchema = z.enum([
  "document",
  "location",
  "database_schema",
  "database_value",
  "view",
  "view_placement",
  "cursor",
]);

export type NodexAgentTokenKind = z.infer<typeof NodexAgentTokenKindSchema>;

const NodexAgentTokenPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: NodexAgentTokenKindSchema,
  projectId: z.string().trim().min(1).max(512),
  storeEpoch: z.string().trim().min(1).max(512),
  subject: z.array(z.string().trim().min(1).max(512)).min(1).max(8),
  state: z.record(z.string().min(1).max(128), z.json()),
});

export interface MintNodexAgentTokenInput {
  readonly kind: NodexAgentTokenKind;
  readonly projectId: string;
  readonly subject: readonly string[];
  readonly state: Readonly<Record<string, JsonValue>>;
}

export interface DecodeNodexAgentTokenExpectation {
  readonly kind: NodexAgentTokenKind;
  readonly projectId: string;
  readonly subject: readonly string[];
}

export type NodexAgentTokenPayload = z.infer<typeof NodexAgentTokenPayloadSchema>;

export type NodexAgentTokenErrorCode =
  | "invalid_token"
  | "token_kind_mismatch"
  | "token_scope_mismatch"
  | "store_epoch_mismatch";

export class NodexAgentTokenError extends Error {
  public constructor(
    public readonly code: NodexAgentTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NodexAgentTokenError";
  }
}

function readSigningKey(database: Database.Database): Buffer {
  const row = database.prepare(
    "SELECT key_material FROM nodex_agent_token_keys WHERE id = 1",
  ).get() as { readonly key_material: Buffer } | undefined;
  if (row?.key_material.byteLength === 32) return row.key_material;
  throw new NodexAgentTokenError(
    "invalid_token",
    "Nodex Agent token signing key is unavailable",
  );
}

function sign(encodedPayload: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(`${TOKEN_PREFIX}.${encodedPayload}`)
    .digest();
}

function sameSubject(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function mintNodexAgentToken(
  database: Database.Database,
  input: MintNodexAgentTokenInput,
): string {
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) {
    throw new NodexAgentTokenError(
      "store_epoch_mismatch",
      "Nodex Block store epoch is unavailable",
    );
  }
  const payload = NodexAgentTokenPayloadSchema.parse({
    version: 1,
    kind: input.kind,
    projectId: input.projectId,
    storeEpoch,
    subject: input.subject,
    state: input.state,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, readSigningKey(database)).toString("base64url");
  const token = `${TOKEN_PREFIX}.${encodedPayload}.${signature}`;
  if (token.length <= MAX_TOKEN_LENGTH) return token;
  throw new NodexAgentTokenError("invalid_token", "Nodex Agent token is too large");
}

export function decodeNodexAgentToken(
  database: Database.Database,
  token: string,
  expected: DecodeNodexAgentTokenExpectation,
): NodexAgentTokenPayload {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new NodexAgentTokenError("invalid_token", "Nodex Agent token is malformed");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !parts[1] || !parts[2]) {
    throw new NodexAgentTokenError("invalid_token", "Nodex Agent token is malformed");
  }

  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(parts[2], "base64url");
  } catch {
    throw new NodexAgentTokenError("invalid_token", "Nodex Agent token signature is malformed");
  }
  const expectedSignature = sign(parts[1], readSigningKey(database));
  if (
    suppliedSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new NodexAgentTokenError("invalid_token", "Nodex Agent token signature is invalid");
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new NodexAgentTokenError("invalid_token", "Nodex Agent token payload is malformed");
  }
  const parsed = NodexAgentTokenPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new NodexAgentTokenError("invalid_token", "Nodex Agent token payload is invalid");
  }

  if (parsed.data.kind !== expected.kind) {
    throw new NodexAgentTokenError(
      "token_kind_mismatch",
      `Expected a ${expected.kind} token, received ${parsed.data.kind}`,
    );
  }
  if (
    parsed.data.projectId !== expected.projectId
    || !sameSubject(parsed.data.subject, expected.subject)
  ) {
    throw new NodexAgentTokenError(
      "token_scope_mismatch",
      "Nodex Agent token belongs to another Project or resource",
    );
  }

  const currentStoreEpoch = readBlockStoreEpoch(database);
  if (!currentStoreEpoch || parsed.data.storeEpoch !== currentStoreEpoch) {
    throw new NodexAgentTokenError(
      "store_epoch_mismatch",
      "Nodex Agent token belongs to another store epoch",
    );
  }
  return parsed.data;
}
