import { describe, expect, it } from "vite-plus/test";
import type { Project } from "./types";
import {
  runSerializedProjectCatalogUpdate,
  runSerializedProjectUpdate,
  waitForProjectCatalogUpdates,
} from "./project-update-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("runSerializedProjectUpdate", () => {
  it("serializes independent surface writes for the same Project", async () => {
    const first = deferred<string>();
    const started: string[] = [];
    const firstResult = runSerializedProjectUpdate("project-1", async () => {
      started.push("rename");
      return await first.promise;
    });
    const secondResult = runSerializedProjectUpdate("project-1", async () => {
      started.push("appearance");
      return "appearance-complete";
    });

    await flushMicrotasks();
    expect(started).toEqual(["rename"]);
    first.resolve("rename-complete");

    await expect(firstResult).resolves.toBe("rename-complete");
    await expect(secondResult).resolves.toBe("appearance-complete");
    expect(started).toEqual(["rename", "appearance"]);
  });

  it("continues after a failed write without blocking another Project", async () => {
    const failed = deferred<string>();
    const sameProject = runSerializedProjectUpdate("project-failure", () => failed.promise);
    const sameProjectOutcome = sameProject.catch((error: unknown) => error);
    const queued = runSerializedProjectUpdate("project-failure", async () => "recovered");
    const independent = runSerializedProjectUpdate("project-2", async () => "independent");

    await expect(independent).resolves.toBe("independent");
    failed.reject(new Error("conflict"));
    await expect(sameProjectOutcome).resolves.toEqual(new Error("conflict"));
    await expect(queued).resolves.toBe("recovered");
  });
});

function project(id: string, bindingRevision: number, pinned = false): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: `database:${id}`,
    defaultDatabaseViewId: `view:${id}`,
    lifecycle: "active",
    bindingRevision,
    name: id,
    description: "",
    appearance: {
      color: "blue",
      marker: { kind: "icon", icon: "folder" },
    },
    sources: [],
    primaryWorkspaceRoot: null,
    pinned,
    pinnedOrder: pinned ? 0 : null,
    created: new Date("2026-07-27T00:00:00.000Z"),
    updated: new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("waitForProjectCatalogUpdates", () => {
  it("drains writes that are appended while an earlier write is settling", async () => {
    const first = deferred<Project | null>();
    const second = deferred<Project | null>();
    const fallback = project("project-drain", 1);
    const firstWrite = runSerializedProjectCatalogUpdate(fallback.id, () => first.promise);
    const waiting = waitForProjectCatalogUpdates(fallback);
    const secondWrite = runSerializedProjectCatalogUpdate(fallback.id, () => second.promise);

    first.resolve(project(fallback.id, 2));
    await firstWrite;
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const newest = project(fallback.id, 3);
    second.resolve(newest);
    await secondWrite;
    await expect(waiting).resolves.toEqual(newest);
  });

  it("prefers a newer fallback snapshot when the cached revision is equal", async () => {
    const id = "project-equal-revision";
    await runSerializedProjectCatalogUpdate(id, async () => project(id, 4, false));

    const newerPinSnapshot = project(id, 4, true);
    await expect(waitForProjectCatalogUpdates(newerPinSnapshot)).resolves.toEqual(newerPinSnapshot);
  });
});
