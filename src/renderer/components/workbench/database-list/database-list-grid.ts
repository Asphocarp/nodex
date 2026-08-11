import type { DatabaseViewField } from "../../../../shared/database-kernel";

export const DATABASE_LIST_FIELD_GAP = 8;

export interface DatabaseListCoreColumnVisibility {
  readonly priority: boolean;
  readonly status: boolean;
}

const DEFAULT_CORE_COLUMN_VISIBILITY: DatabaseListCoreColumnVisibility = {
  priority: true,
  status: true,
};

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
  readonly inlineFields: readonly DatabaseViewField[];
  readonly trailingFields: readonly DatabaseViewField[];
} => ({
  inlineFields: fields.filter((field) => field.kind === "property"),
  trailingFields: fields.filter((field) => field.kind === "intrinsic"),
});

export const databaseListGridTemplate = (
  trailingFields: readonly DatabaseViewField[],
  coreColumns: DatabaseListCoreColumnVisibility = DEFAULT_CORE_COLUMN_VISIBILITY,
): string => [
  "[indent] 8px",
  "[checkbox] 18px",
  ...(coreColumns.priority ? ["[priority] 16px"] : []),
  "[identifier] minmax(51px,auto)",
  ...(coreColumns.status ? ["[status] 16px"] : []),
  "[title] minmax(0,1fr)",
  ...trailingFields.flatMap((field) => field.kind === "intrinsic"
    ? [`[${field.field}] minmax(60px,auto)`]
    : []),
  "[end-padding] 18px [list-end]",
].join(" ");
