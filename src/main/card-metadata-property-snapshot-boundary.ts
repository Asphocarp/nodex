import {
  cardMetadataPropertySnapshotFailure,
  type CardMetadataPropertySnapshotCommandResult,
} from "../shared/card-metadata-property-snapshot-transport";
import { CardMetadataPropertySnapshotError } from "./local-store/card-metadata-property-snapshot";

export const readCanonicalCardMetadataIdentity = (
  value: unknown,
): string | null => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim()
  ) {
    return value;
  }
  return null;
};

export const cardMetadataPropertySnapshotReadFailure = (
  error: unknown,
): CardMetadataPropertySnapshotCommandResult => {
  if (error instanceof CardMetadataPropertySnapshotError) {
    return {
      ok: false,
      error: cardMetadataPropertySnapshotFailure(error.code, error.message),
    };
  }
  return {
    ok: false,
    error: cardMetadataPropertySnapshotFailure(
      "unknown",
      error instanceof Error
        ? error.message
        : "The Card metadata authority is unavailable",
      true,
    ),
  };
};
