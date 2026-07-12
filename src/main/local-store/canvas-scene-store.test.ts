import Database from "better-sqlite3";
import { createHash } from "node:crypto";
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
import { loadPrimaryBlockDocument } from "./block-document-store";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { createProject } from "./projects";
import {
  applyCanvasSceneMutation,
  initializeCanvasSceneAuthority,
  syncCanvasScene,
} from "./canvas-scene-store";
import {
  createDocumentVersionCheckpoint,
  getDocumentVersionDetail,
} from "./document-versions";
import { restoreDocumentVersion } from "./block-document-operations";
import { prepareEditableOwnedBlockDocument } from "./owned-block-document-preparation";
import {
  materializeInlineCanvasImage,
  resetAssetPathCacheForTests,
} from "./assets";
import { validateBackupStore } from "./backup-store-validation";

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
  sqliteTest("checkpoints and forward-restores Canvas through scene-native history", async () => {
    const fixture = await createFixture("Canvas history");
    const first = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "history-first",
        elementCandidates: [shape(1, 1, 10)],
      }),
    );
    if (!first.ok) throw new Error(first.error.message);
    const checkpoint = createDocumentVersionCheckpoint(fixture.database, {
      version: 1,
      projectId: fixture.projectId,
      storeEpoch: fixture.storeEpoch,
      documentId: fixture.documentId,
      expectedGeneration: fixture.generation,
      expectedHeadSeq: first.value.headSeq,
      cause: "manual",
      actor: { kind: "test" },
    });
    expect(checkpoint.checkpoint.checkpointMetadata).toEqual({
      format: "canvas_scene_json_v1",
    });
    expect("fullUpdate" in checkpoint.checkpoint).toBe(false);
    expect("stateVector" in checkpoint.checkpoint).toBe(false);
    expect("sceneJson" in checkpoint.checkpoint).toBe(true);
    expect(
      getDocumentVersionDetail(fixture.database, {
        projectId: fixture.projectId,
        documentId: fixture.documentId,
        versionId: checkpoint.checkpoint.versionId,
      }).materialization,
    ).toMatchObject({ kind: "canvas_scene", elements: [expect.objectContaining({ x: 10 })] });

    const second = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "history-second",
        baseHeadSeq: first.value.headSeq,
        elementCandidates: [shape(2, 2, 20)],
      }),
    );
    if (!second.ok) throw new Error(second.error.message);
    const restoreRequest = {
      version: 1 as const,
      mutationId: "history-restore",
      projectId: fixture.projectId,
      storeEpoch: fixture.storeEpoch,
      actor: { kind: "test" },
      clientSessionId: "canvas-history-test",
      documentId: fixture.documentId,
      versionId: checkpoint.checkpoint.versionId,
      generation: fixture.generation,
      expectedHeadSeq: second.value.headSeq,
    };
    expect(restoreDocumentVersion(fixture.database, restoreRequest)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "write_fence_required" }),
    });
    const restored = restoreDocumentVersion(fixture.database, restoreRequest, {
      writeFence: {
        leaseId: "canvas-history-lease",
        documentId: fixture.documentId,
        generation: fixture.generation,
        headSeq: second.value.headSeq,
      },
    });
    expect(restored).toEqual({
      ok: true,
      value: expect.objectContaining({
        mutationKind: "document_version_restore",
        coordination: "write_fence",
        baseHeadSeq: second.value.headSeq,
        headSeq: second.value.headSeq + 1,
        duplicate: false,
      }),
    });
    const synced = syncCanvasScene(fixture.database, {
      version: 1,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      clientSessionId: "history-read",
    });
    if (!synced.ok) throw new Error(synced.error.message);
    expect(synced.value.scene.elements[0]).toMatchObject({ x: 10, isDeleted: false });
    expect(synced.value.scene.elements[0]?.version).toBeGreaterThan(2);
    expect(
      fixture.database.prepare(
        "SELECT checkpoint_format, length(state_vector) AS state_vector_bytes FROM document_versions WHERE version_id = ?",
      ).get(checkpoint.checkpoint.versionId),
    ).toEqual({ checkpoint_format: "canvas_scene_json_v1", state_vector_bytes: 0 });
    expect(restoreDocumentVersion(fixture.database, restoreRequest, {
      writeFence: {
        leaseId: "canvas-history-lease",
        documentId: fixture.documentId,
        generation: fixture.generation,
        headSeq: second.value.headSeq,
      },
    })).toEqual({
      ok: true,
      value: expect.objectContaining({ duplicate: true }),
    });
  });

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
    expect(() =>
      loadPrimaryBlockDocument(fixture.database, fixture.documentId),
    ).toThrow(/cannot enter the Yjs runtime/u);
    const prepared = prepareEditableOwnedBlockDocument(
      fixture.database,
      fixture.projectId,
      primaryCanvasBlockId(fixture.projectId),
    );
    expect(prepared.repairedEmptyRoot).toBe(false);
    expect(prepared.descriptor.sync).toEqual({ kind: "canvas_scene" });
    expect(
      fixture.database
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM document_updates WHERE document_id = ?) +
            (SELECT COUNT(*) FROM document_snapshots WHERE document_id = ?) +
            (SELECT COUNT(*) FROM document_update_receipts WHERE document_id = ?)
              AS count`,
        )
        .get(fixture.documentId, fixture.documentId, fixture.documentId),
    ).toEqual({ count: 0 });
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

  sqliteTest("fails closed when immutable Canvas result evidence is corrupted", async () => {
    const fixture = await createFixture("Canvas receipt integrity");
    const request = mutation(fixture, {
      mutationId: "corrupt-result-evidence",
      elementCandidates: [shape(1, 1, 10)],
    });
    const committed = applyCanvasSceneMutation(fixture.database, request);
    expect(committed.ok).toBe(true);
    fixture.database.exec(
      "DROP TRIGGER canvas_scene_mutation_receipts_immutable_update",
    );
    const stored = fixture.database
      .prepare(
        `SELECT result_json FROM canvas_scene_mutation_receipts
         WHERE document_id = ? AND mutation_id = ?`,
      )
      .get(fixture.documentId, request.mutationId) as {
      readonly result_json: string;
    };
    const corruptResult = JSON.stringify({
      ...(JSON.parse(stored.result_json) as Readonly<Record<string, unknown>>),
      sceneHash: "not-a-sha256",
    });
    fixture.database
      .prepare(
        `UPDATE canvas_scene_mutation_receipts
         SET result_json = ?, result_hash = ?
         WHERE document_id = ? AND mutation_id = ?`,
      )
      .run(
        corruptResult,
        createHash("sha256").update(corruptResult).digest("hex"),
        fixture.documentId,
        request.mutationId,
      );

    expect(applyCanvasSceneMutation(fixture.database, request)).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "canvas_scene_corrupt",
        resetRequired: true,
      }),
    });
    expect(() =>
      validateBackupStore(getDatabasePath(), {
        assetsPath: path.join(process.env.NODEX_DIR ?? "", "assets"),
      }),
    ).toThrow(/Canvas mutation receipt is corrupt/u);
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
    const nonCard = applyCanvasSceneMutation(
      fixture.database,
      mutation(fixture, {
        mutationId: "non-card-reference",
        elementCandidates: [
          shape(1, 2, 0, {
            customData: {
              type: "nodex-card-reference",
              targetBlockId: primaryCanvasBlockId(fixture.projectId),
            },
          }),
        ],
      }),
    );
    expect(nonCard).toEqual({
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
