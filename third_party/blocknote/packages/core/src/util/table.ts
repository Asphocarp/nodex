import type {
  InlineContentSchema,
  StyleSchema,
  PartialInlineContent,
  InlineContent,
} from "../schema";
import { PartialTableCell, TableCell } from "../schema/blocks/types.js";

/**
 * Tables are accepted from pasted/imported document content, so their numeric
 * metadata must not be allowed to drive unbounded allocations.
 */
export const TABLE_RESOURCE_LIMITS = {
  rows: 1_000,
  columns: 1_000,
  occupancyCells: 100_000,
} as const;

function assertBoundedTableInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${label} must be a safe integer between ${minimum} and ${maximum}`,
    );
  }

  return value;
}

export function assertTableHeaderCount(
  value: number | undefined,
  axis: "rows" | "columns",
): number {
  return assertBoundedTableInteger(
    value ?? 0,
    axis === "rows" ? "Table header row count" : "Table header column count",
    0,
    TABLE_RESOURCE_LIMITS[axis],
  );
}

export function assertTableDimensions(height: number, width: number): void {
  assertBoundedTableInteger(
    height,
    "Table row count",
    0,
    TABLE_RESOURCE_LIMITS.rows,
  );
  assertBoundedTableInteger(
    width,
    "Table column count",
    0,
    TABLE_RESOURCE_LIMITS.columns,
  );

  if (height * width > TABLE_RESOURCE_LIMITS.occupancyCells) {
    throw new RangeError(
      `Table occupancy grid cannot exceed ${TABLE_RESOURCE_LIMITS.occupancyCells} cells`,
    );
  }
}

function assertTableSpan(value: number, axis: "row" | "column"): number {
  return assertBoundedTableInteger(
    value,
    axis === "row" ? "Table row span" : "Table column span",
    1,
    axis === "row"
      ? TABLE_RESOURCE_LIMITS.rows
      : TABLE_RESOURCE_LIMITS.columns,
  );
}

/**
 * This will map a table cell to a TableCell object.
 * This is useful for when we want to get the full table cell object from a partial table cell.
 * It is guaranteed to return a new TableCell object.
 */
export function mapTableCell<
  T extends InlineContentSchema,
  S extends StyleSchema,
>(
  content:
    | PartialInlineContent<T, S>
    | PartialTableCell<T, S>
    | TableCell<T, S>,
): TableCell<T, S> {
  return isTableCell(content)
    ? { ...content }
    : isPartialTableCell(content)
      ? {
          type: "tableCell",
          content: ([] as InlineContent<T, S>[]).concat(content.content as any),
          props: {
            backgroundColor: content.props?.backgroundColor ?? "default",
            textColor: content.props?.textColor ?? "default",
            textAlignment: content.props?.textAlignment ?? "left",
            colspan: content.props?.colspan ?? 1,
            rowspan: content.props?.rowspan ?? 1,
          },
        }
      : {
          type: "tableCell",
          content: ([] as InlineContent<T, S>[]).concat(content as any),
          props: {
            backgroundColor: "default",
            textColor: "default",
            textAlignment: "left",
            colspan: 1,
            rowspan: 1,
          },
        };
}

export function isPartialTableCell<
  T extends InlineContentSchema,
  S extends StyleSchema,
>(
  content:
    | TableCell<T, S>
    | PartialInlineContent<T, S>
    | PartialTableCell<T, S>
    | undefined
    | null,
): content is PartialTableCell<T, S> {
  return (
    content !== undefined &&
    content !== null &&
    typeof content !== "string" &&
    !Array.isArray(content) &&
    content.type === "tableCell"
  );
}

export function isTableCell<
  T extends InlineContentSchema,
  S extends StyleSchema,
>(
  content:
    | TableCell<T, S>
    | PartialInlineContent<T, S>
    | PartialTableCell<T, S>
    | undefined
    | null,
): content is TableCell<T, S> {
  return (
    isPartialTableCell(content) &&
    content.props !== undefined &&
    content.content !== undefined
  );
}

export function getColspan(
  cell:
    | TableCell<any, any>
    | PartialTableCell<any, any>
    | PartialInlineContent<any, any>,
): number {
  if (isTableCell(cell)) {
    return assertTableSpan(cell.props.colspan ?? 1, "column");
  }
  return 1;
}

export function getRowspan(
  cell:
    | TableCell<any, any>
    | PartialTableCell<any, any>
    | PartialInlineContent<any, any>,
): number {
  if (isTableCell(cell)) {
    return assertTableSpan(cell.props.rowspan ?? 1, "row");
  }
  return 1;
}
