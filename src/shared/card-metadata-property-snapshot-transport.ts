import {
  CardMetadataPropertySnapshotContractError,
  parseCardMetadataPropertySnapshot,
} from "./card-metadata-property-snapshot";
import type { CardMetadataPropertySnapshot } from "./card-metadata-property-compiler";

export type CardMetadataPropertySnapshotErrorCode =
  | "invalid_request"
  | "store_not_initialized"
  | "card_not_found"
  | "card_not_active"
  | "membership_ambiguous"
  | "property_missing"
  | "property_ambiguous"
  | "property_type_mismatch"
  | "property_value_corrupt"
  | "unknown";

export interface CardMetadataPropertySnapshotCommandError {
  readonly code: CardMetadataPropertySnapshotErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type CardMetadataPropertySnapshotCommandResult =
  | { readonly ok: true; readonly value: CardMetadataPropertySnapshot }
  | { readonly ok: false; readonly error: CardMetadataPropertySnapshotCommandError };

export const cardMetadataPropertySnapshotFailure = (
  code: CardMetadataPropertySnapshotErrorCode,
  message: string,
  retryable = false,
): CardMetadataPropertySnapshotCommandError => ({ code, message, retryable });

export const cardMetadataPropertySnapshotHttpStatus = (
  error: CardMetadataPropertySnapshotCommandError,
): 400 | 404 | 409 | 422 | 500 | 503 => {
  if (error.code === "invalid_request") return 400;
  if (error.code === "card_not_found") return 404;
  if (error.code === "card_not_active") return 409;
  if (
    error.code === "property_missing" ||
    error.code === "membership_ambiguous" ||
    error.code === "property_ambiguous" ||
    error.code === "property_type_mismatch" ||
    error.code === "property_value_corrupt"
  ) {
    return 422;
  }
  if (error.retryable) return 503;
  return 500;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean => {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
};

const parseError = (
  value: unknown,
): CardMetadataPropertySnapshotCommandError => {
  if (!isRecord(value) || !exactKeys(value, ["code", "message", "retryable"])) {
    throw new CardMetadataPropertySnapshotContractError(
      "cardMetadataPropertySnapshotResult.error is malformed",
    );
  }
  const codes: readonly CardMetadataPropertySnapshotErrorCode[] = [
    "invalid_request",
    "store_not_initialized",
    "card_not_found",
    "card_not_active",
    "membership_ambiguous",
    "property_missing",
    "property_ambiguous",
    "property_type_mismatch",
    "property_value_corrupt",
    "unknown",
  ];
  if (
    typeof value.code !== "string" ||
    !codes.includes(value.code as CardMetadataPropertySnapshotErrorCode) ||
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    value.message.length > 4_096 ||
    typeof value.retryable !== "boolean"
  ) {
    throw new CardMetadataPropertySnapshotContractError(
      "cardMetadataPropertySnapshotResult.error is malformed",
    );
  }
  return {
    code: value.code as CardMetadataPropertySnapshotErrorCode,
    message: value.message,
    retryable: value.retryable,
  };
};

export const parseCardMetadataPropertySnapshotCommandResult = (
  value: unknown,
): CardMetadataPropertySnapshotCommandResult => {
  if (!isRecord(value)) {
    throw new CardMetadataPropertySnapshotContractError(
      "cardMetadataPropertySnapshotResult must be an object",
    );
  }
  if (value.ok === true && exactKeys(value, ["ok", "value"])) {
    return {
      ok: true,
      value: parseCardMetadataPropertySnapshot(value.value),
    };
  }
  if (value.ok === false && exactKeys(value, ["ok", "error"])) {
    return { ok: false, error: parseError(value.error) };
  }
  throw new CardMetadataPropertySnapshotContractError(
    "cardMetadataPropertySnapshotResult.ok must select one exact result shape",
  );
};
