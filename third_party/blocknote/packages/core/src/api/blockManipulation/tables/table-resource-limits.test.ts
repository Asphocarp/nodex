import { describe, expect, it } from "vitest";

import type { Block, DefaultBlockSchema } from "../../../blocks/defaultBlocks.js";
import {
  assertTableHeaderCount,
  getColspan,
  TABLE_RESOURCE_LIMITS,
} from "../../../util/table.js";
import { getDimensionsOfTable } from "./tables.js";

const makeCell = (colspan = 1) => ({
  type: "tableCell" as const,
  props: {
    backgroundColor: "default",
    textColor: "default",
    textAlignment: "left" as const,
    colspan,
    rowspan: 1,
  },
  content: [],
});

const makeTable = (
  rows: ReturnType<typeof makeCell>[][],
): Block<{ table: DefaultBlockSchema["table"] }> =>
  ({
    type: "table",
    id: "resource-limit-table",
    props: { textColor: "default" },
    content: {
      type: "tableContent",
      columnWidths: [],
      rows: rows.map((cells) => ({ cells })),
    },
    children: [],
  }) as Block<{ table: DefaultBlockSchema["table"] }>;

describe("table resource limits", () => {
  it("rejects unbounded spans before they can determine allocation sizes", () => {
    expect(() =>
      getColspan(makeCell(TABLE_RESOURCE_LIMITS.columns + 1)),
    ).toThrow(RangeError);
    expect(() => getColspan(makeCell(Number.POSITIVE_INFINITY))).toThrow(
      RangeError,
    );
  });

  it("bounds header metadata received from document content", () => {
    expect(assertTableHeaderCount(TABLE_RESOURCE_LIMITS.rows, "rows")).toBe(
      TABLE_RESOURCE_LIMITS.rows,
    );
    expect(() =>
      assertTableHeaderCount(TABLE_RESOURCE_LIMITS.columns + 1, "columns"),
    ).toThrow(RangeError);
  });

  it("rejects oversized occupancy grids before materializing them", () => {
    const rowCount =
      Math.floor(
        TABLE_RESOURCE_LIMITS.occupancyCells /
          TABLE_RESOURCE_LIMITS.columns,
      ) + 1;
    const table = makeTable(
      Array.from({ length: rowCount }, () => [
        makeCell(TABLE_RESOURCE_LIMITS.columns),
      ]),
    );

    expect(() => getDimensionsOfTable(table)).toThrow(
      `Table occupancy grid cannot exceed ${TABLE_RESOURCE_LIMITS.occupancyCells} cells`,
    );
  });
});
