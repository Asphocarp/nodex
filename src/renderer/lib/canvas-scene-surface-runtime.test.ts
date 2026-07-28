import { describe, expect, test } from "vitest";
import type { ReadyRegisteredOwnedBlockDocumentDescriptor } from "./owned-block-document";
import type { CanvasSceneBinding } from "./canvas-scene-binding";
import type { CanvasBinaryFileResolver } from "./canvas-assets";
import type { CanvasSceneProvider } from "./canvas-scene-provider";
import type { CanvasPresenceController } from "./canvas-presence-controller";
import {
  createCanvasSceneSurfaceRegistry,
  makeCanvasSceneSurfaceKey,
} from "./canvas-scene-surface-runtime";

const descriptor = {
  documentId: "document-1",
  storeEpoch: "epoch-1",
  generation: 1,
  headSeq: 0,
  sync: { kind: "canvas_scene" },
} as unknown as ReadyRegisteredOwnedBlockDocumentDescriptor;

const deferred = () => {
  let resolve = (): void => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const runtimeDependencies = (input: {
  durable?: Promise<void>;
  committed?: Promise<void>;
  status?: {
    readonly phase: "ready" | "saving" | "offline";
    readonly connected: boolean;
    readonly pendingMutationCount: number;
    readonly writeFrozen: boolean;
  };
}) => {
  const calls: string[] = [];
  const binding = {
    persistDurable: async () => {
      calls.push("persist");
      await (input.durable ?? Promise.resolve());
    },
    flushCommitted: async () => {
      calls.push("flush");
      await (input.committed ?? Promise.resolve());
    },
    submitLocalScene: () => ({
      durable: Promise.resolve(),
      committed: Promise.resolve(),
    }),
    destroy: () => {
      calls.push("destroy-binding");
    },
  } as unknown as CanvasSceneBinding;
  const provider = {
    connect: async () => {
      calls.push("connect");
    },
    waitForRelocationIdle: async () => {
      calls.push("lease-idle");
    },
    getStatus: () => input.status ?? {
      phase: "ready",
      connected: true,
      pendingMutationCount: 0,
      writeFrozen: false,
    },
    close: async () => {
      calls.push("close-provider");
    },
  } as unknown as CanvasSceneProvider;
  const fileResolver = {
    destroy: () => {
      calls.push("destroy-files");
    },
  } as unknown as CanvasBinaryFileResolver;
  const presence = {
    close: async () => {
      calls.push("close-presence");
    },
  } as unknown as CanvasPresenceController;
  return {
    calls,
    input: {
      descriptor,
      provider,
      presence,
      binding,
      fileResolver,
      disposeSubscriptions: () => {
        calls.push("dispose-subscriptions");
      },
    },
  };
};

describe("CanvasSceneSurfaceRegistry", () => {
  test("uses Window Session, Project Session, and tab identity", () => {
    expect(makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-1"))
      .not.toBe(makeCanvasSceneSurfaceKey("window-2", "session-1", "tab-1"));
    expect(makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-1"))
      .not.toBe(makeCanvasSceneSurfaceKey("window-1", "session-2", "tab-1"));
  });

  test("keeps an unmounted runtime observable until local durability settles", async () => {
    const registry = createCanvasSceneSurfaceRegistry();
    const durable = deferred();
    const dependencies = runtimeDependencies({ durable: durable.promise });
    const key = makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-1");
    const runtime = registry.acquire({ key, ...dependencies.input });

    let released = false;
    const releasing = registry.release(key, runtime).then(() => {
      released = true;
    });
    const appClosing = registry.persistAllDurable();
    await Promise.resolve();

    expect(released).toBe(false);
    expect(dependencies.calls.filter((call) => call === "persist").length)
      .toBeGreaterThanOrEqual(1);
    durable.resolve();
    await Promise.all([releasing, appClosing]);
    expect(dependencies.calls).toEqual(expect.arrayContaining([
      "lease-idle",
      "close-presence",
      "close-provider",
      "dispose-subscriptions",
      "destroy-files",
      "destroy-binding",
    ]));
  });

  test("does not connect a replacement until its predecessor closes", async () => {
    const registry = createCanvasSceneSurfaceRegistry();
    const durable = deferred();
    const first = runtimeDependencies({ durable: durable.promise });
    const second = runtimeDependencies({});
    const key = makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-1");
    registry.acquire({ key, ...first.input });
    const replacement = registry.acquire({ key, ...second.input });

    let connected = false;
    const connecting = replacement.connect().then(() => {
      connected = true;
    });
    await Promise.resolve();
    expect(connected).toBe(false);
    expect(second.calls).not.toContain("connect");

    durable.resolve();
    await connecting;
    expect(second.calls).toContain("connect");
  });

  test("uses the committed barrier only for explicit maintenance", async () => {
    const registry = createCanvasSceneSurfaceRegistry();
    const dependencies = runtimeDependencies({});
    const key = makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-1");
    registry.acquire({ key, ...dependencies.input });

    await registry.flushAllCommitted();

    expect(dependencies.calls).toEqual(["flush"]);
  });

  test("runs best-effort maintenance before closing an idle provider", async () => {
    const registry = createCanvasSceneSurfaceRegistry();
    const dependencies = runtimeDependencies({});
    const key = makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-1");
    const runtime = registry.acquire({
      key,
      ...dependencies.input,
      maintainIfIdle: async () => {
        dependencies.calls.push("maintain");
      },
    });

    await registry.release(key, runtime);

    expect(dependencies.calls).toEqual([
      "persist",
      "lease-idle",
      "maintain",
      "close-presence",
      "close-provider",
      "dispose-subscriptions",
      "destroy-files",
      "destroy-binding",
    ]);
  });

  test("skips maintenance with pending work and still closes after maintenance failure", async () => {
    const registry = createCanvasSceneSurfaceRegistry();
    const pending = runtimeDependencies({
      status: {
        phase: "saving",
        connected: true,
        pendingMutationCount: 1,
        writeFrozen: false,
      },
    });
    const pendingKey = makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-1");
    const pendingRuntime = registry.acquire({
      key: pendingKey,
      ...pending.input,
      maintainIfIdle: async () => {
        pending.calls.push("maintain");
      },
    });
    await registry.release(pendingKey, pendingRuntime);
    expect(pending.calls).not.toContain("maintain");

    const failing = runtimeDependencies({});
    const failingKey = makeCanvasSceneSurfaceKey("window-1", "session-1", "tab-2");
    const failingRuntime = registry.acquire({
      key: failingKey,
      ...failing.input,
      maintainIfIdle: async () => {
        failing.calls.push("maintain");
        throw new Error("maintenance unavailable");
      },
    });
    await expect(registry.release(failingKey, failingRuntime)).resolves.toBeUndefined();
    expect(failing.calls).toEqual(expect.arrayContaining([
      "maintain",
      "close-provider",
      "destroy-binding",
    ]));
  });
});
