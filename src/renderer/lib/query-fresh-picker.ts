export type QueryFreshNormalizer = (query: string) => string;

export type QueryFreshAcceptResult<TRow> =
  | { status: "accepted"; query: string; row: TRow }
  | { status: "pending"; query: string }
  | { status: "ignored"; query: string };

export interface ResolveQueryFreshAcceptInput<TRow> {
  liveQuery: string;
  rowsQuery: string;
  rows: readonly TRow[];
  focusedIndex: number;
  buildFreshRows?: (query: string) => readonly TRow[];
  canWaitForFreshRows?: boolean;
  getRowId?: (row: TRow) => string;
  isRowAcceptable?: (row: TRow) => boolean;
  normalizeQuery?: QueryFreshNormalizer;
}

export interface ResolvePendingQueryFreshAcceptInput<TRow> {
  pendingQuery: string | null;
  liveQuery: string;
  rowsQuery: string;
  rows: readonly TRow[];
  getRowId?: (row: TRow) => string;
  preferredRowId?: string | null;
  isRowAcceptable?: (row: TRow) => boolean;
  normalizeQuery?: QueryFreshNormalizer;
}

export function normalizeQueryFreshQuery(query: string): string {
  return query.trim();
}

export function areQueryFresh({
  liveQuery,
  rowsQuery,
  normalizeQuery = normalizeQueryFreshQuery,
}: {
  liveQuery: string;
  rowsQuery: string;
  normalizeQuery?: QueryFreshNormalizer;
}): boolean {
  return normalizeQuery(liveQuery) === normalizeQuery(rowsQuery);
}

export function shouldConsumeStalePickerNavigation(input: {
  liveQuery: string;
  rowsQuery: string;
  normalizeQuery?: QueryFreshNormalizer;
}): boolean {
  return !areQueryFresh(input);
}

function isAcceptableRow<TRow>(
  row: TRow | undefined,
  isRowAcceptable?: (row: TRow) => boolean,
): row is TRow {
  if (row === undefined) return false;
  return isRowAcceptable ? isRowAcceptable(row) : true;
}

function selectAcceptableRow<TRow>({
  rows,
  focusedIndex,
  isRowAcceptable,
}: {
  rows: readonly TRow[];
  focusedIndex: number;
  isRowAcceptable?: (row: TRow) => boolean;
}): TRow | null {
  if (rows.length === 0) return null;

  const focusedRow = rows[focusedIndex];
  if (isAcceptableRow(focusedRow, isRowAcceptable)) {
    return focusedRow;
  }

  return rows.find((row) => isAcceptableRow(row, isRowAcceptable)) ?? null;
}

function findRowById<TRow>({
  rows,
  rowId,
  getRowId,
  isRowAcceptable,
}: {
  rows: readonly TRow[];
  rowId: string | null;
  getRowId?: (row: TRow) => string;
  isRowAcceptable?: (row: TRow) => boolean;
}): TRow | null {
  if (!rowId || !getRowId) return null;
  return rows.find((row) => getRowId(row) === rowId && isAcceptableRow(row, isRowAcceptable)) ?? null;
}

export function resolveQueryFreshAccept<TRow>({
  liveQuery,
  rowsQuery,
  rows,
  focusedIndex,
  buildFreshRows,
  canWaitForFreshRows = false,
  getRowId,
  isRowAcceptable,
  normalizeQuery = normalizeQueryFreshQuery,
}: ResolveQueryFreshAcceptInput<TRow>): QueryFreshAcceptResult<TRow> {
  const query = normalizeQuery(liveQuery);
  if (areQueryFresh({ liveQuery, rowsQuery, normalizeQuery })) {
    const row = selectAcceptableRow({ rows, focusedIndex, isRowAcceptable });
    return row ? { status: "accepted", query, row } : { status: "ignored", query };
  }

  const staleFocusedRow = rows[focusedIndex];
  const staleFocusedRowId = getRowId && staleFocusedRow ? getRowId(staleFocusedRow) : null;
  const freshRows = buildFreshRows?.(liveQuery) ?? [];
  const matchingFreshRow = findRowById({
    rows: freshRows,
    rowId: staleFocusedRowId,
    getRowId,
    isRowAcceptable,
  });
  const fallbackFreshRow = selectAcceptableRow({
    rows: freshRows,
    focusedIndex: 0,
    isRowAcceptable,
  });
  const row = matchingFreshRow ?? fallbackFreshRow;
  if (row) return { status: "accepted", query, row };

  return canWaitForFreshRows
    ? { status: "pending", query }
    : { status: "ignored", query };
}

export function resolvePendingQueryFreshAccept<TRow>({
  pendingQuery,
  liveQuery,
  rowsQuery,
  rows,
  getRowId,
  preferredRowId = null,
  isRowAcceptable,
  normalizeQuery = normalizeQueryFreshQuery,
}: ResolvePendingQueryFreshAcceptInput<TRow>): QueryFreshAcceptResult<TRow> {
  const query = normalizeQuery(liveQuery);
  if (!pendingQuery || normalizeQuery(pendingQuery) !== query) {
    return { status: "ignored", query };
  }

  if (!areQueryFresh({ liveQuery, rowsQuery, normalizeQuery })) {
    return { status: "ignored", query };
  }

  const preferredRow = findRowById({
    rows,
    rowId: preferredRowId,
    getRowId,
    isRowAcceptable,
  });
  const fallbackRow = selectAcceptableRow({
    rows,
    focusedIndex: 0,
    isRowAcceptable,
  });
  const row = preferredRow ?? fallbackRow;
  return row ? { status: "accepted", query, row } : { status: "ignored", query };
}
