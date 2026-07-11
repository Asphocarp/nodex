import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-project-transfer-probe-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const database = getDb();
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as readonly { readonly name: string }[];
    const foreignKeys = tables.flatMap(({ name }) =>
      (database.pragma(`foreign_key_list(${JSON.stringify(name)})`) as readonly {
        readonly id: number;
        readonly seq: number;
        readonly table: string;
        readonly from: string;
        readonly to: string;
        readonly on_update: string;
        readonly on_delete: string;
      }[]).map((foreignKey) => ({ child: name, ...foreignKey })),
    );
    process.stdout.write(`${JSON.stringify({ foreignKeys }, null, 2)}\n`);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
  }
};

void main();
