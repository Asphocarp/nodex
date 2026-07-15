import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resetAssetPathCacheForTests } from "./assets";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import {
  decodeNodexAgentToken,
  mintNodexAgentToken,
} from "./nodex-agent-token-codec";

let tempDirectory = "";

beforeEach(async () => {
  closeDatabase();
  resetAssetPathCacheForTests();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-token-"));
  process.env.NODEX_DIR = tempDirectory;
  await initializeDatabase();
});

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Nodex Agent token codec", () => {
  test("round-trips signed resource state across process-style database reopen", () => {
    const project = createProject({ name: "Token project" });
    const token = mintNodexAgentToken(getDb(), {
      kind: "document",
      projectId: project.id,
      subject: ["document-1"],
      state: { generation: 3, headSeq: 8 },
    });

    closeDatabase();
    const decoded = decodeNodexAgentToken(getDb(), token, {
      kind: "document",
      projectId: project.id,
      subject: ["document-1"],
    });

    expect(decoded.state).toEqual({ generation: 3, headSeq: 8 });
  });

  test("rejects tampering and cross-kind, cross-resource, and cross-Project use", () => {
    const first = createProject({ name: "First" });
    const second = createProject({ name: "Second" });
    const token = mintNodexAgentToken(getDb(), {
      kind: "location",
      projectId: first.id,
      subject: ["block-1"],
      state: { revision: 4 },
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(() => decodeNodexAgentToken(getDb(), tampered, {
      kind: "location",
      projectId: first.id,
      subject: ["block-1"],
    })).toThrow("signature is invalid");
    expect(() => decodeNodexAgentToken(getDb(), token, {
      kind: "document",
      projectId: first.id,
      subject: ["block-1"],
    })).toThrow("Expected a document token");
    expect(() => decodeNodexAgentToken(getDb(), token, {
      kind: "location",
      projectId: first.id,
      subject: ["block-2"],
    })).toThrow("another Project or resource");
    expect(() => decodeNodexAgentToken(getDb(), token, {
      kind: "location",
      projectId: second.id,
      subject: ["block-1"],
    })).toThrow("another Project or resource");
  });

  test("rejects a token after the store epoch changes", () => {
    const project = createProject({ name: "Epoch project" });
    const token = mintNodexAgentToken(getDb(), {
      kind: "view",
      projectId: project.id,
      subject: ["view-1"],
      state: { revision: 1 },
    });
    getDb().prepare(
      "UPDATE block_store_metadata SET store_epoch = ? WHERE id = 1",
    ).run("replacement-epoch");

    expect(() => decodeNodexAgentToken(getDb(), token, {
      kind: "view",
      projectId: project.id,
      subject: ["view-1"],
    })).toThrow("another store epoch");
  });
});
