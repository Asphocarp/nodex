import type { DatabaseViewField } from "../../../../shared/database-kernel";

export const DATABASE_LIST_FIELD_GAP = 8;
export const DATABASE_LIST_INDENT_WIDTH = 8;
export const DATABASE_LIST_CHECKBOX_WIDTH = 18;
export const DATABASE_LIST_PRIORITY_WIDTH = 16;
export const DATABASE_LIST_END_PADDING_WIDTH = 18;

export interface DatabaseListCoreColumnVisibility {
  readonly priority: boolean;
  readonly status: boolean;
}

export interface DatabaseListColumnVisibility extends DatabaseListCoreColumnVisibility {
  readonly identifier: boolean;
}

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
  readonly showIdentifier: boolean;
  readonly inlineFields: readonly DatabaseViewField[];
  readonly trailingFields: readonly DatabaseViewField[];
} => ({
  showIdentifier: fields.some(
    (field) => field.kind === "intrinsic" && field.field === "page_id",
  ),
  inlineFields: fields.filter((field) => field.kind === "property"),
  trailingFields: fields.filter(
    (field) => field.kind === "intrinsic" && field.field !== "page_id",
  ),
});

export const databaseListGridTemplate = (
  trailingFields: readonly DatabaseViewField[],
  coreColumns: DatabaseListColumnVisibility = DEFAULT_COLUMN_VISIBILITY,
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
    tracks.push({ lineNames: ["identifier"], size: "minmax(51px,auto)" });
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
    if (field.kind !== "intrinsic" || field.field === "page_id") continue;
    tracks.push({ lineNames: [field.field], size: "minmax(60px,auto)" });
  }
  tracks.push({
    lineNames: ["end-padding"],
    size: `${DATABASE_LIST_END_PADDING_WIDTH}px`,
  });

  return `${tracks.map(serializeDatabaseListGridTrack).join(" ")} [list-end]`;
};
