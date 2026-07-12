import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  CANVAS_SCENE_SYNC_VERSION,
  canonicalPortableCanvasSceneSemanticFingerprint,
  materializePortableCanvasScene,
  primaryCanvasBlockId,
  type CanvasSceneMutationRequest,
} from "../../shared/block-documents";
import { getOwnedDocumentDescriptor } from "./block-document-cutover";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import {
  applyCanvasSceneMutation,
  initializeCanvasSceneAuthority,
  syncCanvasScene,
} from "./canvas-scene-store";
import {
  materializeInlineCanvasImage,
  resetAssetPathCacheForTests,
} from "./assets";

const supportsBetterSqlite3 = (): boolean => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("better-sqlite3") &&
      message.includes("not yet supported")
    ) {
      return false;
    }
    throw error;
  }
};

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite3() ? test : skipTest;
const directories: string[] = [];

interface CanvasFixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
}

const createFixture = async (name: string): Promise<CanvasFixture> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-canvas-scene-"));
  directories.push(directory);
  closeDatabase();
  process.env.NODEX_DIR = directory;
  resetAssetPathCacheForTests();
  await initializeDatabase();
  const project = createProject({ name });
  const database = getDb();
  const descriptor = getOwnedDocumentDescriptor(
    database,
    project.id,
    primaryCanvasBlockId(project.id),
  );
  if (descriptor.sync.kind !== "canvas_scene") {
    throw new Error("Expected Canvas scene sync engine");
  }
  const scene = materializePortableCanvasScene({ elements: [] });
  const initialized = initializeCanvasSceneAuthority(database, {
    projectId: project.id,
    documentId: descriptor.documentId,
    expectedGeneration: descriptor.generation,
    expectedHeadSeq: descriptor.headSeq,
    scene,
  });
  return {
    database,
    projectId: project.id,
    documentId: descriptor.documentId,
    storeEpoch: descriptor.storeEpoch,
    generation: descriptor.generation,
    headSeq: initialized.headSeq,
  };
};

const mutation = (
  fixture: CanvasFixture,
  input: Partial<CanvasSceneMutationRequest> & Pick<CanvasSceneMutationRequest, "mutationId">,
): CanvasSceneMutationRequest => ({
  version: CANVAS_SCENE_SYNC_VERSION,
  projectId: fixture.projectId,
  documentId: fixture.documentId,
  storeEpoch: fixture.storeEpoch,
  generation: fixture.generation,
  baseHeadSeq: fixture.headSeq,
  clientSessionId: "canvas-scene-store-test",
  elementCandidates: [],
  appStateIntents: {},
  fileAdditions: {},
  ...input,
});

const shape = (
  version: number,
  versionNonce: number,
  x: number,
  extra: Readonly<Record<string, unknown>> = {},
) => ({
  id: "shape",
  type: "rectangle",
  isDeleted: false,
  version,
  versionNonce,
  index: "a0",
  x,
  ...extra,
});

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  resetAssetPathCacheForTests();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Canvas scene SQLite authority", () => {
  sqliteTest("initializes and returns a canonical full scene without Yjs state", async () => {
    const fixture = await createFixture("Canvas full sync");
    const result = syncCanvasScene(fixture.database, {
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      clientSessionId: "sync-client",
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        projectId: fixture.projectId,
        documentId: fixture.documentId,
        generation: fixture.generation,
        headSeq: fixture.headSeq,
        sceneHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        scene: expect.objectContaining({ elements: [], files: {} }),
      }),
    });
    expect(
      fixture.database
        .prepare("SELECT COUNT(*) AS count FROM canvas_scenes WHERE document_id = ?")
        .get(fixture.documentId),
    ).toEqual({ count: 1 });
  });

  sqliteTest("converges opposite delivery orders through version and nonce winners", async () => {
    const first = await createFixture("Canvas merge first");
    const firstLow = applyCanvasSceneMutation(
      first.database,
      mutation(first, {
        mutationId: "first-low",
        elementCandidates: [shape(2, 90, 10)],
      }),
    );
    expect(firstLow.ok).toBe(true);
    const firstHigh = applyCanvasSceneMutation(
      first.database,
      mutation(first, {
        mutationId: "first-high",
        elementCandidates: [shape(2, 10, 20)],
      }),
    );
    expect(firstHigh.ok).toBe(true);
    const firstScene = syncCanvasScene(first.database, {
      version: 1,
      projectId: first.projectId,
      documentId: first.documentId,
      clientSessionId: "read-first",
    });
    expect(firstScene.ok).toBe(true);
    if (!firstScene.ok) throw new Error(firstScene.error.message);

    const second = await createFixture("Canvas merge second");
    applyCanvasSceneMutation(
      second.database,
      mutation(second, {
        mutationId: "second-high",
        elementCandidates: [shape(2, 10, 20)],
      }),
    );
    const staleLoser = applyCanvasSceneMutation(
      second.database,
      mutation(second, {
        mutationId: "second-low",
        elementCandidates: [shape(2, 90, 10)],
      }),
    );
    expect(staleLoser).toEqual({
      ok: true,
      value: expect.objectContaining({ outcome: "no_change" }),
    });
    const secondScene = syncCanvasScene(second.database, {
      version: 1,
      projectId: second.projectId,
      documentId: second.documentId,
      clientSessionId: "read-second",
    });
    expect(secondScene.ok).toBe(true);
    if (!secondScene.ok) throw new Error(secondScene.error.message);

    expect(firstScene.value.scene.elements[0]).toMatchObject({ x: 20 });
    expect(secondScene.value.scene.elements[0]).toMatchObject({ x: 20 });
    expect(
      canonicalPortableCanvasSceneSemanticFingerprint(firstScene.value.scene),
    ).toBe(
      canonicalPortableCanvasSceneSemanticFingerprint(secondScene.value.scene),
    );
  });

  sqliteTest("records no-op receipts, replays exactly, and rejects collisions and future heads", async () => {
    const fixture = await createFixture("Canvas receipts");
    const request = mutation(fixture, { mutationId: "noop" });
    const first = applyCanvasSceneMutation(fixture.database, request, {
      now: () => "2026-07-13T00:00:00.000Z",
    });
    expect(first).toEqual({
      ok: true,
      value: expect.objectContaining({
        duplicate: false,
        outcome: "no_change",
        headSeq: fixture.headSeq,
      }),
    });
    expect(applyCanvasSceneMutation(fixture.database, request)).toEqual({
      ok: true,
      value: expect.objectContaining({ duplicate: true, outcome: "no_change" }),
    });
    const collision = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "noop",
        appStateIntents: {
          gridSize: {
            expected: { kind: "absent" },
            value: { kind: "value", value: 20 },
          },
        },
      }),
    );
    expect(collision).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "mutation_id_collision" }),
    });
    const future = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "future",
        baseHeadSeq: fixture.headSeq + 1,
      }),
    );
    expect(future).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "future_base_head",
        retryable: false,
        resetRequired: true,
      }),
    });
  });

  sqliteTest("uses per-field appState CAS while allowing stale element merges", async () => {
    const fixture = await createFixture("Canvas app state CAS");
    const first = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "grid-first",
        appStateIntents: {
          gridSize: {
            expected: { kind: "absent" },
            value: { kind: "value", value: 20 },
          },
        },
      }),
    );
    expect(first.ok).toBe(true);
    const stale = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "grid-stale",
        elementCandidates: [shape(1, 1, 3)],
        appStateIntents: {
          gridSize: {
            expected: { kind: "absent" },
            value: { kind: "value", value: 40 },
          },
        },
      }),
    );
    expect(stale).toEqual({
      ok: true,
      value: expect.objectContaining({
        outcome: "committed",
        skippedAppStateKeys: ["gridSize"],
      }),
      event: expect.objectContaining({ baseHeadSeq: fixture.headSeq + 1 }),
    });
    const synced = syncCanvasScene(fixture.database, {
      version: 1,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      clientSessionId: "app-state-read",
    });
    expect(synced.ok).toBe(true);
    if (synced.ok) expect(synced.value.scene.appState.gridSize).toBe(20);
  });

  sqliteTest("keeps immutable referenced files and prunes them only after a winning tombstone", async () => {
    const fixture = await createFixture("Canvas files");
    const managed = materializeInlineCanvasImage(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    const image = {
      id: "image",
      type: "image",
      fileId: "file-1",
      isDeleted: false,
      version: 1,
      versionNonce: 1,
      index: "a0",
    };
    const added = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "add-image",
        elementCandidates: [image],
        fileAdditions: {
          "file-1": {
            id: "file-1",
            mimeType: managed.mimeType,
            source: managed.source,
          },
        },
      }),
    );
    expect(added).toEqual({
      ok: true,
      value: expect.objectContaining({ addedFileIds: ["file-1"] }),
      event: expect.objectContaining({
        fileAdditions: { "file-1": expect.objectContaining({ id: "file-1" }) },
      }),
    });
    const redefined = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "redefine-image",
        fileAdditions: {
          "file-1": {
            id: "file-1",
            mimeType: "image/jpeg",
            source: managed.source,
          },
        },
      }),
    );
    expect(redefined).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid_canvas_scene_mutation" }),
    });
    const removed = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "delete-image",
        elementCandidates: [{ ...image, version: 2, isDeleted: true }],
      }),
    );
    expect(removed).toEqual({
      ok: true,
      value: expect.objectContaining({ removedFileIds: ["file-1"] }),
      event: expect.objectContaining({ removedFileIds: ["file-1"] }),
    });
    expect(
      fixture.database
        .prepare("SELECT COUNT(*) AS count FROM canvas_scene_files WHERE document_id = ?")
        .get(fixture.documentId),
    ).toEqual({ count: 0 });
  });

  sqliteTest("rejects missing managed assets before authority or receipts advance", async () => {
    const fixture = await createFixture("Canvas missing asset");
    const result = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "missing-asset",
        elementCandidates: [
          {
            id: "missing-image",
            type: "image",
            fileId: "missing-file",
            isDeleted: false,
            version: 1,
            versionNonce: 1,
            index: "a0",
          },
        ],
        fileAdditions: {
          "missing-file": {
            id: "missing-file",
            mimeType: "image/png",
            source: "nodex://assets/does-not-exist.png",
          },
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "invalid_canvas_scene_mutation",
        retryable: false,
      }),
    });
    expect(
      fixture.database
        .prepare(
          `SELECT
             (SELECT head_seq FROM documents WHERE id = ?) AS head_seq,
             (SELECT COUNT(*) FROM canvas_scene_elements WHERE document_id = ?) AS elements,
             (SELECT COUNT(*) FROM canvas_scene_mutation_receipts WHERE document_id = ?) AS receipts`,
        )
        .get(fixture.documentId, fixture.documentId, fixture.documentId),
    ).toEqual({ head_seq: fixture.headSeq, elements: 0, receipts: 0 });
  });

  sqliteTest("rejects cross-Project Card references without advancing authority", async () => {
    const fixture = await createFixture("Canvas reference scope");
    const before = syncCanvasScene(fixture.database, {
      version: 1,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      clientSessionId: "before-reference",
    });
    if (!before.ok) throw new Error(before.error.message);
    const result = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "foreign-reference",
        elementCandidates: [
          shape(1, 1, 0, {
            customData: {
              type: "nodex-card-reference",
              targetBlockId: "missing-card",
            },
          }),
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid_canvas_scene_mutation" }),
    });
    const after = syncCanvasScene(fixture.database, {
      version: 1,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      clientSessionId: "after-reference",
    });
    expect(after).toEqual(before);
  });
});
