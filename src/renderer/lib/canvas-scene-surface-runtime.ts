import type { ReadyRegisteredOwnedBlockDocumentDescriptor } from "./owned-block-document";
import type {
  CanvasLocalSceneObservation,
  CanvasSceneBinding,
} from "./canvas-scene-binding";
import type { CanvasBinaryFileResolver } from "./canvas-assets";
import type {
  CanvasSceneProvider,
  CanvasSceneSubmission,
} from "./canvas-scene-provider";
import type { CanvasPresenceController } from "./canvas-presence-controller";

export interface CanvasSceneSurfaceRuntime {
  readonly key: string;
  readonly descriptor: ReadyRegisteredOwnedBlockDocumentDescriptor;
  connect(): Promise<void>;
  submitLocalScene(
    observation: CanvasLocalSceneObservation,
  ): CanvasSceneSubmission;
  persistDurable(): Promise<void>;
  flushCommitted(): Promise<void>;
  close(): Promise<void>;
}

export interface CanvasSceneSurfaceAcquireInput {
  readonly key: string;
  readonly descriptor: ReadyRegisteredOwnedBlockDocumentDescriptor;
  readonly provider: CanvasSceneProvider;
  readonly presence: CanvasPresenceController;
  readonly binding: CanvasSceneBinding;
  readonly fileResolver: CanvasBinaryFileResolver;
  readonly maintainIfIdle?: () => Promise<void>;
  readonly disposeSubscriptions: () => void;
}

export interface CanvasSceneSurfaceRegistry {
  acquire(input: CanvasSceneSurfaceAcquireInput): CanvasSceneSurfaceRuntime;
  release(
    key: string,
    expected: CanvasSceneSurfaceRuntime,
  ): Promise<void>;
  dispose(key: string): Promise<void>;
  persistAllDurable(): Promise<void>;
  flushAllCommitted(): Promise<void>;
}

export const makeCanvasSceneSurfaceKey = (
  windowSessionId: string,
  projectSessionId: string,
  tabId: string,
): string =>
  JSON.stringify([windowSessionId, projectSessionId, tabId]);

class DefaultCanvasSceneSurfaceRuntime implements CanvasSceneSurfaceRuntime {
  readonly key: string;
  readonly descriptor: ReadyRegisteredOwnedBlockDocumentDescriptor;

  private closePromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    input: CanvasSceneSurfaceAcquireInput,
    private readonly connectBarrier: Promise<void>,
  ) {
    this.key = input.key;
    this.descriptor = input.descriptor;
    this.provider = input.provider;
    this.presence = input.presence;
    this.binding = input.binding;
    this.fileResolver = input.fileResolver;
    this.maintainIfIdle = input.maintainIfIdle;
    this.disposeSubscriptions = input.disposeSubscriptions;
  }

  private readonly provider: CanvasSceneProvider;
  private readonly presence: CanvasPresenceController;
  private readonly binding: CanvasSceneBinding;
  private readonly fileResolver: CanvasBinaryFileResolver;
  private readonly maintainIfIdle: (() => Promise<void>) | undefined;
  private readonly disposeSubscriptions: () => void;

  connect = async (): Promise<void> => {
    if (this.closed) throw new Error("Canvas scene surface runtime is closed");
    await this.connectBarrier;
    await this.provider.connect();
  };

  submitLocalScene = (
    observation: CanvasLocalSceneObservation,
  ): CanvasSceneSubmission => {
    if (!this.closed) return this.binding.submitLocalScene(observation);
    const error = new Error("Canvas scene surface runtime is closed");
    const durable = Promise.reject(error);
    const committed = Promise.reject(error);
    void durable.catch(() => undefined);
    void committed.catch(() => undefined);
    return { durable, committed };
  };

  persistDurable = (): Promise<void> => this.binding.persistDurable();

  flushCommitted = (): Promise<void> => this.binding.flushCommitted();

  close = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    const promise = this.closeInternal().finally(() => {
      if (this.closePromise === promise) this.closePromise = null;
    });
    this.closePromise = promise;
    return promise;
  };

  private async closeInternal(): Promise<void> {
    await this.binding.persistDurable();
    await this.provider.waitForRelocationIdle();
    const status = this.provider.getStatus();
    if (
      this.maintainIfIdle
      && status.phase === "ready"
      && status.connected
      && status.pendingMutationCount === 0
      && !status.writeFrozen
    ) {
      await this.maintainIfIdle().catch(() => undefined);
    }
    await this.presence.close();
    await this.provider.close({ requireCommitted: false });
    this.disposeSubscriptions();
    this.fileResolver.destroy();
    this.binding.destroy();
    this.closed = true;
  }
}

export const createCanvasSceneSurfaceRegistry = (): CanvasSceneSurfaceRegistry => {
  const currentByKey = new Map<string, CanvasSceneSurfaceRuntime>();
  const activeOrClosing = new Set<CanvasSceneSurfaceRuntime>();

  const forgetSettled = (
    key: string,
    runtime: CanvasSceneSurfaceRuntime,
  ): void => {
    activeOrClosing.delete(runtime);
    if (currentByKey.get(key) === runtime) currentByKey.delete(key);
  };

  const release = async (
    key: string,
    expected: CanvasSceneSurfaceRuntime,
  ): Promise<void> => {
    try {
      await expected.close();
      forgetSettled(key, expected);
    } catch (error) {
      activeOrClosing.add(expected);
      throw error;
    }
  };

  return {
    acquire(input) {
      const predecessor = currentByKey.get(input.key);
      const connectBarrier = predecessor
        ? release(input.key, predecessor)
        : Promise.resolve();
      const runtime = new DefaultCanvasSceneSurfaceRuntime(
        input,
        connectBarrier,
      );
      currentByKey.set(input.key, runtime);
      activeOrClosing.add(runtime);
      return runtime;
    },
    release,
    async dispose(key) {
      const runtime = currentByKey.get(key);
      if (!runtime) return;
      await release(key, runtime);
    },
    async persistAllDurable() {
      await Promise.all(
        [...activeOrClosing].map((runtime) => runtime.persistDurable()),
      );
    },
    async flushAllCommitted() {
      await Promise.all(
        [...activeOrClosing].map((runtime) => runtime.flushCommitted()),
      );
    },
  };
};

export const canvasSceneSurfaceRegistry = createCanvasSceneSurfaceRegistry();
