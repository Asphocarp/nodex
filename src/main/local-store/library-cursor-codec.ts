import { createHmac, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";

import { MAX_LIBRARY_CURSOR_LENGTH } from "../../shared/library-module";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { readNodexAgentSigningKey } from "./nodex-agent-signing-key";

const CURSOR_PREFIX = "nxl1";
const CURSOR_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const LibraryCursorPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("library_cursor"),
  libraryId: z.string().trim().min(1).max(512),
  storeEpoch: z.string().trim().min(1).max(512),
  subject: z.array(z.string().max(512)).min(1).max(8),
  offset: z.number().int().nonnegative(),
  changeLogSeq: z.number().int().nonnegative(),
});

export type LibraryCursorPayload = z.infer<typeof LibraryCursorPayloadSchema>;

export type LibraryCursorErrorCode =
  | "invalid_cursor"
  | "cursor_scope_mismatch"
  | "store_epoch_mismatch";

export class LibraryCursorError extends Error {
  public constructor(
    public readonly code: LibraryCursorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LibraryCursorError";
  }
}

const requireSigningKey = (database: Database.Database): Buffer => {
  const key = readNodexAgentSigningKey(database);
  if (key) return key;
  throw new LibraryCursorError(
    "invalid_cursor",
    "Library cursor signing key is unavailable",
  );
};

const sign = (database: Database.Database, payload: string): Buffer =>
  createHmac("sha256", requireSigningKey(database))
    .update(`${CURSOR_PREFIX}.${payload}`)
    .digest();

const sameSubject = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length
  && left.every((value, index) => value === right[index]);

export const mintLibraryCursor = (
  database: Database.Database,
  input: Readonly<{
    libraryId: string;
    subject: readonly string[];
    offset: number;
    changeLogSeq: number;
  }>,
): string => {
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) {
    throw new LibraryCursorError(
      "invalid_cursor",
      "Library cursor store epoch is unavailable",
    );
  }
  const payload = LibraryCursorPayloadSchema.parse({
    version: 1,
    kind: "library_cursor",
    libraryId: input.libraryId,
    storeEpoch,
    subject: input.subject,
    offset: input.offset,
    changeLogSeq: input.changeLogSeq,
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(database, encoded).toString("base64url");
  const cursor = `${CURSOR_PREFIX}.${encoded}.${signature}`;
  if (cursor.length <= MAX_LIBRARY_CURSOR_LENGTH) return cursor;
  throw new LibraryCursorError("invalid_cursor", "Library cursor is too large");
};

export const decodeLibraryCursor = (
  database: Database.Database,
  cursor: string,
  expected: Readonly<{ libraryId: string; subject: readonly string[] }>,
): LibraryCursorPayload => {
  if (cursor.length === 0 || cursor.length > MAX_LIBRARY_CURSOR_LENGTH) {
    throw new LibraryCursorError("invalid_cursor", "Library cursor is malformed");
  }
  const parts = cursor.split(".");
  if (
    parts.length !== 3 || parts[0] !== CURSOR_PREFIX ||
    !parts[1] || !parts[2] || !CURSOR_SIGNATURE_PATTERN.test(parts[2])
  ) {
    throw new LibraryCursorError("invalid_cursor", "Library cursor is malformed");
  }
  const supplied = Buffer.from(parts[2], "base64url");
  const expectedSignature = sign(database, parts[1]);
  if (
    supplied.byteLength !== expectedSignature.byteLength ||
    supplied.toString("base64url") !== parts[2] ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    throw new LibraryCursorError(
      "invalid_cursor",
      "Library cursor signature is invalid",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new LibraryCursorError(
      "invalid_cursor",
      "Library cursor payload is malformed",
    );
  }
  const parsed = LibraryCursorPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LibraryCursorError(
      "invalid_cursor",
      "Library cursor payload is invalid",
    );
  }
  if (
    parsed.data.libraryId !== expected.libraryId ||
    !sameSubject(parsed.data.subject, expected.subject)
  ) {
    throw new LibraryCursorError(
      "cursor_scope_mismatch",
      "Library cursor belongs to another query",
    );
  }
  if (parsed.data.storeEpoch !== readBlockStoreEpoch(database)) {
    throw new LibraryCursorError(
      "store_epoch_mismatch",
      "Library cursor belongs to another store epoch",
    );
  }
  return parsed.data;
};
