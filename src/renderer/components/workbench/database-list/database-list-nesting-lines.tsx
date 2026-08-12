import { Fragment } from "react";

import type {
  DatabaseListPageRow,
  DatabaseListProjectionRow,
} from "./database-list-model";
import {
  DATABASE_LIST_CHECKBOX_WIDTH,
  DATABASE_LIST_FIELD_GAP,
  DATABASE_LIST_PRIORITY_WIDTH,
} from "./database-list-grid";

export const DATABASE_LIST_NESTING_DEPTH_PX = 24;
export const DATABASE_LIST_NESTING_OVERLAY_LEFT_PX = 6;
export const DATABASE_LIST_PAGE_ROW_HEIGHT_PX = 44;
// The visible 1px guide is centered on the leading identity icon lane.
export const DATABASE_LIST_NESTING_ANCHOR_PX = DATABASE_LIST_CHECKBOX_WIDTH
  + DATABASE_LIST_FIELD_GAP
  + DATABASE_LIST_PRIORITY_WIDTH / 2
  - 0.5;

export const databaseListNestingLineLeft = (level: number): number =>
  DATABASE_LIST_NESTING_ANCHOR_PX + level * DATABASE_LIST_NESTING_DEPTH_PX;

export const databaseListNestingLineInset = (level: number): number =>
  databaseListNestingLineLeft(level) - DATABASE_LIST_NESTING_OVERLAY_LEFT_PX;

export const databaseListNestingGeometry = (rowHeight: number) => ({
  fullVerticalLineHeight: rowHeight / 2 - 6,
  nestingLineTop: rowHeight / 2 - 7,
  parentLineTop: rowHeight - 5,
});

const DATABASE_LIST_NESTING_GEOMETRY = databaseListNestingGeometry(
  DATABASE_LIST_PAGE_ROW_HEIGHT_PX,
);

const parentPathKey = (
  row: DatabaseListPageRow,
  level: number,
): string => JSON.stringify([
  row.groupKey,
  row.subgroupKey,
  ...row.ancestorPageIds.slice(0, level + 1),
]);

const directChildAtLevel = (
  row: DatabaseListPageRow,
  level: number,
): string => row.ancestorPageIds[level + 1] ?? row.pageId;

/**
 * Identifies the ancestor branches that continue beyond each visible row.
 * The occurrence path, rather than the Page id, is the authority because one
 * Page can appear in more than one grouped tree.
 */
export const databaseListNestingContinuations = (
  rows: readonly DatabaseListProjectionRow[],
): ReadonlyMap<string, readonly boolean[]> => {
  const lastChildByParentPath = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== "page") continue;
    for (let level = 0; level < row.depth; level += 1) {
      lastChildByParentPath.set(
        parentPathKey(row, level),
        directChildAtLevel(row, level),
      );
    }
  }

  return new Map(rows.flatMap((row) => {
    if (row.kind !== "page" || row.depth === 0) return [];
    const continuations = Array.from({ length: row.depth }, (_, level) =>
      lastChildByParentPath.get(parentPathKey(row, level))
        !== directChildAtLevel(row, level)
    );
    return [[row.key, continuations] as const];
  }));
};

export function DatabaseListNestingLines({
  depth,
  continuations,
  hasChildren,
}: {
  readonly depth: number;
  readonly continuations: readonly boolean[];
  readonly hasChildren: boolean;
}) {
  if (depth <= 0 && !hasChildren) return null;
  const connectorLevel = depth - 1;
  return (
    <div
      aria-hidden="true"
      data-list-nesting-lines="true"
      className="pointer-events-none absolute top-0 z-[1] flex h-full items-center overflow-visible text-[var(--database-list-nesting-line)]"
      style={{
        gridColumn: "checkbox",
        left: DATABASE_LIST_NESTING_OVERLAY_LEFT_PX,
        width: `${depth * DATABASE_LIST_NESTING_DEPTH_PX}px`,
      }}
    >
      {Array.from({ length: depth }, (_, level) => {
        const left = databaseListNestingLineInset(level);
        const isConnector = level === connectorLevel;
        if (!isConnector && !continuations[level]) return null;
        return (
          <Fragment key={level}>
            <span
              className="absolute top-0 w-px rounded-[0.5px] bg-current"
              style={{
                left,
                bottom: continuations[level] ? 0 : undefined,
                height: continuations[level]
                  ? undefined
                  : DATABASE_LIST_NESTING_GEOMETRY.fullVerticalLineHeight,
              }}
            />
            {isConnector ? (
              <svg
                width="10"
                height="9"
                viewBox="0 0 10 9"
                className="absolute"
                style={{
                  left,
                  top: DATABASE_LIST_NESTING_GEOMETRY.nestingLineTop,
                }}
              >
                <path
                  fill="currentColor"
                  d="M0 0h1v1c0 2.5 2.212 3.546 2.212 3.546L9.737 8.06c.568.306.094 1.186-.474.88l-6.48-3.488S0 4 0 1V0Z"
                />
              </svg>
            ) : null}
          </Fragment>
        );
      })}
      {hasChildren ? (
        <span
          className="absolute bottom-0 w-px rounded-[0.5px] bg-current"
          style={{
            left: databaseListNestingLineInset(depth),
            top: DATABASE_LIST_NESTING_GEOMETRY.parentLineTop,
          }}
        />
      ) : null}
    </div>
  );
}
