import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resetAssetPathCacheForTests } from "../local-store/assets";
import { closeDatabase, initializeDatabase } from "../local-store/database";
import { upsertCodexThread } from "./codex-link-repository";
import {
  copyCodexThreadDynamicToolCatalogs,
  getCodexThreadDynamicToolCatalogs,
  getCodexThreadDynamicToolRevision,
  replaceCodexThreadDynamicToolCatalogs,
} from "./codex-dynamic-tool-catalog-repository";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  resetAssetPathCacheForTests();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-tool-catalog-"));
  process.env.NODEX_HOME = tempDirectory;
  await initializeDatabase();
  upsertCodexThread({ threadId: "source-thread" });
  upsertCodexThread({ threadId: "target-thread" });
});

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_HOME;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Codex thread dynamic-tool catalogs", () => {
  test("atomically replaces, reads, and copies namespace revisions", () => {
    replaceCodexThreadDynamicToolCatalogs("source-thread", [
      { namespace: "nodex_app", toolsetRevision: 1 },
      { namespace: "codex_app", toolsetRevision: 3 },
    ]);

    expect(getCodexThreadDynamicToolCatalogs("source-thread")).toEqual([
      { namespace: "codex_app", toolsetRevision: 3 },
      { namespace: "nodex_app", toolsetRevision: 1 },
    ]);
    expect(getCodexThreadDynamicToolRevision("source-thread", "nodex_app")).toBe(1);
    expect(getCodexThreadDynamicToolRevision("source-thread", "missing")).toBe(null);

    copyCodexThreadDynamicToolCatalogs("source-thread", "target-thread");
    expect(getCodexThreadDynamicToolCatalogs("target-thread")).toEqual(
      getCodexThreadDynamicToolCatalogs("source-thread"),
    );
  });

  test("rejects duplicate namespace revisions without disturbing prior bindings", () => {
    replaceCodexThreadDynamicToolCatalogs("source-thread", [
      { namespace: "codex_app", toolsetRevision: 1 },
    ]);

    expect(() => replaceCodexThreadDynamicToolCatalogs("source-thread", [
      { namespace: "codex_app", toolsetRevision: 1 },
      { namespace: "codex_app", toolsetRevision: 2 },
    ])).toThrow("cannot bind multiple revisions");
    expect(getCodexThreadDynamicToolCatalogs("source-thread")).toEqual([
      { namespace: "codex_app", toolsetRevision: 1 },
    ]);
  });
});
