import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "./block-property-mutations";
import {
  CARD_METADATA_DATABASE_FIELDS,
  CARD_METADATA_INTRINSIC_FIELDS,
  type CardDatabaseMetadataField,
  type CardDatabasePropertyCoordinate,
  type CardIntrinsicMetadataField,
  type CardIntrinsicPropertyCoordinate,
  type CardMetadataPropertyCoordinate,
  type CardMetadataPropertySnapshot,
} from "./card-metadata-property-compiler";

const MAX_ID_LENGTH = 512;
const MAX_STORE_EPOCH_LENGTH = 512;

export class CardMetadataPropertySnapshotContractError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CardMetadataPropertySnapshotContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new CardMetadataPropertySnapshotContractError(
    `${label} must be an object`,
  );
};

const requireExactKeys = (
  value: Readonly<Record<string, unknown>>,
  label: string,
  keys: readonly string[],
): void => {
  const expected = new Set(keys);
  for (const key of keys) {
    if (Object.hasOwn(value, key)) continue;
    throw new CardMetadataPropertySnapshotContractError(
      `${label}.${key} is required`,
    );
  }
  for (const key of Object.keys(value)) {
    if (expected.has(key)) continue;
    throw new CardMetadataPropertySnapshotContractError(
      `${label}.${key} is not supported`,
    );
  }
};

const requireString = (
  value: unknown,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  throw new CardMetadataPropertySnapshotContractError(
    `${label} must be a canonical non-empty string`,
  );
};

const requireRevision = (value: unknown, label: string): number => {
  if (Number.isSafeInteger(value) && (value as number) >= 0) {
    return value as number;
  }
  throw new CardMetadataPropertySnapshotContractError(
    `${label} must be a non-negative safe integer`,
  );
};

const requirePortableValue = (
  value: unknown,
  label: string,
): BlockPropertyJsonValue => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(value),
    ) as BlockPropertyJsonValue;
  } catch (error) {
    throw new CardMetadataPropertySnapshotContractError(
      `${label} must be bounded portable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const databaseFields = new Set<string>(
  Object.keys(CARD_METADATA_DATABASE_FIELDS),
);
const intrinsicFields = new Set<string>(
  Object.keys(CARD_METADATA_INTRINSIC_FIELDS),
);

const parseCoordinate = (
  value: unknown,
  index: number,
): CardMetadataPropertyCoordinate => {
  const label = `cardMetadataPropertySnapshot.fields[${index}]`;
  const coordinate = requireRecord(value, label);
  const scope = coordinate.scope;
  if (scope === "database") {
    requireExactKeys(coordinate, label, [
      "scope",
      "field",
      "databaseBlockId",
      "propertyId",
      "revision",
      "value",
    ]);
    const field = requireString(coordinate.field, `${label}.field`, 128);
    if (!databaseFields.has(field)) {
      throw new CardMetadataPropertySnapshotContractError(
        `${label}.field is not a Card Database metadata field`,
      );
    }
    return {
      scope,
      field: field as CardDatabaseMetadataField,
      databaseBlockId: requireString(
        coordinate.databaseBlockId,
        `${label}.databaseBlockId`,
      ),
      propertyId: requireString(coordinate.propertyId, `${label}.propertyId`),
      revision: requireRevision(coordinate.revision, `${label}.revision`),
      value: requirePortableValue(coordinate.value, `${label}.value`),
    } satisfies CardDatabasePropertyCoordinate;
  }
  if (scope === "intrinsic") {
    requireExactKeys(coordinate, label, [
      "scope",
      "field",
      "revision",
      "value",
    ]);
    const field = requireString(coordinate.field, `${label}.field`, 128);
    if (!intrinsicFields.has(field)) {
      throw new CardMetadataPropertySnapshotContractError(
        `${label}.field is not an intrinsic Card metadata field`,
      );
    }
    return {
      scope,
      field: field as CardIntrinsicMetadataField,
      revision: requireRevision(coordinate.revision, `${label}.revision`),
      value: requirePortableValue(coordinate.value, `${label}.value`),
    } satisfies CardIntrinsicPropertyCoordinate;
  }
  throw new CardMetadataPropertySnapshotContractError(
    `${label}.scope must be database or intrinsic`,
  );
};

export const parseCardMetadataPropertySnapshot = (
  value: unknown,
): CardMetadataPropertySnapshot => {
  const label = "cardMetadataPropertySnapshot";
  const snapshot = requireRecord(value, label);
  requireExactKeys(snapshot, label, [
    "projectId",
    "storeEpoch",
    "changeLogSeq",
    "cardBlockId",
    "metadataRevision",
    "fields",
  ]);
  if (!Array.isArray(snapshot.fields)) {
    throw new CardMetadataPropertySnapshotContractError(
      `${label}.fields must be an array`,
    );
  }
  const fields = snapshot.fields.map(parseCoordinate);
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.field)) {
      throw new CardMetadataPropertySnapshotContractError(
        `${label}.fields contains duplicate ${field.field}`,
      );
    }
    seen.add(field.field);
  }
  for (const field of intrinsicFields) {
    if (seen.has(field)) continue;
    throw new CardMetadataPropertySnapshotContractError(
      `${label}.fields is missing intrinsic field ${field}`,
    );
  }
  return {
    projectId: requireString(snapshot.projectId, `${label}.projectId`),
    storeEpoch: requireString(
      snapshot.storeEpoch,
      `${label}.storeEpoch`,
      MAX_STORE_EPOCH_LENGTH,
    ),
    changeLogSeq: requireRevision(snapshot.changeLogSeq, `${label}.changeLogSeq`),
    cardBlockId: requireString(snapshot.cardBlockId, `${label}.cardBlockId`),
    metadataRevision: requireRevision(
      snapshot.metadataRevision,
      `${label}.metadataRevision`,
    ),
    fields,
  };
};
