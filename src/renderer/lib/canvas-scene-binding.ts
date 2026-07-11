import type * as Y from "yjs";
import {
  applyRebasedCanvasSceneObservation,
  inspectCanvasDocument,
  pickDurableCanvasAppState,
  type CanvasDocumentEnvelope,
  type CanvasFileSnapshot,
  type CanvasJsonValue,
  type CanvasSceneMaterialization,
  type CanvasSharedAppState,
  type CanvasSharedAppStateFieldPatch,
  type CanvasSharedAppStatePatch,
} from "../../shared/block-documents";
import {
  materializeDurableCanvasFiles,
  type CanvasAssetBridgeDependencies,
  type CanvasBinaryFiles,
} from "./canvas-assets";
import type { BlockDocumentSurfaceRuntime } from "./block-document-surface-runtime";

export interface CanvasLocalSceneObservation {
  /** Must be ExcalidrawImperativeAPI.getSceneElementsIncludingDeleted. */
  readonly getSceneElementsIncludingDeleted: () => readonly unknown[];
  readonly appState: Readonly<Record<string, unknown>>;
  readonly binaryFiles: CanvasBinaryFiles;
}

export interface CanvasSceneBindingOptions {
  readonly envelope: CanvasDocumentEnvelope;
  readonly assetDependencies?: CanvasAssetBridgeDependencies;
  readonly onRemoteScene: (scene: CanvasSceneMaterialization) => void;
  readonly onError?: (error: Error) => void;
}

interface PendingObservation {
  readonly elementsIncludingDeleted: readonly unknown[];
  readonly appStatePatch: CanvasSharedAppStatePatch;
  readonly binaryFiles: CanvasBinaryFiles;
  readonly waiters: Array<{
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }>;
}

export type CanvasScenePreparationRegistry = Pick<
  BlockDocumentSurfaceRuntime,
  "registerPersistPreparer" | "registerRelocationPreparer"
>;

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const sameJsonValue = (
  left: CanvasJsonValue | undefined,
  right: CanvasJsonValue | undefined,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const appStatePatch = (
  before: Readonly<Record<string, CanvasJsonValue>>,
  after: Readonly<Record<string, CanvasJsonValue>>,
): CanvasSharedAppStatePatch => {
  const patch: Record<string, CanvasSharedAppStateFieldPatch> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sameJsonValue(before[key], after[key])) continue;
    patch[key] = { expected: before[key], value: after[key] };
  }
  return patch;
};

const mergeAppStatePatches = (
  previous: CanvasSharedAppStatePatch,
  next: CanvasSharedAppStatePatch,
): CanvasSharedAppStatePatch => {
  const merged = { ...previous };
  for (const [key, nextIntent] of Object.entries(next)) {
    const previousIntent = merged[key];
    const intent = previousIntent && sameJsonValue(
      previousIntent.value,
      nextIntent.expected,
    )
      ? { expected: previousIntent.expected, value: nextIntent.value }
      : nextIntent;
    if (sameJsonValue(intent.expected, intent.value)) {
      delete merged[key];
    } else {
      merged[key] = intent;
    }
  }
  return merged;
};

const mergeObservations = (
  previous: PendingObservation,
  next: PendingObservation,
): PendingObservation => ({
  elementsIncludingDeleted: next.elementsIncludingDeleted,
  appStatePatch: mergeAppStatePatches(
    previous.appStatePatch,
    next.appStatePatch,
  ),
  binaryFiles: next.binaryFiles,
  waiters: [...previous.waiters, ...next.waiters],
});

const presentAppStateWithPendingIntent = (
  shared: CanvasSharedAppState,
  patch: CanvasSharedAppStatePatch,
): CanvasSharedAppState => {
  if (Object.keys(patch).length === 0) return shared;
  const presented: Record<string, CanvasJsonValue> = { ...shared };
  for (const [key, intent] of Object.entries(patch)) {
    if (!sameJsonValue(shared[key], intent.expected)) continue;
    if (intent.value === undefined) {
      delete presented[key];
    } else {
      presented[key] = intent.value;
    }
  }
  return presented;
};

/**
 * Bridges one mounted Excalidraw surface to its independent Canvas Y.Doc.
 * Local observations coalesce and rebase after upload; remote transactions are
 * presentation events rendered with CaptureUpdateAction.NEVER by the caller.
 */
export class CanvasSceneBinding {
  private readonly envelope: CanvasDocumentEnvelope;
  private readonly assetDependencies?: CanvasAssetBridgeDependencies;
  private readonly onRemoteScene: CanvasSceneBindingOptions["onRemoteScene"];
  private readonly onError?: CanvasSceneBindingOptions["onError"];
  private readonly localOrigin = Symbol("canvas-scene-local-origin");
  private surfaceAppState: Readonly<Record<string, CanvasJsonValue>>;
  private pending: PendingObservation | null = null;
  private inFlight: PendingObservation | null = null;
  private drainPromise: Promise<void> | null = null;
  private lastDrainError: Error | null = null;
  private destroyed = false;

  constructor(options: CanvasSceneBindingOptions) {
    this.envelope = options.envelope;
    this.assetDependencies = options.assetDependencies;
    this.onRemoteScene = options.onRemoteScene;
    this.onError = options.onError;
    this.surfaceAppState = this.getCurrentScene().appState;
    this.envelope.document.on("afterTransaction", this.handleTransaction);
  }

  getCurrentScene = (): CanvasSceneMaterialization =>
    inspectCanvasDocument(this.envelope.document).materialization;

  submitLocalScene = (
    observation: CanvasLocalSceneObservation,
  ): Promise<void> => {
    if (this.destroyed) {
      return Promise.reject(new Error("Canvas scene binding is destroyed"));
    }
    const elementsIncludingDeleted = [
      ...observation.getSceneElementsIncludingDeleted(),
    ];
    const nextAppState = pickDurableCanvasAppState(observation.appState);
    const nextPatch = appStatePatch(this.surfaceAppState, nextAppState);
    this.surfaceAppState = nextAppState;
    const result = new Promise<void>((resolve, reject) => {
      const waiters = [
        ...(this.pending?.waiters ?? []),
        { resolve, reject },
      ];
      this.pending = {
        elementsIncludingDeleted,
        appStatePatch: this.pending
          ? mergeAppStatePatches(this.pending.appStatePatch, nextPatch)
          : nextPatch,
        binaryFiles: observation.binaryFiles,
        waiters,
      };
      this.startDrain();
    });
    return result;
  };

  flush = async (): Promise<void> => {
    while (this.pending || this.drainPromise) {
      if (!this.drainPromise) this.startDrain();
      const active = this.drainPromise;
      if (active) await active;
    }
    if (this.lastDrainError) throw this.lastDrainError;
  };

  /** Use the same upload-aware flush at close/checkpoint and relocation fences. */
  registerSurfacePreparers = (
    registry: CanvasScenePreparationRegistry,
  ): (() => void) => {
    const unregisterPersist = registry.registerPersistPreparer(this.flush);
    let unregisterRelocation: (() => void) | null = null;
    try {
      unregisterRelocation = registry.registerRelocationPreparer(this.flush);
    } catch (error) {
      unregisterPersist();
      throw error;
    }
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      unregisterRelocation?.();
      unregisterPersist();
    };
  };

  destroy = (): void => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.envelope.document.off("afterTransaction", this.handleTransaction);
  };

  private startDrain(): void {
    if (this.drainPromise) return;
    const tracked = this.drain().finally(() => {
      if (this.drainPromise !== tracked) return;
      this.drainPromise = null;
      if (this.pending) this.startDrain();
    });
    this.drainPromise = tracked;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      let observation = this.pending;
      this.pending = null;
      this.inFlight = observation;
      const uploadedFiles: Record<string, CanvasFileSnapshot> = {};
      try {
        while (true) {
          const beforeUpload = this.getCurrentScene();
          const fileAdditions = await materializeDurableCanvasFiles({
            elementsIncludingDeleted: observation.elementsIncludingDeleted,
            binaryFiles: observation.binaryFiles,
            current: { ...beforeUpload.files, ...uploadedFiles },
            ...(this.assetDependencies
              ? { dependencies: this.assetDependencies }
              : {}),
          });
          Object.assign(uploadedFiles, fileAdditions);
          if (!this.pending) break;
          observation = mergeObservations(observation, this.pending);
          this.pending = null;
          this.inFlight = observation;
        }
        if (this.destroyed) {
          throw new Error("Canvas scene binding was destroyed before persistence");
        }
        applyRebasedCanvasSceneObservation(
          this.envelope,
          {
            elementsIncludingDeleted: observation.elementsIncludingDeleted,
            appStatePatch: observation.appStatePatch,
            fileAdditions: uploadedFiles,
          },
          this.localOrigin,
        );
        this.lastDrainError = null;
        observation.waiters.forEach((waiter) => waiter.resolve());
      } catch (error) {
        const failure = toError(error);
        this.lastDrainError = failure;
        // The failed optimistic observation is no longer pending. Reset only
        // the diff baseline so submitting the still-visible scene retries its
        // appState intent as well as its elements and files.
        this.surfaceAppState = this.getCurrentScene().appState;
        observation.waiters.forEach((waiter) => waiter.reject(failure));
        try {
          this.onError?.(failure);
        } catch {
          // Error reporting must never strand the serialized persistence loop.
        }
      } finally {
        this.inFlight = null;
      }
    }
  }

  private readonly handleTransaction = (transaction: Y.Transaction): void => {
    if (this.destroyed || transaction.origin === this.localOrigin) return;
    try {
      const scene = this.getCurrentScene();
      const inFlightPatch = this.inFlight?.appStatePatch ?? {};
      const pendingPatch = this.pending?.appStatePatch ?? {};
      const presentedAppState = presentAppStateWithPendingIntent(
        scene.appState,
        mergeAppStatePatches(inFlightPatch, pendingPatch),
      );
      this.surfaceAppState = presentedAppState;
      this.onRemoteScene(
        presentedAppState === scene.appState
          ? scene
          : { ...scene, appState: presentedAppState },
      );
    } catch (error) {
      this.onError?.(toError(error));
    }
  };
}
