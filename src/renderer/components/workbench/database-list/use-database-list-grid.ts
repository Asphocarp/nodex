import { useMemo } from "react";

import type { DatabaseViewField } from "../../../../shared/database-kernel";
import {
  databaseListIdentifierMinWidth,
  databaseListGridTemplate,
  partitionDatabaseListFields,
  type DatabaseListCoreColumnVisibility,
  type DatabaseListIdentityField,
} from "./database-list-grid";

const DATABASE_LIST_IDENTIFIER_FONT_SIZE = 13;
const DATABASE_LIST_IDENTIFIER_FONT_WEIGHT = 450;
const DATABASE_LIST_IDENTIFIER_LETTER_SPACING = -0.02 * DATABASE_LIST_IDENTIFIER_FONT_SIZE;

const createDatabaseListIdentifierMeasurer = (
  fontFamily: string,
): ((value: string) => number | null) | null => {
  if (typeof document === "undefined") return null;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.font = `${DATABASE_LIST_IDENTIFIER_FONT_WEIGHT} ${DATABASE_LIST_IDENTIFIER_FONT_SIZE}px ${fontFamily}`;

  return (value) => {
    const glyphWidth = context.measureText(value).width;
    const trackingWidth = Math.max(0, value.length - 1) * DATABASE_LIST_IDENTIFIER_LETTER_SPACING;
    const width = glyphWidth + trackingWidth;
    return Number.isFinite(width) ? width : null;
  };
};

export const useDatabaseListGrid = (
  fields: readonly DatabaseViewField[],
  coreColumns: DatabaseListCoreColumnVisibility,
  identifierSamples: readonly string[],
): {
  readonly identityFields: readonly DatabaseListIdentityField[];
  readonly inlineFields: readonly DatabaseViewField[];
  readonly trailingFields: readonly DatabaseViewField[];
  readonly gridTemplateColumns: string;
} => {
  const { identityFields, inlineFields, trailingFields } = partitionDatabaseListFields(fields);
  const identifierVisible = identityFields.length > 0;
  const fontFamily =
    typeof document === "undefined"
      ? "sans-serif"
      : getComputedStyle(document.body).fontFamily || "sans-serif";
  const identifierMinWidth = useMemo(() => {
    if (!identifierVisible) return null;
    const measureText = createDatabaseListIdentifierMeasurer(fontFamily);
    return measureText ? databaseListIdentifierMinWidth(identifierSamples, measureText) : null;
  }, [fontFamily, identifierSamples, identifierVisible]);
  return {
    identityFields,
    inlineFields,
    trailingFields,
    gridTemplateColumns: databaseListGridTemplate(
      trailingFields,
      {
        ...coreColumns,
        identifier: identifierVisible,
      },
      identifierMinWidth,
    ),
  };
};
