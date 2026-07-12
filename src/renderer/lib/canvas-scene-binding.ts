import {
  canonicalStringifyCanvasScene,
  pickPortableCanvasSceneAppState,
  type CanvasSceneAppState,
  type CanvasSceneAppStateIntent,
  type CanvasSceneAppStateIntents,
  type CanvasSceneElement,
  type CanvasSceneFile,
  type CanvasSceneJsonValue,
  type CanvasSceneOptionalJson,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import {
  materializeDurableCanvasFiles,
  type CanvasAssetBridgeDependencies,
  type CanvasBinaryFiles,
} from "./canvas-assets";
import type { CanvasSceneProvider } from "./canvas-scene-provider";

export interface CanvasLocalSceneObservation {
  /** Must be ExcalidrawImperativeAPI.getSceneElementsIncludingDeleted. */
  readonly getSceneElementsIncludingDeleted: () => readonly unknown[];
  readonly appState: Readonly<Record<string, unknown>>;
  readonly binaryFiles: CanvasBinaryFiles;
}

export interface CanvasSceneBindingOptions {
  readonly provider: CanvasSceneProvider;
  readonly assetDependencies?: CanvasAssetBridgeDependencies;
  readonly onRemoteScene: (scene: PortableCanvasScene) => void;
  readonly onError?: (error: Error) => void;
}

interface PendingObservation {
  readonly elementsIncludingDeleted: readonly unknown[];
  readonly appStateIntents: CanvasSceneAppStateIntents;
  readonly binaryFiles: CanvasBinaryFiles;
  readonly waiters: Array<{
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }>;
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const optionalJson = (
  value: CanvasSceneJsonValue | undefined,
): CanvasSceneOptionalJson =>
  value === undefined ? { kind: "absent" } : { kind: "value", value };

const sameOptionalJson = (
  left: CanvasSceneOptionalJson,
  right: CanvasSceneOptionalJson,
): boolean => canonicalStringifyCanvasScene(left) === canonicalStringifyCanvasScene(right);

const appStateIntents = (
  before: CanvasSceneAppState,
  after: CanvasSceneAppState,
): CanvasSceneAppStateIntents => {
  const intents: Record<string, CanvasSceneAppStateIntent> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const expected = optionalJson(before[key]);
    const value = optionalJson(after[key]);
    if (sameOptionalJson(expected, value)) continue;
    intents[key] = { expected, value };
  }
  return intents;
};

const mergeAppStateIntents = (
  previous: CanvasSceneAppStateIntents,
  next: CanvasSceneAppStateIntents,
): CanvasSceneAppStateIntents => {
  const merged = { ...previous };
  for (const [key, nextIntent] of Object.entries(next)) {
    const previousIntent = merged[key];
    const intent = previousIntent && sameOptionalJson(
      previousIntent.value,
      nextIntent.expected,
    )
      ? { expected: previousIntent.expected, value: nextIntent.value }
      : nextIntent;
    if (sameOptionalJson(intent.expected, intent.value)) {
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
  appStateIntents: mergeAppStateIntents(
    previous.appStateIntents,
    next.appStateIntents,
  ),
  binaryFiles: next.binaryFiles,
  waiters: [...previous.waiters, ...next.waiters],
});

const optionalValue = (
  value: CanvasSceneOptionalJson,
): CanvasSceneJsonValue | undefined =>
  value.kind === "value" ? value.value : undefined;

const presentAppStateWithPendingIntent = (
  shared: CanvasSceneAppState,
  intents: CanvasSceneAppStateIntents,
): CanvasSceneAppState => {
  if (Object.keys(intents).length === 0) return shared;
  const presented: Record<string, CanvasSceneJsonValue> = { ...shared };
  for (const [key, intent] of Object.entries(intents)) {
    if (!sameOptionalJson(optionalJson(shared[key]), intent.expected)) continue;
    const value = optionalValue(intent.value);
    if (value === undefined) delete presented[key];
    else presented[key] = value;
  }
  return presented;
};

/**
 * Bridges Excalidraw runtime observations to the scene-native provider.
 * Uploads complete before the provider durably enqueues a mutation; remote
 * scenes remain presentation-only and therefore never enter local undo.
 */
export class CanvasSceneBinding {
  private readonly provider: CanvasSceneProvider;
  private readonly assetDependencies?: CanvasAssetBridgeDependencies;
  private readonly onRemoteScene: CanvasSceneBindingOptions["onRemoteScene"];
  private readonly onError?: CanvasSceneBindingOptions["onError"];
  private surfaceAppState: CanvasSceneAppState;
  private pending: PendingObservation | null = null;
  private inFlight: PendingObservation | null = null;
  private drainPromise: Promise<void> | null = null;
  private lastDrainError: Error | null = null;
  private destroyed = false;

  constructor(options: CanvasSceneBindingOptions) {
    this.provider = options.provider;
    this.assetDependencies = options.assetDependencies;
    this.onRemoteScene = options.onRemoteScene;
    this.onError = options.onError;
    this.surfaceAppState = this.provider.getScene()?.appState ?? {};
  }

  getCurrentScene = (): PortableCanvasScene => {
    const scene = this.provider.getScene();
    if (scene) return scene;
    throw new Error("Canvas scene provider has not completed its initial sync");
  };

  presentRemoteScene = (scene: PortableCanvasScene): void => {
    if (this.destroyed) return;
    try {
      const pendingIntent = mergeAppStateIntents(
        this.inFlight?.appStateIntents ?? {},
        this.pending?.appStateIntents ?? {},
      );
      const appState = presentAppStateWithPendingIntent(
        scene.appState,
        pendingIntent,
      );
      this.surfaceAppState = appState;
      this.onRemoteScene(
        appState === scene.appState ? scene : { ...scene, appState },
      );
    } catch (error) {
      this.onError?.(toError(error));
    }
  };

  submitLocalScene = (
    observation: CanvasLocalSceneObservation,
  ): Promise<void> => {
    if (this.destroyed) {
      return Promise.reject(new Error("Canvas scene binding is destroyed"));
    }
    const elementsIncludingDeleted = [
      ...observation.getSceneElementsIncludingDeleted(),
    ];
    const nextAppState = pickPortableCanvasSceneAppState(observation.appState);
    const nextIntents = appStateIntents(this.surfaceAppState, nextAppState);
    this.surfaceAppState = nextAppState;
    return new Promise<void>((resolve, reject) => {
      const next: PendingObservation = {
        elementsIncludingDeleted,
        appStateIntents: nextIntents,
        binaryFiles: observation.binaryFiles,
        waiters: [{ resolve, reject }],
      };
      this.pending = this.pending ? mergeObservations(this.pending, next) : next;
      this.startDrain();
    });
  };

  flush = async (): Promise<void> => {
    while (this.pending || this.drainPromise) {
      if (!this.drainPromise) this.startDrain();
      const active = this.drainPromise;
      if (active) await active;
    }
    if (this.lastDrainError) throw this.lastDrainError;
    await this.provider.flush();
  };

  destroy = (): void => {
    this.destroyed = true;
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
      const uploadedFiles: Record<string, CanvasSceneFile> = {};
      let persisted = false;
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
        await this.provider.submit({
          elementCandidates:
            observation.elementsIncludingDeleted as readonly CanvasSceneElement[],
          appStateIntents: observation.appStateIntents,
          fileAdditions: uploadedFiles,
        });
        persisted = true;
        this.lastDrainError = null;
        observation.waiters.forEach((waiter) => waiter.resolve());
      } catch (error) {
        const failure = toError(error);
        this.lastDrainError = failure;
        const current = this.provider.getScene();
        if (current) this.surfaceAppState = current.appState;
        observation.waiters.forEach((waiter) => waiter.reject(failure));
        try {
          this.onError?.(failure);
        } catch {
          // Reporting must not strand the serialized persistence loop.
        }
      } finally {
        this.inFlight = null;
        const canonical = this.provider.getScene();
        if (persisted && canonical) this.presentRemoteScene(canonical);
      }
    }
  }
}
