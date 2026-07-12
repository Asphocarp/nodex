import { describe, expect, test } from "vitest";
import {
  CANVAS_SCENE_SYNC_VERSION,
  canonicalPortableCanvasSceneFingerprint,
  materializePortableCanvasScene,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import { MemoryCanvasSceneOutbox } from "./canvas-scene-outbox";
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
  currentScene = scene();
  headSeq = 0;
  applyError: Error | null = null;

  subscribe: CanvasSceneSyncAdapter["subscribe"] = (_request, listener, leaseListener) => {
    this.calls.push("subscribe");
    this.listener = listener;
    this.leaseListener = leaseListener ?? null;
    return () => {
      this.listener = null;
      this.leaseListener = null;
    };
  };

  sync: CanvasSceneSyncAdapter["sync"] = async () => {
    this.calls.push("sync");
    return {
      ok: true,
      value: {
        version: CANVAS_SCENE_SYNC_VERSION,
        projectId: "project-1",
        documentId: "document-1",
        storeEpoch: "epoch-1",
        generation: 1,
        headSeq: this.headSeq,
        sceneHash: canonicalPortableCanvasSceneFingerprint(this.currentScene),
        scene: this.currentScene,
      },
    };
  };

  applyMutation: CanvasSceneSyncAdapter["applyMutation"] = async (request) => {
    this.calls.push(`apply:${request.mutationId}`);
    this.applied.push(request);
    if (this.applyError) throw this.applyError;
    this.currentScene = materializePortableCanvasScene({
      elements: request.elementCandidates,
      appState: this.currentScene.appState,
      files: { ...this.currentScene.files, ...request.fileAdditions },
    });
    const baseHeadSeq = this.headSeq;
    this.headSeq += 1;
    return {
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
        sceneHash: canonicalPortableCanvasSceneFingerprint(this.currentScene),
        changedElementIds: request.elementCandidates.map((candidate) => candidate.id as string),
        appliedAppStateKeys: [],
        skippedAppStateKeys: [],
        addedFileIds: [],
        removedFileIds: [],
        committedAt: "2026-07-13T00:00:00.000Z",
      },
    };
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
  outbox?: MemoryCanvasSceneOutbox;
  schedule?: CanvasSceneProviderScheduler;
  scheduleRetry?: CanvasSceneProviderScheduler;
  onScene?: (value: PortableCanvasScene) => void;
  now?: () => number;
  scheduleLeaseDeadline?: CanvasSceneProviderScheduler;
}) => new CanvasSceneProvider({
  projectId: "project-1",
  documentId: "document-1",
  clientSessionId: "window-1",
  adapter: input.adapter,
  outbox: input.outbox ?? new MemoryCanvasSceneOutbox(),
  createMutationId: () => "mutation-1",
  ...(input.schedule ? { schedule: input.schedule } : {}),
  ...(input.scheduleRetry ? { scheduleRetry: input.scheduleRetry } : {}),
  ...(input.now ? { now: input.now } : {}),
  ...(input.scheduleLeaseDeadline
    ? { scheduleLeaseDeadline: input.scheduleLeaseDeadline }
    : {}),
  onScene: input.onScene ?? (() => undefined),
});

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
      clientSessionId: "old-window",
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
