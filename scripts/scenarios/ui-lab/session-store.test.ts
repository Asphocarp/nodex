import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createUiLabSessionStore,
  type UiLabSessionRecord,
} from "./session-store";

const temporaryRoots: string[] = [];

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodex-ui-lab-store-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true });
  }));
});

describe("UI Lab session store", () => {
  test("finds retained sessions by session identity, independent of seed identity", async () => {
    const repositoryRoot = await createTemporaryRoot();
    const runRoot = path.join(repositoryRoot, "retained-profile");
    await mkdir(runRoot);
    const store = createUiLabSessionStore(repositoryRoot);
    const session: UiLabSessionRecord = {
      sessionId: "session-a",
      runRoot,
      repositoryRealpath: repositoryRoot,
      seed: {
        kind: "scenario",
        scenarioId: "board/dense",
        scenarioRevision: 1,
      },
      createdAt: "2026-08-15T10:00:00.000Z",
      updatedAt: "2026-08-15T10:00:00.000Z",
    };

    await store.record(session);

    await expect(store.find("session-a")).resolves.toEqual(session);
    await expect(store.find("board/dense")).resolves.toBeNull();
  });

  test("does not return a session after its retained Profile is removed", async () => {
    const repositoryRoot = await createTemporaryRoot();
    const runRoot = path.join(repositoryRoot, "retained-profile");
    await mkdir(runRoot);
    const store = createUiLabSessionStore(repositoryRoot);
    await store.record({
      sessionId: "session-b",
      runRoot,
      repositoryRealpath: repositoryRoot,
      seed: {
        kind: "scenario",
        scenarioId: "board/dense",
        scenarioRevision: 1,
      },
      createdAt: "2026-08-15T10:00:00.000Z",
      updatedAt: "2026-08-15T10:00:00.000Z",
    });
    await rm(runRoot, { recursive: true });

    await expect(store.find("session-b")).resolves.toBeNull();
  });
});
