import { getDb } from "./database";

export interface TableSchema {
  name: string;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue: string | null;
    primaryKey: boolean;
  }[];
}

export interface SchemaResult {
  tables: TableSchema[];
}

export function getSchema(): SchemaResult {
  const database = getDb();

  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];

  const result: TableSchema[] = tables.map((table) => {
    const columns = database.prepare(`PRAGMA table_info("${table.name}")`).all() as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];

    return {
      name: table.name,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type,
        nullable: col.notnull === 0,
        defaultValue: col.dflt_value,
        primaryKey: col.pk === 1,
      })),
    };
  });

  return { tables: result };
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  columns: string[];
}

export const MAX_READ_ONLY_QUERY_ROWS = 5_000;

export function executeReadOnlyQuery(
  sql: string,
  params: (string | number | null)[] = [],
): QueryResult {
  const database = getDb();
  const stmt = database.prepare(sql);

  if (!stmt.readonly) {
    throw new Error("Only read-only queries are allowed");
  }

  const rows: Record<string, unknown>[] = [];
  for (const row of stmt.iterate(...params) as Iterable<Record<string, unknown>>) {
    rows.push(row);
    if (rows.length > MAX_READ_ONLY_QUERY_ROWS) {
      throw new Error(`Query returned more than ${MAX_READ_ONLY_QUERY_ROWS} rows`);
    }
  }
  const columns = stmt.columns().map((col) => col.name);

  return { rows, rowCount: rows.length, columns };
}
