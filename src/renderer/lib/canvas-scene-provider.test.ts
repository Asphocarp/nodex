import { describe, expect, test } from "vitest";
import {
  CANVAS_SCENE_SYNC_VERSION,
  materializePortableCanvasScene,
  type CanvasSceneMutationCommandResult,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type CanvasSceneSyncCommandResult,
  type CanvasPresencePublishRequest,
  type CanvasPresenceRealtimeEvent,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import {
  MemoryCanvasSceneOutbox,
  type CanvasSceneOutbox,
} from "./canvas-scene-outbox";
import {
  CanvasSceneProvider,
  type CanvasSceneRelocationLeaseEvent,
  type CanvasSceneProviderScheduler,
  type CanvasSceneSyncAdapter,
} from "./canvas-scene-provider";
import type {
  DocumentRelocationLeaseResponseRequest,
} from "../../shared/block-documents/document-sync";

const element = (version: number, text = `v${version}`) => ({
  id: "element-1",
  type: "text",
  index: "a0",
  version,
  versionNonce: 10,
  isDeleted: false,
  text,
});

const scene = (version = 1): PortableCanvasScene =>
  materializePortableCanvasScene({ elements: [element(version)] });

class MemoryAdapter implements CanvasSceneSyncAdapter {
  readonly calls: string[] = [];
  readonly applied: CanvasSceneMutationRequest[] = [];
  readonly leaseResponses: DocumentRelocationLeaseResponseRequest[] = [];
  listener: ((event: CanvasSceneRealtimeEvent) => void) | null = null;
  leaseListener: ((event: CanvasSceneRelocationLeaseEvent) => void) | null = null;
  presenceListener: ((event: CanvasPresenceRealtimeEvent) => void) | null = null;
  readonly presencePublications: CanvasPresencePublishRequest[] = [];
  currentScene = scene();
  generation = 1;
  headSeq = 0;
  applyError: Error | null = null;
  syncImplementation: CanvasSceneSyncAdapter["sync"] | null = null;
  private readonly committed = new Map<string, Extract<Awaited<CanvasSceneMutationCommandResult>, { readonly ok: true }>["value"]>();

  subscribe: CanvasSceneSyncAdapter["subscribe"] = (
    _request,
    listener,
    leaseListener,
    presenceListener,
  ) => {
    this.calls.push("subscribe");
    this.listener = listener;
    this.leaseListener = leaseListener ?? null;
    this.presenceListener = presenceListener ?? null;
    return () => {
      this.listener = null;
      this.leaseListener = null;
      this.presenceListener = null;
    };
  };

  publishPresence: NonNullable<
    CanvasSceneSyncAdapter["publishPresence"]
  > = async (request) => {
    this.presencePublications.push(request);
    return { ok: true, value: { accepted: true, applied: true } };
  };

  sync: CanvasSceneSyncAdapter["sync"] = async (request) => {
    this.calls.push("sync");
    if (this.syncImplementation) return await this.syncImplementation(request);
    return {
      ok: true,
      value: {
        kind: "snapshot",
        version: CANVAS_SCENE_SYNC_VERSION,
        syncRequestId: request.syncRequestId,
        projectId: "project-1",
        documentId: "document-1",
        storeEpoch: "epoch-1",
        generation: this.generation,
        headSeq: this.headSeq,
        sceneHash: "a".repeat(64),
        scene: this.currentScene,
      },
    };
  };

  applyMutation: CanvasSceneSyncAdapter["applyMutation"] = async (request) => {
    this.calls.push(`apply:${request.mutationId}`);
    this.applied.push(request);
    if (this.applyError) throw this.applyError;
    const committed = this.committed.get(request.mutationId);
    if (committed) return { ok: true, value: { ...committed, duplicate: true } };
    const elements = new Map(
      this.currentScene.elements.map((candidate) => [
        candidate.id as string,
        candidate,
      ]),
    );
    for (const candidate of request.elementCandidates) {
      elements.set(candidate.id as string, candidate);
    }
    this.currentScene = materializePortableCanvasScene({
      elements: [...elements.values()],
      appState: this.currentScene.appState,
      files: { ...this.currentScene.files, ...request.fileAdditions },
    });
    const baseHeadSeq = this.headSeq;
    this.headSeq += 1;
    const result = {
      ok: true,
      value: {
        version: CANVAS_SCENE_SYNC_VERSION,
        mutationId: request.mutationId,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        baseHeadSeq,
        headSeq: this.headSeq,
        duplicate: false,
        outcome: "committed",
        sceneHash: "b".repeat(64),
        changedElementIds: request.elementCandidates.map((candidate) => candidate.id as string),
        appliedAppStateKeys: [],
        skippedAppStateKeys: [],
        addedFileIds: [],
        removedFileIds: [],
        committedAt: "2026-07-13T00:00:00.000Z",
        committedDelta: {
          elementUpdates: request.elementCandidates,
          appState: this.currentScene.appState,
          fileAdditions: request.fileAdditions,
          removedFileIds: [],
        },
      },
    } as const;
    this.committed.set(request.mutationId, result.value);
    return result;
  };

  respondToRelocationLease: NonNullable<
    CanvasSceneSyncAdapter["respondToRelocationLease"]
  > = async (request) => {
    this.calls.push(`lease:${request.response}`);
    this.leaseResponses.push(request);
    return {
      ok: true,
      value: {
        accepted: true,
        leaseId: request.leaseId,
        documentId: request.documentId,
        status: request.response === "ack" ? "frozen" : "cancelled",
      },
    };
  };
}

const manualScheduler = () => {
  const callbacks: Array<() => void> = [];
  const schedule: CanvasSceneProviderScheduler = (callback) => {
    callbacks.push(callback);
    return () => {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    };
  };
  return { callbacks, schedule };
};

const makeProvider = (input: {
  adapter: MemoryAdapter;
  outbox?: CanvasSceneOutbox;
  schedule?: CanvasSceneProviderScheduler;
  scheduleRetry?: CanvasSceneProviderScheduler;
  onScene?: (value: PortableCanvasScene) => void;
  now?: () => number;
  scheduleLeaseDeadline?: CanvasSceneProviderScheduler;
  clientSessionId?: string;
  onPresence?: (event: CanvasPresenceRealtimeEvent) => void;
}) => {
  let mutationSequence = 0;
  let syncSequence = 0;
  return new CanvasSceneProvider({
    projectId: "project-1",
    documentId: "document-1",
    clientSessionId: input.clientSessionId ?? "window-1",
    adapter: input.adapter,
    outbox: input.outbox ?? new MemoryCanvasSceneOutbox(),
    createMutationId: () => {
      mutationSequence += 1;
      return `mutation-${mutationSequence}`;
    },
    createSyncRequestId: () => {
      syncSequence += 1;
      return `sync-${syncSequence}`;
    },
    ...(input.schedule ? { schedule: input.schedule } : {}),
    ...(input.scheduleRetry ? { scheduleRetry: input.scheduleRetry } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.scheduleLeaseDeadline
      ? { scheduleLeaseDeadline: input.scheduleLeaseDeadline }
      : {}),
    onScene: input.onScene ?? (() => undefined),
    ...(input.onPresence ? { onPresence: input.onPresence } : {}),
  });
};

const waitForCondition = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not met");
};

const prepareLease = (overrides: Partial<CanvasSceneRelocationLeaseEvent> = {}) => ({
  kind: "relocation-lease-prepare",
  leaseId: "lease-1",
  documentId: "document-1",
  clientSessionId: "window-1",
  storeEpoch: "epoch-1",
  generation: 1,
  expectedHeadSeq: 0,
  deadlineAt: 2_000,
  ...overrides,
}) as Extract<CanvasSceneRelocationLeaseEvent, { readonly kind: "relocation-lease-prepare" }>;

describe("CanvasSceneProvider", () => {
  test("buffers the initial presence snapshot until generation is synchronized", async () => {
    const adapter = new MemoryAdapter();
    const received: CanvasPresenceRealtimeEvent[] = [];
    adapter.syncImplementation = async (request) => {
      adapter.presenceListener?.({
        type: "canvas_presence_snapshot",
        version: 1,
        projectId: "project-1",
        documentId: "document-1",
        generation: 1,
        presences: [],
      });
      return {
        ok: true,
        value: {
          kind: "snapshot",
          version: CANVAS_SCENE_SYNC_VERSION,
          syncRequestId: request.syncRequestId,
          projectId: "project-1",
          documentId: "document-1",
          storeEpoch: "epoch-1",
          generation: 1,
          headSeq: 0,
          sceneHash: "a".repeat(64),
          scene: adapter.currentScene,
        },
      };
    };
    const provider = makeProvider({
      adapter,
      onPresence: (event) => received.push(event),
    });

    await provider.connect();
    expect(received).toHaveLength(1);
    await expect(provider.publishPresence(1, {
      selectedElementIds: [],
      idle: "active",
    })).resolves.toMatchObject({ ok: true });
    expect(adapter.presencePublications[0]).toMatchObject({
      publication: {
        documentId: "document-1",
        generation: 1,
        clock: 1,
      },
    });
    await provider.close();
  });

  test("does not allocate or persist a no-op observation", async () => {
    const adapter = new MemoryAdapter();
    const outbox = new MemoryCanvasSceneOutbox();
    const coalescing = manualScheduler();
    const provider = makeProvider({
      adapter,
      outbox,
      schedule: coalescing.schedule,
    });
    await provider.connect();

    const submission = provider.enqueue({ elementCandidates: [] });
    await Promise.all([submission.durable, submission.committed]);

    expect(coalescing.callbacks).toHaveLength(0);
    expect(adapter.applied).toHaveLength(0);
    expect(await outbox.list("document-1")).toHaveLength(0);
    await provider.close();
  });

  test("accepts an up-to-date repair without reparsing or presenting the scene", async () => {
    const adapter = new MemoryAdapter();
    const presented: PortableCanvasScene[] = [];
    const provider = makeProvider({
      adapter,
      onScene: (value) => presented.push(value),
    });
    await provider.connect();
    expect(presented).toHaveLength(1);
    adapter.syncImplementation = async (request) => ({
      ok: true,
      value: {
        kind: "up_to_date",
        version: CANVAS_SCENE_SYNC_VERSION,
        syncRequestId: request.syncRequestId,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: "epoch-1",
        generation: 1,
        headSeq: 0,
        sceneHash: "a".repeat(64),
      },
    });

    adapter.listener?.({
      type: "canvas_scene_resync_required",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: "project-1",
      documentId: "document-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 0,
    });
    await waitForCondition(() =>
      adapter.calls.filter((call) => call === "sync").length === 2
    );

    expect(presented).toHaveLength(1);
    expect(provider.getStatus().phase).toBe("ready");
    await provider.close();
  });

  test("rejects up-to-date without a local scene and a wrong sync request ID", async () => {
    const noSceneAdapter = new MemoryAdapter();
    noSceneAdapter.syncImplementation = async (request) => ({
      ok: true,
      value: {
        kind: "up_to_date",
        version: CANVAS_SCENE_SYNC_VERSION,
        syncRequestId: request.syncRequestId,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: "epoch-1",
        generation: 1,
        headSeq: 0,
        sceneHash: "a".repeat(64),
      },
    });
    const noSceneProvider = makeProvider({ adapter: noSceneAdapter });
    await noSceneProvider.connect();
    expect(noSceneProvider.getStatus()).toMatchObject({
      phase: "error",
      error: { message: expect.stringContaining("without a local scene") },
    });
    await expect(
      noSceneProvider.close({ requireCommitted: false }),
    ).rejects.toThrow("without a local scene");

    const wrongIdAdapter = new MemoryAdapter();
    wrongIdAdapter.syncImplementation = async (request) => ({
      ok: true,
      value: {
        kind: "snapshot",
        version: CANVAS_SCENE_SYNC_VERSION,
        syncRequestId: `${request.syncRequestId}:stale`,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: "epoch-1",
        generation: 1,
        headSeq: 0,
        sceneHash: "a".repeat(64),
        scene: scene(),
      },
    });
    const wrongIdProvider = makeProvider({ adapter: wrongIdAdapter });
    await wrongIdProvider.connect();
    expect(wrongIdProvider.getStatus()).toMatchObject({
      phase: "error",
      error: { message: expect.stringContaining("active request") },
    });
    await expect(
      wrongIdProvider.close({ requireCommitted: false }),
    ).rejects.toThrow("active request");
  });

  test("subscribes before sync and coalesces observations into one durable mutation", async () => {
    const adapter = new MemoryAdapter();
    const outbox = new MemoryCanvasSceneOutbox();
    const coalescing = manualScheduler();
    const provider = makeProvider({ adapter, outbox, schedule: coalescing.schedule });
    await provider.connect();
    expect(adapter.calls.slice(0, 2)).toEqual(["subscribe", "sync"]);

    const first = provider.submit({ elementCandidates: [element(2)] });
    const second = provider.submit({ elementCandidates: [element(3)] });
    expect(adapter.applied).toHaveLength(0);
    coalescing.callbacks.shift()?.();
    await Promise.all([first, second]);

    expect(adapter.applied).toHaveLength(1);
    expect(adapter.applied[0]?.elementCandidates[0]?.version).toBe(3);
    expect(adapter.calls.filter((call) => call === "sync")).toHaveLength(1);
    expect(provider.getScene()?.elements[0]?.version).toBe(3);
    expect(await outbox.list("document-1")).toHaveLength(0);
    expect(provider.getStatus().phase).toBe("ready");
    await provider.close();
  });

  test("persists the exact request before send and retries it unchanged", async () => {
    const adapter = new MemoryAdapter();
    const outbox = new MemoryCanvasSceneOutbox();
    const retry = manualScheduler();
    adapter.applyError = new Error("offline");
    const provider = makeProvider({ adapter, outbox, scheduleRetry: retry.schedule });
    await provider.connect();
    const submitted = provider.submit({ elementCandidates: [element(2)] });
    const flushing = provider.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = await outbox.list("document-1");
    expect(stored).toHaveLength(1);
    expect(adapter.applied).toHaveLength(1);
    adapter.applyError = null;
    retry.callbacks.shift()?.();
    await Promise.all([submitted, flushing]);
    expect(adapter.applied).toHaveLength(2);
    expect(adapter.applied[1]).toEqual(adapter.applied[0]);
    await provider.close();
  });

  test("lets a new client session recover an intent after local-durable close", async () => {
    const outbox = new MemoryCanvasSceneOutbox();
    const firstAdapter = new MemoryAdapter();
    const retry = manualScheduler();
    firstAdapter.applyError = new Error("offline");
    const first = makeProvider({
      adapter: firstAdapter,
      outbox,
      scheduleRetry: retry.schedule,
      clientSessionId: "window-1",
    });
    await first.connect();

    const submission = first.enqueue({ elementCandidates: [element(2)] });
    await submission.durable;
    void submission.committed.catch(() => undefined);
    await first.close({ requireCommitted: false });
    expect(await outbox.list("document-1")).toHaveLength(1);

    const secondAdapter = new MemoryAdapter();
    const second = makeProvider({
      adapter: secondAdapter,
      outbox,
      clientSessionId: "window-2",
    });
    await second.connect();
    await waitForCondition(() => secondAdapter.applied.length === 1);

    expect(secondAdapter.applied[0]?.clientSessionId).toBe("window-2");
    expect(secondAdapter.applied[0]?.mutationId)
      .toBe(firstAdapter.applied[0]?.mutationId);
    expect(await outbox.list("document-1")).toHaveLength(0);
    await second.close();
  });

  test("persists later FIFO intents while an older intent is offline", async () => {
    const adapter = new MemoryAdapter();
    const outbox = new MemoryCanvasSceneOutbox();
    const retry = manualScheduler();
    adapter.applyError = new Error("offline");
    const provider = makeProvider({
      adapter,
      outbox,
      scheduleRetry: retry.schedule,
    });
    await provider.connect();

    const first = provider.enqueue({ elementCandidates: [element(2)] });
    await first.durable;
    void first.committed.catch(() => undefined);
    await waitForCondition(() => retry.callbacks.length === 1);

    const second = provider.enqueue({
      elementCandidates: [{
        ...element(1),
        id: "element-2",
        index: "a1",
      }],
    });
    void second.committed.catch(() => undefined);
    await provider.persistDurable();
    await second.durable;

    expect((await outbox.list("document-1")).map((entry) => entry.mutationId))
      .toEqual(["mutation-1", "mutation-2"]);
    await provider.close({ requireCommitted: false });
  });

  test("repairs realtime gaps with a full sync and presents the canonical scene", async () => {
    const adapter = new MemoryAdapter();
    const presented: PortableCanvasScene[] = [];
    const provider = makeProvider({
      adapter,
      onScene: (value) => presented.push(value),
    });
    await provider.connect();
    adapter.currentScene = scene(4);
    adapter.headSeq = 3;
    adapter.listener?.({
      type: "canvas_scene_resync_required",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: "project-1",
      documentId: "document-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.getStatus().headSeq).toBe(3);
    expect(presented.at(-1)?.elements[0]?.version).toBe(4);
    await provider.close();
  });

  test("does not let a delayed full sync rewind newer realtime commits", async () => {
    const adapter = new MemoryAdapter();
    const provider = makeProvider({ adapter });
    await provider.connect();
    let resolveSync!: (result: CanvasSceneSyncCommandResult) => void;
    let pendingSyncRequestId = "";
    adapter.syncImplementation = (request) => new Promise((resolve) => {
      pendingSyncRequestId = request.syncRequestId;
      resolveSync = resolve;
    });
    adapter.listener?.({
      type: "canvas_scene_resync_required",
      version: 1,
      projectId: "project-1",
      documentId: "document-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 1,
    });
    await Promise.resolve();
    for (const [headSeq, version] of [[1, 2], [2, 3]] as const) {
      adapter.listener?.({
        type: "canvas_scene_committed",
        version: 1,
        projectId: "project-1",
        documentId: "document-1",
        storeEpoch: "epoch-1",
        generation: 1,
        mutationId: `remote-${headSeq}`,
        baseHeadSeq: headSeq - 1,
        headSeq,
        sceneHash: "c".repeat(64),
        elementUpdates: [element(version)],
        appState: {},
        fileAdditions: {},
        removedFileIds: [],
      });
    }
    resolveSync({ ok: true, value: {
      kind: "snapshot",
      version: 1,
      syncRequestId: pendingSyncRequestId,
      projectId: "project-1",
      documentId: "document-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 0,
      sceneHash: "a".repeat(64),
      scene: scene(1),
    } });
    await waitForCondition(() => provider.getStatus().phase === "ready");
    expect(provider.getStatus().headSeq).toBe(2);
    expect(provider.getScene()?.elements[0]?.version).toBe(3);
    adapter.syncImplementation = null;
    await provider.close();
  });

  test("retries exact delivery when durable ACK cleanup fails", async () => {
    class FailingRemoveOutbox implements CanvasSceneOutbox {
      private readonly delegate = new MemoryCanvasSceneOutbox();
      removeAttempts = 0;
      list = this.delegate.list;
      put = this.delegate.put;
      clear = this.delegate.clear;
      remove = async (documentId: string, mutationId: string): Promise<void> => {
        this.removeAttempts += 1;
        if (this.removeAttempts === 1) throw new Error("IndexedDB delete failed");
        await this.delegate.remove(documentId, mutationId);
      };
    }
    const adapter = new MemoryAdapter();
    const outbox = new FailingRemoveOutbox();
    const retry = manualScheduler();
    const provider = makeProvider({ adapter, outbox, scheduleRetry: retry.schedule });
    await provider.connect();
    const submitted = provider.submit({ elementCandidates: [element(2)] });
    provider.flush().catch(() => undefined);
    await waitForCondition(() => retry.callbacks.length === 1);
    expect((await outbox.list("document-1"))).toHaveLength(1);
    retry.callbacks.shift()?.();
    await submitted;
    expect(outbox.removeAttempts).toBe(2);
    expect(adapter.applied[1]).toEqual(adapter.applied[0]);
    expect(await outbox.list("document-1")).toHaveLength(0);
    await provider.close();
  });

  test("retains the outbox when a successful ACK crosses its request boundary", async () => {
    const adapter = new MemoryAdapter();
    const outbox = new MemoryCanvasSceneOutbox();
    adapter.applyMutation = async (request): Promise<CanvasSceneMutationCommandResult> => ({
      ok: true,
      value: {
        version: 1,
        mutationId: request.mutationId,
        projectId: "other-project",
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        baseHeadSeq: request.baseHeadSeq,
        headSeq: request.baseHeadSeq + 1,
        duplicate: false,
        outcome: "committed",
        sceneHash: "d".repeat(64),
        changedElementIds: [],
        appliedAppStateKeys: [],
        skippedAppStateKeys: [],
        addedFileIds: [],
        removedFileIds: [],
        committedAt: "2026-07-13T00:00:00.000Z",
        committedDelta: {
          elementUpdates: [],
          appState: {},
          fileAdditions: {},
          removedFileIds: [],
        },
      },
    });
    const provider = makeProvider({ adapter, outbox });
    await provider.connect();
    await expect(provider.submit({ elementCandidates: [element(2)] })).rejects.toThrow(
      "durable request boundary",
    );
    expect(await outbox.list("document-1")).toHaveLength(1);
    expect(provider.getStatus().phase).toBe("error");
  });

  test("invalidates a recovered outbox across an epoch boundary", async () => {
    const adapter = new MemoryAdapter();
    const outbox = new MemoryCanvasSceneOutbox();
    await outbox.put({
      version: CANVAS_SCENE_SYNC_VERSION,
      mutationId: "old-mutation",
      projectId: "project-1",
      documentId: "document-1",
      storeEpoch: "old-epoch",
      generation: 1,
      baseHeadSeq: 0,
      elementCandidates: [element(2)],
      appStateIntents: {},
      fileAdditions: {},
    });
    const provider = makeProvider({ adapter, outbox });
    await provider.connect();
    expect(provider.getStatus().phase).toBe("reset-required");
    expect(await outbox.list("document-1")).toHaveLength(0);
    expect(adapter.applied).toHaveLength(0);
  });

  test("invalidates a recovered outbox across a generation boundary", async () => {
    const adapter = new MemoryAdapter();
    adapter.generation = 2;
    const outbox = new MemoryCanvasSceneOutbox();
    await outbox.put({
      version: CANVAS_SCENE_SYNC_VERSION,
      mutationId: "old-generation-mutation",
      projectId: "project-1",
      documentId: "document-1",
      storeEpoch: "epoch-1",
      generation: 1,
      baseHeadSeq: 0,
      elementCandidates: [element(2)],
      appStateIntents: {},
      fileAdditions: {},
    });

    const provider = makeProvider({ adapter, outbox });
    await provider.connect();

    expect(provider.getStatus().phase).toBe("reset-required");
    expect(await outbox.list("document-1")).toHaveLength(0);
    expect(adapter.applied).toHaveLength(0);
  });

  test("close flushes the scheduled observation before unsubscribing", async () => {
    const adapter = new MemoryAdapter();
    const coalescing = manualScheduler();
    const provider = makeProvider({ adapter, schedule: coalescing.schedule });
    await provider.connect();
    const submitted = provider.submit({ elementCandidates: [element(2)] });
    await provider.close();
    await submitted;
    expect(adapter.applied).toHaveLength(1);
    expect(adapter.listener).toBeNull();
    expect(provider.getStatus().phase).toBe("closed");
  });

  test("durably flushes the local scene before acknowledging and freezing a write lease", async () => {
    const adapter = new MemoryAdapter();
    const coalescing = manualScheduler();
    const deadlines = manualScheduler();
    const provider = makeProvider({
      adapter,
      schedule: coalescing.schedule,
      scheduleLeaseDeadline: deadlines.schedule,
      now: () => 1_000,
    });
    await provider.connect();
    const submitted = provider.submit({ elementCandidates: [element(2)] });

    adapter.leaseListener?.(prepareLease());
    await waitForCondition(() => adapter.leaseResponses.some(({ response }) => response === "ack"));
    await submitted;

    const mutationCall = adapter.calls.findIndex((call) => call.startsWith("apply:"));
    const ackCall = adapter.calls.indexOf("lease:ack");
    expect(mutationCall).toBeGreaterThan(-1);
    expect(ackCall).toBeGreaterThan(mutationCall);
    expect(adapter.leaseResponses.at(-1)).toMatchObject({
      response: "ack",
      headSeq: 1,
    });
    expect(provider.getStatus()).toMatchObject({
      phase: "frozen",
      writeFrozen: true,
      headSeq: 1,
    });
    await expect(
      provider.submit({ elementCandidates: [element(3)] }),
    ).rejects.toThrow("frozen by a Document write lease");
    await provider.close();
  });

  test("stays frozen until the terminal head is fully synchronized", async () => {
    const adapter = new MemoryAdapter();
    const deadlines = manualScheduler();
    const provider = makeProvider({
      adapter,
      scheduleLeaseDeadline: deadlines.schedule,
      now: () => 1_000,
    });
    await provider.connect();
    adapter.leaseListener?.(prepareLease());
    await waitForCondition(() => provider.getStatus().phase === "frozen");

    adapter.currentScene = scene(4);
    adapter.headSeq = 3;
    adapter.leaseListener?.({
      kind: "relocation-lease-release",
      leaseId: "lease-1",
      documentId: "document-1",
      clientSessionId: "window-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 3,
    });

    expect(provider.getStatus().writeFrozen).toBe(true);
    await waitForCondition(() => provider.getStatus().phase === "ready");
    expect(provider.getStatus()).toMatchObject({ writeFrozen: false, headSeq: 3 });
    expect(provider.getScene()?.elements[0]?.version).toBe(4);
    await provider.close();
  });

  test("waits for a queued sync cycle before completing a lease terminal", async () => {
    const adapter = new MemoryAdapter();
    const deadlines = manualScheduler();
    const provider = makeProvider({
      adapter,
      scheduleLeaseDeadline: deadlines.schedule,
      now: () => 1_000,
    });
    await provider.connect();
    adapter.leaseListener?.(prepareLease());
    await waitForCondition(() => provider.getStatus().phase === "frozen");

    let syncCalls = 0;
    const syncRequestIds: string[] = [];
    let resolveFirst!: (result: CanvasSceneSyncCommandResult) => void;
    let resolveSecond!: (result: CanvasSceneSyncCommandResult) => void;
    const first = new Promise<CanvasSceneSyncCommandResult>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<CanvasSceneSyncCommandResult>((resolve) => {
      resolveSecond = resolve;
    });
    adapter.syncImplementation = async (request) => {
      syncCalls += 1;
      syncRequestIds.push(request.syncRequestId);
      return await (syncCalls === 1 ? first : second);
    };
    adapter.listener?.({
      type: "canvas_scene_resync_required",
      version: 1,
      projectId: "project-1",
      documentId: "document-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 1,
    });
    await waitForCondition(() => syncCalls === 1);
    adapter.leaseListener?.({
      kind: "relocation-lease-release",
      leaseId: "lease-1",
      documentId: "document-1",
      clientSessionId: "window-1",
      storeEpoch: "epoch-1",
      generation: 1,
      headSeq: 2,
    });
    resolveFirst({ ok: true, value: {
      kind: "snapshot", version: 1, syncRequestId: syncRequestIds[0]!,
      projectId: "project-1", documentId: "document-1",
      storeEpoch: "epoch-1", generation: 1, headSeq: 1,
      sceneHash: "e".repeat(64), scene: scene(2),
    } });
    await waitForCondition(() => syncCalls === 2);
    expect(provider.getStatus().phase).toBe("frozen");
    resolveSecond({ ok: true, value: {
      kind: "snapshot", version: 1, syncRequestId: syncRequestIds[1]!,
      projectId: "project-1", documentId: "document-1",
      storeEpoch: "epoch-1", generation: 1, headSeq: 2,
      sceneHash: "f".repeat(64), scene: scene(3),
    } });
    await waitForCondition(() => provider.getStatus().phase === "ready");
    expect(provider.getStatus().headSeq).toBe(2);
    adapter.syncImplementation = null;
    await provider.close();
  });

  test("fails closed when overlapping write leases arrive", async () => {
    const adapter = new MemoryAdapter();
    const deadlines = manualScheduler();
    let releasePreparation: (() => void) | undefined;
    const provider = makeProvider({
      adapter,
      scheduleLeaseDeadline: deadlines.schedule,
      now: () => 1_000,
    });
    provider.registerWriteLeasePreparer(() => new Promise<void>((resolve) => {
      releasePreparation = resolve;
    }));
    await provider.connect();
    adapter.leaseListener?.(prepareLease());
    adapter.leaseListener?.(prepareLease({ leaseId: "lease-2" }));

    await waitForCondition(() => provider.getStatus().phase === "reset-required");
    expect(adapter.leaseResponses).toContainEqual(expect.objectContaining({
      response: "nack",
      leaseId: "lease-2",
      reason: "foreign_lease_event",
    }));
    expect(provider.getStatus().writeFrozen).toBe(false);
    releasePreparation?.();
  });
});
