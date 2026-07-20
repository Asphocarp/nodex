import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";

import { openPageDocument } from "../shared/block-documents";
import { resetAssetPathCacheForTests } from "./local-store/assets";
import {
  applyBlockDocumentUpdate,
  loadBlockDocument,
} from "./local-store/block-document-store";
import { closeDatabase, getDb, initializeDatabase } from "./local-store/database";
import { createPage } from "./local-store/database-pages";

const enabled = process.env.NODEX_GENERATE_RUST_CORE_V83_FIXTURE === "1";
const generatedRoot = path.resolve(".generated", "rust-core-migration");
const fixtureHome = path.join(generatedRoot, "v83-profile");
const fixtureMarkerName = ".nodex-rust-core-v83-fixture";
const fixtureMarkerContents = "Nodex disposable Rust Core v83 compatibility fixture\n";

const assertDirectoryIsNotSymlink = (directory: string): void => {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing to use unsafe generated directory ${directory}`);
  }
};

const prepareFixtureHome = (): void => {
  const generatedParent = path.dirname(generatedRoot);
  assertDirectoryIsNotSymlink(generatedParent);
  assertDirectoryIsNotSymlink(generatedRoot);

  if (fs.existsSync(fixtureHome)) {
    assertDirectoryIsNotSymlink(fixtureHome);
    const markerPath = path.join(fixtureHome, fixtureMarkerName);
    const marker = fs.lstatSync(markerPath);
    if (!marker.isFile() || marker.isSymbolicLink()) {
      throw new Error(`Refusing to replace unmarked fixture directory ${fixtureHome}`);
    }
    if (fs.readFileSync(markerPath, "utf8") !== fixtureMarkerContents) {
      throw new Error(`Refusing to replace foreign fixture directory ${fixtureHome}`);
    }
    fs.rmSync(fixtureHome, { recursive: true });
  }

  fs.mkdirSync(fixtureHome, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureHome, fixtureMarkerName),
    fixtureMarkerContents,
    { flag: "wx" },
  );
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_HOME;
});

describe.runIf(enabled)("Rust Core v83 compatibility fixture", () => {
  test("creates a representative TypeScript-authoritative profile", async () => {
    prepareFixtureHome();
    process.env.NODEX_HOME = fixtureHome;
    resetAssetPathCacheForTests();
    await initializeDatabase();

    const database = getDb();
    const project = database.prepare(`
      SELECT id
      FROM projects
      WHERE lifecycle = 'active'
      ORDER BY created, id
      LIMIT 1
    `).get() as { readonly id: string } | undefined;
    if (!project) throw new Error("v83 fixture has no active Project");

    const page = await createPage(project.id, "triage", {
      title: "Rust Core v83 兼容性 😀",
      description: [
        "rustcorev83token validates the authoritative FTS projection.",
        "第二行覆盖 Unicode、换行与 Yjs snapshot 重放。",
      ].join("\n"),
      tags: ["rust-core", "migration"],
      assignee: "fixture@example.test",
    });

    const documentId = `document:${page.id}`;
    const loaded = loadBlockDocument(database, documentId);
    const beforeVector = Y.encodeStateVector(loaded.document);
    const title = openPageDocument(loaded.document).title;
    title.insert(title.length, " — incremental tail");
    const incrementalUpdate = Y.encodeStateAsUpdate(
      loaded.document,
      beforeVector,
    );
    const acknowledgment = applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch: loaded.storeEpoch,
      generation: loaded.head.generation,
      updateId: randomUUID(),
      clientSessionId: "rust-core-v83-fixture",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [page.id],
      update: incrementalUpdate,
    });
    loaded.document.destroy();

    expect(acknowledgment.headSeq).toBeGreaterThan(loaded.head.headSeq);
    expect(database.pragma("user_version", { simple: true })).toBe(83);
    database.pragma("wal_checkpoint(TRUNCATE)");

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      databaseUserVersion: 83,
      projectId: project.id,
      pageId: page.id,
      documentId,
      expectedTitle: "Rust Core v83 兼容性 😀 — incremental tail",
      searchToken: "rustcorev83token",
      expectedMinimumHeadSeq: acknowledgment.headSeq,
    };
    fs.writeFileSync(
      path.join(fixtureHome, "fixture-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    closeDatabase();

    expect(fs.existsSync(path.join(fixtureHome, "nodex.db"))).toBe(true);
  }, 120_000);
});
