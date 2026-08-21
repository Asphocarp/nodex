import {
  mapTableCell,
  type DefaultInlineContentSchema,
  type DefaultStyleSchema,
  type TableCell,
  type TableContent,
} from "@blocknote/core";

export type NfmTableContent = TableContent<DefaultInlineContentSchema, DefaultStyleSchema>;

type NfmTableRows = NfmTableContent["rows"];
export type NfmTableCell = TableCell<DefaultInlineContentSchema, DefaultStyleSchema>;
type NfmTableCellInput = NfmTableRows[number]["cells"][number];
type NfmTableClonedRow = Omit<NfmTableRows[number], "cells"> & {
  cells: NfmTableCell[];
};
export type NfmTableClonedRows = NfmTableClonedRow[];

export type NfmTableRowOrColumnTarget =
  | { kind: "row"; index: number }
  | { kind: "column"; index: number };

export type NfmTableTarget =
  | NfmTableRowOrColumnTarget
  | { kind: "cell"; rowIndex: number; colIndex: number };

function cloneInlineContent(content: NfmTableCell["content"]): NfmTableCell["content"] {
  return structuredClone(content);
}

export function cloneNfmTableCell(cell: NfmTableCellInput): NfmTableCell {
  const mappedCell = mapTableCell<DefaultInlineContentSchema, DefaultStyleSchema>(cell);

  return {
    ...mappedCell,
    props: { ...mappedCell.props },
    content: cloneInlineContent(mappedCell.content),
  };
}

function createEmptyNfmTableCell(): NfmTableCell {
  return {
    type: "tableCell",
    props: {
      backgroundColor: "default",
      textColor: "default",
      textAlignment: "left",
      colspan: 1,
      rowspan: 1,
    },
    content: [],
  };
}

function clearNfmTableCell(cell: NfmTableCellInput): NfmTableCell {
  return {
    ...cloneNfmTableCell(cell),
    content: [],
  };
}

function cloneNfmTableRow(row: NfmTableRows[number]): NfmTableClonedRow {
  return {
    ...row,
    cells: row.cells.map(cloneNfmTableCell),
  };
}

export function cloneNfmTableRows(rows: NfmTableRows): NfmTableClonedRows {
  return rows.map(cloneNfmTableRow);
}

function duplicateNfmTableRow(content: NfmTableContent, rowIndex: number): NfmTableContent {
  const sourceRow = content.rows[rowIndex];
  if (!sourceRow) return content;

  const rows = cloneNfmTableRows(content.rows);
  rows.splice(rowIndex + 1, 0, cloneNfmTableRow(sourceRow));

  return {
    ...content,
    columnWidths: [...content.columnWidths],
    rows,
  };
}

function duplicateNfmTableColumn(content: NfmTableContent, colIndex: number): NfmTableContent {
  const hasSourceColumn = content.rows.some((row) => row.cells[colIndex]);
  if (!hasSourceColumn) return content;

  const rows = content.rows.map((row) => {
    const cells = row.cells.map(cloneNfmTableCell);
    const sourceCell = row.cells[colIndex];
    cells.splice(
      colIndex + 1,
      0,
      sourceCell ? cloneNfmTableCell(sourceCell) : createEmptyNfmTableCell(),
    );
    return { ...row, cells };
  });
  const columnWidths = [...content.columnWidths];
  columnWidths.splice(colIndex + 1, 0, columnWidths[colIndex]);

  return {
    ...content,
    columnWidths,
    rows,
  };
}

export function duplicateNfmTableTarget(
  content: NfmTableContent,
  target: NfmTableRowOrColumnTarget,
): NfmTableContent {
  if (target.kind === "row") {
    return duplicateNfmTableRow(content, target.index);
  }

  return duplicateNfmTableColumn(content, target.index);
}

function clearNfmTableRow(content: NfmTableContent, rowIndex: number): NfmTableContent {
  const sourceRow = content.rows[rowIndex];
  if (!sourceRow) return content;

  const rows = content.rows.map((row, index) => {
    if (index !== rowIndex) return cloneNfmTableRow(row);
    return {
      ...row,
      cells: row.cells.map(clearNfmTableCell),
    };
  });

  return {
    ...content,
    columnWidths: [...content.columnWidths],
    rows,
  };
}

function clearNfmTableColumn(content: NfmTableContent, colIndex: number): NfmTableContent {
  const hasSourceColumn = content.rows.some((row) => row.cells[colIndex]);
  if (!hasSourceColumn) return content;

  const rows = content.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell, index) =>
      index === colIndex ? clearNfmTableCell(cell) : cloneNfmTableCell(cell),
    ),
  }));

  return {
    ...content,
    columnWidths: [...content.columnWidths],
    rows,
  };
}

function clearNfmTableSingleCell(
  content: NfmTableContent,
  rowIndex: number,
  colIndex: number,
): NfmTableContent {
  const sourceCell = content.rows[rowIndex]?.cells[colIndex];
  if (!sourceCell) return content;

  const rows = content.rows.map((row, currentRowIndex) => ({
    ...row,
    cells: row.cells.map((cell, currentColIndex) =>
      currentRowIndex === rowIndex && currentColIndex === colIndex
        ? clearNfmTableCell(cell)
        : cloneNfmTableCell(cell),
    ),
  }));

  return {
    ...content,
    columnWidths: [...content.columnWidths],
    rows,
  };
}

export function clearNfmTableTarget(
  content: NfmTableContent,
  target: NfmTableTarget,
): NfmTableContent {
  if (target.kind === "row") {
    return clearNfmTableRow(content, target.index);
  }

  if (target.kind === "column") {
    return clearNfmTableColumn(content, target.index);
  }

  return clearNfmTableSingleCell(content, target.rowIndex, target.colIndex);
}
