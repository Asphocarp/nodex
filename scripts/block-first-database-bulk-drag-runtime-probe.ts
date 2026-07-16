import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPage } from "../src/main/local-store/database-pages";
import {
  applyDatabaseModule,
  readDatabaseModule,
} from "../src/main/local-store/database-module";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import {
  DATABASE_MODULE_CONTRACT_VERSION,
  type DatabaseModuleReadSnapshot,
  type DatabaseViewQueryResult,
} from "../src/shared/database-module";
import { compileDatabasePagesDrag } from "../src/shared/database-page-drag";

const invariant = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const readQuery = (projectId: string): DatabaseModuleReadSnapshot => {
  const result = readDatabaseModule(getDb(), {
    version: DATABASE_MODULE_CONTRACT_VERSION,
    projectId,
    read: { target: { kind: "project_default" }, mode: "query" },
  });
  if (result.ok) return result.value;
  throw new Error(result.error.message);
};

const queryValue = (
  snapshot: DatabaseModuleReadSnapshot,
): DatabaseViewQueryResult => {
  if (snapshot.value.kind === "query") return snapshot.value.value;
  throw new Error("Project-default Database query unavailable");
};

const run = async (): Promise<void> => {
  closeDatabase();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-page-drag-runtime-"),
  );
  const previousDirectory = process.env.NODEX_DIR;
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Database Page drag runtime" });
    const selected: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const page = await createPage(project.id, "in_progress", {
        title: `Selected ${index}`,
        priority: "p1-high",
      });
      selected.push(page.id);
    }
    const targetBefore = await createPage(project.id, "done", {
      title: "Target before",
      priority: "p3-low",
    });
    const targetAfter = await createPage(project.id, "done", {
      title: "Target after",
      priority: "p3-low",
    });

    const inputOrder = [...selected].reverse();
    const beforeSnapshot = readQuery(project.id);
    const compiled = compileDatabasePagesDrag({
      move: {
        pageIds: inputOrder,
        fromStatus: "in_progress",
        toStatus: "done",
        newOrder: 1,
        fieldPatch: { priority: "p2-medium" },
      },
      snapshot: beforeSnapshot,
    });
    invariant(
      compiled.operations.length === 2
        && compiled.operations[0]?.kind === "set_values"
        && compiled.operations[1]?.kind === "position_pages",
      "Eighty value writes and forty positions were not compressed to two Page operations",
    );

    const request = {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      operationId: "database-page-drag-runtime",
      projectId: project.id,
      storeEpoch: beforeSnapshot.storeEpoch,
      actor: { kind: "runtime_probe" },
      operations: compiled.operations,
    } as const;
    const committed = applyDatabaseModule(getDb(), request);
    invariant(committed.ok && !committed.value.duplicate, "Page drag did not commit");
    const replayed = applyDatabaseModule(getDb(), request);
    invariant(replayed.ok && replayed.value.duplicate, "Exact retry was not idempotent");

    const after = queryValue(readQuery(project.id));
    const doneOrder = after.rows
      .filter((row) => row.effectiveGroupKey === "done")
      .map((row) => row.page.pageId);
    invariant(
      doneOrder.join(",") === [targetBefore.id, ...inputOrder, targetAfter.id].join(","),
      "Page position run did not preserve visual order at the external anchor",
    );
    const status = after.properties.find((property) => property.key === "status");
    const priority = after.properties.find((property) => property.key === "priority");
    for (const pageId of inputOrder) {
      const row = after.rows.find((candidate) => candidate.page.pageId === pageId);
      invariant(
        row?.values[status?.propertyId ?? ""]?.value === "done"
          && row?.values[priority?.propertyId ?? ""]?.value === "p2-medium",
        `Data Source values were not committed for Page ${pageId}`,
      );
    }
    invariant(
      getDb().pragma("quick_check", { simple: true }) === "ok",
      "SQLite quick_check failed",
    );
    invariant(
      (getDb().pragma("foreign_key_check") as unknown[]).length === 0,
      "SQLite foreign_key_check failed",
    );
    process.stdout.write(`${JSON.stringify({
      pages: inputOrder.length,
      logicalWrites: 120,
      boundedOperations: compiled.operations.length,
      pageCoordinates: true,
      oneReceipt: true,
      exactRetry: true,
      inputOrderPreserved: true,
    })}\n`);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousDirectory;
    }
  }
};

void run();
