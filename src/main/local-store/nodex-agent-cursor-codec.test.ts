import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resetAssetPathCacheForTests } from "./assets";
import {
  decodeNodexAgentCursor,
  mintNodexAgentCursor,
  NodexAgentCursorError,
} from "./nodex-agent-cursor-codec";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { mintNodexAgentEtag } from "./nodex-agent-etag";
import { createProject } from "./projects";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  resetAssetPathCacheForTests();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-cursor-"));
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

function expectCursorError(
  run: () => void,
  code: NodexAgentCursorError["code"],
): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(NodexAgentCursorError);
    expect((error as NodexAgentCursorError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Nodex Agent cursor codec", () => {
  test("round-trips a signed query snapshot across process-style database reopen", () => {
    const project = createProject({ name: "Cursor project" });
    const cursor = mintNodexAgentCursor(getDb(), {
      projectId: project.id,
      subject: ["query_database", "database-1"],
      offset: 40,
      state: { queryFingerprint: "query-fingerprint", snapshotSeq: 12 },
    });
    expect(cursor).toMatch(/^nxc1\./);

    closeDatabase();
    const decoded = decodeNodexAgentCursor(getDb(), cursor, {
      projectId: project.id,
      subject: ["query_database", "database-1"],
    });
    expect(decoded).toMatchObject({
      version: 1,
      kind: "cursor",
      projectId: project.id,
      offset: 40,
      state: { queryFingerprint: "query-fingerprint", snapshotSeq: 12 },
    });
  });

  test("rejects tampering, ETags, and cross-Project or cross-query use", () => {
    const first = createProject({ name: "First cursor project" });
    const second = createProject({ name: "Second cursor project" });
    const cursor = mintNodexAgentCursor(getDb(), {
      projectId: first.id,
      subject: ["search", "all"],
      offset: 20,
      state: { queryFingerprint: "search-query" },
    });
    const signatureStart = cursor.lastIndexOf(".") + 1;
    const tamperIndex = signatureStart + 10;
    const tampered = `${cursor.slice(0, tamperIndex)}${cursor[tamperIndex] === "a" ? "b" : "a"}${cursor.slice(tamperIndex + 1)}`;
    const etag = mintNodexAgentEtag(getDb(), {
      kind: "title",
      projectId: first.id,
      subject: ["document-1"],
      state: { title: "Title" },
    });

    expectCursorError(
      () => decodeNodexAgentCursor(getDb(), tampered, {
        projectId: first.id,
        subject: ["search", "all"],
      }),
      "invalid_cursor",
    );
    expectCursorError(
      () => decodeNodexAgentCursor(getDb(), etag, {
        projectId: first.id,
        subject: ["search", "all"],
      }),
      "invalid_cursor",
    );
    expectCursorError(
      () => decodeNodexAgentCursor(getDb(), cursor, {
        projectId: second.id,
        subject: ["search", "all"],
      }),
      "cursor_scope_mismatch",
    );
    expectCursorError(
      () => decodeNodexAgentCursor(getDb(), cursor, {
        projectId: first.id,
        subject: ["search", "cards"],
      }),
      "cursor_scope_mismatch",
    );
  });

  test("invalidates a cursor after the store epoch changes", () => {
    const project = createProject({ name: "Epoch cursor project" });
    const cursor = mintNodexAgentCursor(getDb(), {
      projectId: project.id,
      subject: ["get_block", "document-1"],
      offset: 10,
      state: { documentHead: 3 },
    });
    getDb().prepare(
      "UPDATE block_store_metadata SET store_epoch = ? WHERE id = 1",
    ).run("replacement-epoch");

    expectCursorError(
      () => decodeNodexAgentCursor(getDb(), cursor, {
        projectId: project.id,
        subject: ["get_block", "document-1"],
      }),
      "store_epoch_mismatch",
    );
  });
});
