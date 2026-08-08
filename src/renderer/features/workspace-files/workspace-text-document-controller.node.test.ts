import { describe, expect, test, vi } from "vitest";
import {
  WORKSPACE_AUTOSAVE_DELAY_MS,
  WORKSPACE_EDIT_STABILIZATION_MS,
  WorkspaceTextDocumentController,
  workspaceTextDocumentRegistry,
} from "./workspace-text-document-controller";

describe("WorkspaceTextDocumentController", () => {
  test("persists a recoverable draft and CAS-autosaves after the reference delays", async () => {
    vi.useFakeTimers();
    const persistDraft = vi.fn();
    const clearDraft = vi.fn();
    const write = vi.fn(async () => ({ outcome: "saved" as const, mtimeMs: 2 }));
    const controller = new WorkspaceTextDocumentController({
      path: "/repo/index.ts",
      content: "one",
      mtimeMs: 1,
    }, {
      write,
      readDisk: async () => ({ content: "disk", mtimeMs: 2 }),
      persistDraft,
      clearDraft,
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    controller.edit("two");
    await vi.advanceTimersByTimeAsync(WORKSPACE_EDIT_STABILIZATION_MS);
    expect(persistDraft).toHaveBeenCalledWith({
      path: "/repo/index.ts",
      content: "two",
      baseMtimeMs: 1,
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    await vi.advanceTimersByTimeAsync(
      WORKSPACE_AUTOSAVE_DELAY_MS - WORKSPACE_EDIT_STABILIZATION_MS,
    );
    expect(write).toHaveBeenCalledWith("/repo/index.ts", "two", 1);
    expect(controller.getSnapshot().status).toBe("clean");
    expect(clearDraft).toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  test("keeps both versions when compare-and-swap detects a conflict", async () => {
    const persistDraft = vi.fn();
    const controller = new WorkspaceTextDocumentController({
      path: "/repo/index.ts",
      content: "base",
      mtimeMs: 1,
    }, {
      write: async () => ({ outcome: "conflict", mtimeMs: 2 }),
      readDisk: async () => ({ content: "disk", mtimeMs: 2 }),
      persistDraft,
      clearDraft: vi.fn(),
    });

    controller.edit("local");
    expect(await controller.flush()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      status: "conflict",
      content: "local",
      diskContent: "disk",
      diskMtimeMs: 2,
    });
    expect(persistDraft).toHaveBeenCalled();
    controller.dispose();
  });

  test("restores a draft and exposes a conflict when its base changed on disk", () => {
    const controller = new WorkspaceTextDocumentController({
      path: "/repo/index.ts",
      content: "disk",
      mtimeMs: 2,
      draft: {
        path: "/repo/index.ts",
        content: "local",
        baseMtimeMs: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    }, {
      write: async () => ({ outcome: "saved", mtimeMs: 3 }),
      readDisk: async () => ({ content: "disk", mtimeMs: 2 }),
      persistDraft: vi.fn(),
      clearDraft: vi.fn(),
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "conflict",
      content: "local",
      diskContent: "disk",
    });
    controller.dispose();
  });

  test("keeps flushing edits made during a save until the document is clean", async () => {
    type SaveResult = {
      outcome: "saved";
      mtimeMs: number;
    };
    let resolveFirstWrite!: (value: SaveResult) => void;
    const firstWrite = new Promise<SaveResult>((resolve) => {
      resolveFirstWrite = resolve;
    });
    let writeCount = 0;
    const write = vi.fn(() => {
      writeCount += 1;
      if (writeCount === 1) return firstWrite;
      return Promise.resolve({ outcome: "saved" as const, mtimeMs: 3 });
    });
    const controller = new WorkspaceTextDocumentController({
      path: "/repo/index.ts",
      content: "one",
      mtimeMs: 1,
    }, {
      write,
      readDisk: async () => ({ content: "disk", mtimeMs: 2 }),
      persistDraft: vi.fn(),
      clearDraft: vi.fn(),
    });

    controller.edit("two");
    const firstFlush = controller.flush();
    controller.edit("three");
    resolveFirstWrite({ outcome: "saved", mtimeMs: 2 });
    await expect(firstFlush).resolves.toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      content: "three",
      baseMtimeMs: 3,
      status: "clean",
    });
    expect(write).toHaveBeenLastCalledWith("/repo/index.ts", "three", 2);
    controller.dispose();
  });

  test("does not resurrect a draft after a manual flush beats draft stabilization", async () => {
    vi.useFakeTimers();
    const persistDraft = vi.fn();
    const clearDraft = vi.fn();
    const controller = new WorkspaceTextDocumentController({
      path: "/repo/index.ts",
      content: "base",
      mtimeMs: 1,
    }, {
      write: async () => ({ outcome: "saved", mtimeMs: 2 }),
      readDisk: async () => ({ content: "base", mtimeMs: 1 }),
      persistDraft,
      clearDraft,
    });

    controller.edit("saved immediately");
    await expect(controller.flush()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(WORKSPACE_EDIT_STABILIZATION_MS);

    expect(clearDraft).toHaveBeenCalledOnce();
    expect(persistDraft).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  test("reloads a clean external change but conflicts without dropping a dirty draft", async () => {
    let disk = { content: "external", mtimeMs: 2 };
    const persistDraft = vi.fn();
    const clearDraft = vi.fn();
    const controller = new WorkspaceTextDocumentController({
      path: "/repo/index.ts",
      content: "base",
      mtimeMs: 1,
    }, {
      write: async () => ({ outcome: "saved", mtimeMs: 3 }),
      readDisk: async () => disk,
      persistDraft,
      clearDraft,
    });

    await controller.notifyExternalChange();
    expect(controller.getSnapshot()).toMatchObject({
      content: "external",
      baseMtimeMs: 2,
      status: "clean",
      documentVersion: 1,
    });
    controller.edit("local");
    disk = { content: "new external", mtimeMs: 3 };
    await controller.notifyExternalChange();
    expect(controller.getSnapshot()).toMatchObject({
      content: "local",
      diskContent: "new external",
      diskMtimeMs: 3,
      status: "conflict",
    });
    controller.useDiskVersion();
    expect(controller.getSnapshot()).toMatchObject({
      content: "new external",
      baseMtimeMs: 3,
      status: "clean",
    });
    expect(clearDraft).toHaveBeenCalled();
    controller.dispose();
  });

  test("keeps a failed save recoverable and lets the app-close registry await retries", async () => {
    const persistDraft = vi.fn();
    const write = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce({ outcome: "saved", mtimeMs: 2 });
    const controller = new WorkspaceTextDocumentController({
      path: "/repo/index.ts",
      content: "base",
      mtimeMs: 1,
    }, {
      write,
      readDisk: async () => ({ content: "base", mtimeMs: 1 }),
      persistDraft,
      clearDraft: vi.fn(),
    });
    const unregister = workspaceTextDocumentRegistry.register("test:close", controller);
    controller.edit("local");

    await expect(controller.flush()).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      content: "local",
      status: "error",
      message: "disk unavailable",
    });
    expect(persistDraft).toHaveBeenCalled();
    await expect(workspaceTextDocumentRegistry.flushAll()).resolves.toBe(true);
    expect(controller.getSnapshot().status).toBe("clean");

    unregister();
    controller.dispose();
  });
});
