import type { DatabaseViewField } from "../../../../shared/database-kernel";
import {
  orderedDatabaseIdentityFields,
  type DatabaseIntrinsicField,
} from "../../../lib/database-intrinsic-field-registry";

export const DATABASE_LIST_FIELD_GAP = 8;
export const DATABASE_LIST_INDENT_WIDTH = 8;
export const DATABASE_LIST_CHECKBOX_WIDTH = 18;
export const DATABASE_LIST_PRIORITY_WIDTH = 16;
export const DATABASE_LIST_END_PADDING_WIDTH = 18;
export const DATABASE_LIST_IDENTIFIER_WIDTH_PADDING = 2;

const DATABASE_LIST_PAGE_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,7})-([1-9][0-9]*)$/;

export interface DatabaseListCoreColumnVisibility {
  readonly priority: boolean;
  readonly status: boolean;
}

export interface DatabaseListColumnVisibility extends DatabaseListCoreColumnVisibility {
  readonly identifier: boolean;
}

export type DatabaseListIdentityField = Extract<
  DatabaseIntrinsicField,
  "page_key"
>;

export interface DatabaseListPageIdentity {
  readonly label: string;
  readonly title: string;
}

export type DatabaseListTextMeasurer = (value: string) => number | null;

/** Projects the semantic identity once when the List row model changes. */
export const projectDatabaseListPageIdentity = (
  pageKey: string | null,
  fields: readonly DatabaseListIdentityField[],
): DatabaseListPageIdentity => {
  const label = fields.includes("page_key") ? pageKey ?? "" : "";
  return { label, title: label };
};

/**
 * Builds a bounded set of width probes for the prefixes and number depths in
 * the current projection. Testing every numeral avoids assuming a particular
 * font uses tabular figures while keeping measurement independent of row count.
 */
export const databaseListIdentifierSamples = <T>(
  values: readonly T[],
  pageKeyFor: (value: T) => string | null,
): readonly string[] => {
  const digitCountByPrefix = new Map<string, number>();
  for (const value of values) {
    const pageKey = pageKeyFor(value);
    const match = pageKey?.match(DATABASE_LIST_PAGE_KEY_PATTERN);
    if (!match) continue;
    const [, prefix, number] = match;
    digitCountByPrefix.set(
      prefix,
      Math.max(digitCountByPrefix.get(prefix) ?? 0, number.length),
    );
  }

  return [...digitCountByPrefix].flatMap(([prefix, digitCount]) =>
    Array.from({ length: 10 }, (_, digit) =>
      `${prefix}-${String(digit).repeat(digitCount)}`
    )
  );
};

export const databaseListIdentifierMinWidth = (
  samples: readonly string[],
  measureText: DatabaseListTextMeasurer,
): number | null => {
  let maximumWidth: number | null = null;
  for (const sample of samples) {
    const width = measureText(sample);
    if (width === null || !Number.isFinite(width)) return null;
    maximumWidth = Math.max(maximumWidth ?? 0, width);
  }
  return maximumWidth === null
    ? null
    : Math.ceil(maximumWidth + DATABASE_LIST_IDENTIFIER_WIDTH_PADDING);
};

const DEFAULT_COLUMN_VISIBILITY: DatabaseListColumnVisibility = {
  identifier: true,
  priority: true,
  status: true,
};

interface DatabaseListGridTrack {
  readonly lineNames: readonly string[];
  readonly size: string;
}

const serializeDatabaseListGridTrack = (
  track: DatabaseListGridTrack,
): string => `[${track.lineNames.join(" ")}] ${track.size}`;

export const databaseListFieldKey = (field: DatabaseViewField): string =>
  field.kind === "property"
    ? `property:${field.propertyId}`
    : `intrinsic:${field.field}`;

export const withForcedDatabaseListField = (
  fields: readonly DatabaseViewField[],
  forcedField: DatabaseViewField | null,
): readonly DatabaseViewField[] => {
  if (!forcedField) return fields;
  const forcedKey = databaseListFieldKey(forcedField);
  return fields.some((field) => databaseListFieldKey(field) === forcedKey)
    ? fields
    : [...fields, forcedField];
};

export const partitionDatabaseListFields = (
  fields: readonly DatabaseViewField[],
): {
  readonly identityFields: readonly DatabaseListIdentityField[];
  readonly inlineFields: readonly DatabaseViewField[];
  readonly trailingFields: readonly DatabaseViewField[];
} => ({
  identityFields: orderedDatabaseIdentityFields("list", fields)
    .filter((field): field is DatabaseListIdentityField =>
      field === "page_key"
    ),
  inlineFields: fields.filter((field) => field.kind === "property"),
  trailingFields: fields.filter(
    (field) => field.kind === "intrinsic"
      && field.field !== "page_key",
  ),
});

export const databaseListGridTemplate = (
  trailingFields: readonly DatabaseViewField[],
  coreColumns: DatabaseListColumnVisibility = DEFAULT_COLUMN_VISIBILITY,
  identifierMinWidth: number | null = null,
): string => {
  const tracks: DatabaseListGridTrack[] = [
    { lineNames: ["indent"], size: `${DATABASE_LIST_INDENT_WIDTH}px` },
    { lineNames: ["checkbox"], size: `${DATABASE_LIST_CHECKBOX_WIDTH}px` },
  ];
  if (coreColumns.priority) {
    tracks.push({
      lineNames: ["priority"],
      size: `${DATABASE_LIST_PRIORITY_WIDTH}px`,
    });
  }

  const identityAliases: string[] = [];
  if (coreColumns.identifier) {
    tracks.push({
      lineNames: ["identifier"],
      size: identifierMinWidth === null
        ? "minmax(min-content,auto)"
        : `minmax(${identifierMinWidth}px,auto)`,
    });
  } else {
    // Group headers always start at `identifier`. When the visible ID track is
    // absent, alias that boundary onto the next real track instead of emitting
    // a standalone line-name token that invalidates the entire track list.
    identityAliases.push("identifier");
  }
  if (coreColumns.status) {
    tracks.push({ lineNames: [...identityAliases, "status"], size: "16px" });
    identityAliases.length = 0;
  }
  tracks.push({
    lineNames: [...identityAliases, "title"],
    size: "minmax(0,1fr)",
  });

  for (const field of trailingFields) {
    if (
      field.kind !== "intrinsic"
      || field.field === "page_key"
    ) continue;
    tracks.push({ lineNames: [field.field], size: "minmax(60px,auto)" });
  }
  tracks.push({
    lineNames: ["end-padding"],
    size: `${DATABASE_LIST_END_PADDING_WIDTH}px`,
  });

  return `${tracks.map(serializeDatabaseListGridTrack).join(" ")} [list-end]`;
};
