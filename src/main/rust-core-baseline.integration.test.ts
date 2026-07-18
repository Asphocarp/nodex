import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { resetAssetPathCacheForTests } from "./local-store/assets";
import { closeDatabase, getDb, initializeDatabase } from "./local-store/database";
import { createPage, getBoard } from "./local-store/database-pages";
import { readPageDetailInDatabase } from "./local-store/page-detail";

const enabled = process.env.NODEX_MEASURE_RUST_CORE_BASELINE === "1";
const temporaryDirectories: string[] = [];

const disposableStore = (label: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `nodex-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
};

const useStore = (directory: string): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  process.env.NODEX_HOME = directory;
};

const elapsedMilliseconds = async (operation: () => unknown): Promise<number> => {
  const startedAt = process.hrtime.bigint();
  await operation();
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
};

const percentile = (samples: readonly number[], ratio: number): number => {
  if (samples.length === 0) throw new Error("Cannot summarize an empty sample set");
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * ratio) - 1),
  );
  const value = ordered[index];
  if (value === undefined) throw new Error("Percentile index is out of bounds");
  return Number(value.toFixed(3));
};

const summary = (samples: readonly number[]) => ({
  count: samples.length,
  minMs: percentile(samples, 0),
  p50Ms: percentile(samples, 0.5),
  p95Ms: percentile(samples, 0.95),
  maxMs: percentile(samples, 1),
});

const gitCommit = (): string =>
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_HOME;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.runIf(enabled)("TypeScript authority baseline", () => {
  test("records Gate E comparison samples", { timeout: 180_000 }, async () => {
    const coldReadinessMs: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const home = disposableStore(`rust-core-cold-${index}`);
      useStore(home);
      coldReadinessMs.push(await elapsedMilliseconds(initializeDatabase));
      closeDatabase();
    }

    const fixtureHome = disposableStore("rust-core-baseline");
    useStore(fixtureHome);
    await initializeDatabase();
    const database = getDb();
    const project = database.prepare(`
      SELECT id FROM projects
      WHERE lifecycle = 'active'
      ORDER BY created, id
      LIMIT 1
    `).get() as { readonly id: string } | undefined;
    if (!project) throw new Error("Baseline fixture has no active Project");

    const pageIds: string[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      const page = await createPage(project.id, "triage", {
        title: `Rust Core baseline Page ${String(index + 1).padStart(4, "0")}`,
        description: `Search projection body ${index + 1}\nShared benchmark token`,
      });
      pageIds.push(page.id);
    }
    const firstPageId = pageIds[0];
    if (!firstPageId) throw new Error("Baseline fixture did not create a Page");

    const warmPageReadMs: number[] = [];
    readPageDetailInDatabase(database, project.id, firstPageId);
    for (let index = 0; index < 100; index += 1) {
      warmPageReadMs.push(await elapsedMilliseconds(() => {
        const result = readPageDetailInDatabase(database, project.id, firstPageId);
        if (!result.ok) throw new Error(result.error.message);
      }));
    }

    const semanticMutationMs: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      semanticMutationMs.push(await elapsedMilliseconds(() =>
        createPage(project.id, "triage", {
          title: `Measured semantic mutation ${index + 1}`,
          description: "Representative transaction with Document and Database projections",
        })));
    }

    const searchAssemblyMs: number[] = [];
    await getBoard(project.id);
    for (let index = 0; index < 30; index += 1) {
      searchAssemblyMs.push(await elapsedMilliseconds(async () => {
        const board = await getBoard(project.id);
        const projection = board.columns.flatMap((column) =>
          column.cards.map((page) =>
            `${page.id}/meta.yaml\n${page.title}\n${page.id}/body.nested.md\n${page.description}`
          ));
        if (projection.length < 1_000) {
          throw new Error("Search assembly lost fixture Pages");
        }
      }));
    }

    const databasePath = path.join(fixtureHome, "nodex.db");
    const report = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      gitCommit: gitCommit(),
      command: "pnpm run core:baseline:typescript",
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        osRelease: os.release(),
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        logicalCpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        node: process.versions.node,
        electron: process.versions.electron ?? null,
      },
      fixture: {
        pageCount: 1_000,
        bodyBytesPerPage: "approximately 48-51 UTF-8 bytes",
        databaseBytes: fs.statSync(databasePath).size,
      },
      scenarios: {
        coldTypeScriptAuthorityReadiness: {
          definition: "initialize a fresh Profile through initializeDatabase",
          samplesMs: coldReadinessMs,
          summary: summary(coldReadinessMs),
        },
        warmOnePageRead: {
          definition: "readPageDetailInDatabase on one initialized Page",
          samplesMs: warmPageReadMs,
          summary: summary(warmPageReadMs),
        },
        semanticMutationCommit: {
          definition: "createPage authoritative Page+Document+Database transaction",
          samplesMs: semanticMutationMs,
          summary: summary(semanticMutationMs),
        },
        thousandPageSearchAssembly: {
          definition: "getBoard plus two-file logical projection assembly before search",
          samplesMs: searchAssemblyMs,
          summary: summary(searchAssemblyMs),
        },
      },
      process: {
        residentSetBytes: process.memoryUsage().rss,
      },
    };

    const outputDirectory = path.resolve(
      ".generated/rust-core-migration/baseline",
    );
    fs.mkdirSync(outputDirectory, { recursive: true });
    const output = path.join(outputDirectory, "typescript-authority.json");
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\nRust Core TypeScript baseline: ${output}\n`);

    expect(report.fixture.databaseBytes).toBeGreaterThan(0);
    expect(report.scenarios.warmOnePageRead.summary.p95Ms).toBeGreaterThan(0);
  });
});
