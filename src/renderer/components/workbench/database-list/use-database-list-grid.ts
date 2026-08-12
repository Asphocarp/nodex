import type { DatabaseViewField } from "../../../../shared/database-kernel";
import {
  databaseListGridTemplate,
  partitionDatabaseListFields,
  type DatabaseListCoreColumnVisibility,
} from "./database-list-grid";

export const useDatabaseListGrid = (
  fields: readonly DatabaseViewField[],
  coreColumns: DatabaseListCoreColumnVisibility,
): {
  readonly showIdentifier: boolean;
  readonly inlineFields: readonly DatabaseViewField[];
  readonly trailingFields: readonly DatabaseViewField[];
  readonly gridTemplateColumns: string;
} => {
  const { showIdentifier, inlineFields, trailingFields } = partitionDatabaseListFields(fields);
  return {
    showIdentifier,
    inlineFields,
    trailingFields,
    gridTemplateColumns: databaseListGridTemplate(trailingFields, {
      ...coreColumns,
      identifier: showIdentifier,
    }),
  };
};
