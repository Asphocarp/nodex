import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resetAssetPathCacheForTests } from "./assets";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  assertNodexAgentEtag,
  mintNodexAgentEtag,
  NodexAgentEtagError,
  type NodexAgentEtagState,
} from "./nodex-agent-etag";
import { createProject } from "./projects";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  resetAssetPathCacheForTests();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-etag-"));
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

function expectEtagError(
  run: () => void,
  code: NodexAgentEtagError["code"],
): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(NodexAgentEtagError);
    expect((error as NodexAgentEtagError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Nodex Agent ETag", () => {
  test("mints one deterministic 48-character digest across object key order and reopen", () => {
    const project = createProject({ name: "ETag project" });
    const input: NodexAgentEtagState = {
      kind: "document_body",
      projectId: project.id,
      subject: ["document-1"],
      state: {
        generation: 3,
        nested: { beta: true, alpha: [2, 1] },
        headSeq: 8,
      },
    };
    const reordered: NodexAgentEtagState = {
      ...input,
      state: {
        headSeq: 8,
        nested: { alpha: [2, 1], beta: true },
        generation: 3,
      },
    };

    const etag = mintNodexAgentEtag(getDb(), input);
    expect(etag).toHaveLength(48);
    expect(etag).toMatch(/^nxe1\.[A-Za-z0-9_-]{43}$/);
    expect(mintNodexAgentEtag(getDb(), reordered)).toBe(etag);

    closeDatabase();
    expect(() => assertNodexAgentEtag(getDb(), etag, reordered)).not.toThrow();
  });

  test("classifies malformed values separately from well-formed mismatches", () => {
    const first = createProject({ name: "First ETag project" });
    const second = createProject({ name: "Second ETag project" });
    const current: NodexAgentEtagState = {
      kind: "database_value",
      projectId: first.id,
      subject: ["database-1", "block-1", "property-1"],
      state: { valueRevision: 4, value: "Todo" },
    };
    const etag = mintNodexAgentEtag(getDb(), current);

    expectEtagError(
      () => assertNodexAgentEtag(getDb(), "nxe1.short", current),
      "invalid_etag",
    );
    expectEtagError(
      () => assertNodexAgentEtag(getDb(), `nxc1.${etag.slice(5)}`, current),
      "invalid_etag",
    );

    const tamperIndex = 10;
    const tampered = `${etag.slice(0, tamperIndex)}${etag[tamperIndex] === "a" ? "b" : "a"}${etag.slice(tamperIndex + 1)}`;
    const mismatches: readonly NodexAgentEtagState[] = [
      { ...current, state: { valueRevision: 5, value: "Done" } },
      { ...current, kind: "view_placement" },
      { ...current, subject: ["database-1", "block-2", "property-1"] },
      { ...current, projectId: second.id },
    ];
    expectEtagError(
      () => assertNodexAgentEtag(getDb(), tampered, current),
      "etag_mismatch",
    );
    for (const mismatch of mismatches) {
      expectEtagError(
        () => assertNodexAgentEtag(getDb(), etag, mismatch),
        "etag_mismatch",
      );
    }
  });

  test("invalidates an ETag after store replacement and never embeds semantic state", () => {
    const project = createProject({ name: "Epoch ETag project" });
    const current: NodexAgentEtagState = {
      kind: "document_subtree",
      projectId: project.id,
      subject: ["document-1", "secret-block-id"],
      state: { secretRevision: 918_273, content: "private semantic state" },
    };
    const etag = mintNodexAgentEtag(getDb(), current);
    const parts = etag.split(".");

    expect(parts).toHaveLength(2);
    expect(Buffer.from(parts[1] ?? "", "base64url")).toHaveLength(32);
    expect(etag).not.toContain("secret-block-id");
    expect(etag).not.toContain("private semantic state");

    getDb().prepare(
      "UPDATE block_store_metadata SET store_epoch = ? WHERE id = 1",
    ).run("replacement-epoch");
    expectEtagError(
      () => assertNodexAgentEtag(getDb(), etag, current),
      "etag_mismatch",
    );
  });
});
