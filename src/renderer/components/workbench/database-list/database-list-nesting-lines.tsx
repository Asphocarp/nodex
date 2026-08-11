import { Fragment } from "react";

import type {
  DatabaseListPageRow,
  DatabaseListProjectionRow,
} from "./database-list-model";

export const DATABASE_LIST_NESTING_DEPTH_PX = 24;

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
  if (depth <= 0) return null;
  const connectorLevel = depth - 1;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 overflow-visible text-token-border"
      style={{ width: `${depth * DATABASE_LIST_NESTING_DEPTH_PX}px` }}
    >
      {Array.from({ length: depth }, (_, level) => {
        const left = 11.5 + level * DATABASE_LIST_NESTING_DEPTH_PX;
        const isConnector = level === connectorLevel;
        if (!isConnector && !continuations[level]) return null;
        return (
          <Fragment key={level}>
            <span
              className="absolute top-0 w-px bg-current opacity-55"
              style={{
                left,
                bottom: continuations[level] ? 0 : undefined,
                height: continuations[level] ? undefined : 16,
              }}
            />
            {isConnector ? (
              <svg
                width="10"
                height="9"
                viewBox="0 0 10 9"
                className="absolute opacity-55"
                style={{ left, top: 15 }}
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
          className="absolute bottom-0 h-[5px] w-px bg-current opacity-55"
          style={{ left: 11.5 + depth * DATABASE_LIST_NESTING_DEPTH_PX }}
        />
      ) : null}
    </div>
  );
}
