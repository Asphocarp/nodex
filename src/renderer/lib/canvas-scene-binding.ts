import {
  canonicalStringifyCanvasScene,
  chooseCanvasSceneElementWinner,
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
import {
  createCanvasElementChangeTracker,
  type CanvasElementObservationDelta,
  type CanvasElementChangeTracker,
} from "./canvas-element-change-tracker";
import type { CanvasSceneProvider, CanvasSceneSubmission } from "./canvas-scene-provider";

export interface CanvasLocalSceneObservation {
  /** Must come from ExcalidrawImperativeAPI.getSceneElementsIncludingDeleted. */
  readonly elementsIncludingDeleted: readonly unknown[];
  readonly appState: Readonly<Record<string, unknown>>;
  readonly binaryFiles: CanvasBinaryFiles;
}

export interface CanvasSceneBindingOptions {
  readonly provider: CanvasSceneProvider;
  readonly assetDependencies?: CanvasAssetBridgeDependencies;
  readonly stagedFileCatalog?: CanvasSceneStagedFileCatalog;
  readonly onRemoteScene: (scene: PortableCanvasScene) => void;
  readonly onError?: (error: Error) => void;
}

export class CanvasSceneStagedFileCatalog {
  private readonly staged = new Map<string, CanvasSceneFile>();
  private materializationTail: Promise<void> = Promise.resolve();

  acknowledge(scene: PortableCanvasScene): void {
    for (const fileId of Object.keys(scene.files)) this.staged.delete(fileId);
  }

  reject(
    files: Readonly<Record<string, CanvasSceneFile>>,
    accepted: Readonly<Record<string, CanvasSceneFile>>,
  ): void {
    for (const [fileId, file] of Object.entries(files)) {
      if (accepted[fileId]) continue;
      if (this.staged.get(fileId) === file) this.staged.delete(fileId);
    }
  }

  materialize(input: {
    readonly elementsIncludingDeleted: readonly unknown[];
    readonly binaryFiles: CanvasBinaryFiles;
    readonly current: Readonly<Record<string, CanvasSceneFile>>;
    readonly getAccepted: () => Readonly<Record<string, CanvasSceneFile>>;
    readonly dependencies?: CanvasAssetBridgeDependencies;
  }): Promise<Readonly<Record<string, CanvasSceneFile>>> {
    const task = this.materializationTail.then(async () => {
      const additions = await materializeDurableCanvasFiles({
        elementsIncludingDeleted: input.elementsIncludingDeleted,
        binaryFiles: input.binaryFiles,
        current: {
          ...input.getAccepted(),
          ...Object.fromEntries(this.staged),
          ...input.current,
        },
        ...(input.dependencies ? { dependencies: input.dependencies } : {}),
      });
      for (const [fileId, file] of Object.entries(additions)) {
        this.staged.set(fileId, file);
      }
      return additions;
    });
    this.materializationTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
}

interface BindingSubmissionWaiter {
  readonly resolveDurable: () => void;
  readonly rejectDurable: (error: Error) => void;
  readonly resolveCommitted: () => void;
  readonly rejectCommitted: (error: Error) => void;
}

interface PendingObservation {
  readonly elementCandidates: readonly CanvasSceneElement[];
  readonly changedImageCandidates: readonly CanvasSceneElement[];
  readonly appStateIntents: CanvasSceneAppStateIntents;
  readonly binaryFiles: CanvasBinaryFiles;
  readonly waiters: readonly BindingSubmissionWaiter[];
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const optionalJson = (value: CanvasSceneJsonValue | undefined): CanvasSceneOptionalJson =>
  value === undefined ? { kind: "absent" } : { kind: "value", value };

const sameOptionalJson = (left: CanvasSceneOptionalJson, right: CanvasSceneOptionalJson): boolean =>
  canonicalStringifyCanvasScene(left) === canonicalStringifyCanvasScene(right);

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
    const intent =
      previousIntent && sameOptionalJson(previousIntent.value, nextIntent.expected)
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
): PendingObservation => {
  const elements = new Map<string, CanvasSceneElement>();
  for (const element of previous.elementCandidates) {
    elements.set(element.id as string, element);
  }
  for (const element of next.elementCandidates) {
    const id = element.id as string;
    const current = elements.get(id);
    elements.set(id, current ? chooseCanvasSceneElementWinner(current, element) : element);
  }
  const elementCandidates = [...elements.values()];
  return {
    elementCandidates,
    changedImageCandidates: elementCandidates.filter(
      (element) =>
        element.isDeleted !== true &&
        element.type === "image" &&
        typeof element.fileId === "string",
    ),
    appStateIntents: mergeAppStateIntents(previous.appStateIntents, next.appStateIntents),
    binaryFiles: { ...previous.binaryFiles, ...next.binaryFiles },
    waiters: [...previous.waiters, ...next.waiters],
  };
};

const resolvedSubmission = (): CanvasSceneSubmission => ({
  durable: Promise.resolve(),
  committed: Promise.resolve(),
});

const rejectedSubmission = (error: Error): CanvasSceneSubmission => {
  const durable = Promise.reject(error);
  const committed = Promise.reject(error);
  void durable.catch(() => undefined);
  void committed.catch(() => undefined);
  return { durable, committed };
};

const createBindingSubmission = (): {
  readonly waiter: BindingSubmissionWaiter;
  readonly submission: CanvasSceneSubmission;
} => {
  let resolveDurable = (): void => undefined;
  let rejectDurable: (error: Error) => void = () => undefined;
  let resolveCommitted = (): void => undefined;
  let rejectCommitted: (error: Error) => void = () => undefined;
  const durable = new Promise<void>((resolve, reject) => {
    resolveDurable = resolve;
    rejectDurable = reject;
  });
  const committed = new Promise<void>((resolve, reject) => {
    resolveCommitted = resolve;
    rejectCommitted = reject;
  });
  void durable.catch(() => undefined);
  void committed.catch(() => undefined);
  return {
    waiter: {
      resolveDurable,
      rejectDurable,
      resolveCommitted,
      rejectCommitted,
    },
    submission: { durable, committed },
  };
};

const optionalValue = (value: CanvasSceneOptionalJson): CanvasSceneJsonValue | undefined =>
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
  private readonly elementTracker: CanvasElementChangeTracker;
  private readonly commitTasks = new Set<Promise<void>>();
  private readonly stagedFiles: CanvasSceneStagedFileCatalog;
  private surfaceAppState: CanvasSceneAppState;
  private pending: PendingObservation | null = null;
  private inFlight: PendingObservation | null = null;
  private retryable: PendingObservation | null = null;
  private drainPromise: Promise<void> | null = null;
  private lastDrainError: Error | null = null;
  private hasSeededElements: boolean;
  private destroyed = false;

  constructor(options: CanvasSceneBindingOptions) {
    this.provider = options.provider;
    this.assetDependencies = options.assetDependencies;
    this.stagedFiles = options.stagedFileCatalog ?? new CanvasSceneStagedFileCatalog();
    this.onRemoteScene = options.onRemoteScene;
    this.onError = options.onError;
    const initialScene = this.provider.getScene();
    this.surfaceAppState = initialScene?.appState ?? {};
    this.hasSeededElements = initialScene !== null;
    this.elementTracker = createCanvasElementChangeTracker(initialScene?.elements ?? []);
  }

  getCurrentScene = (): PortableCanvasScene => {
    const scene = this.provider.getScene();
    if (scene) return scene;
    throw new Error("Canvas scene provider has not completed its initial sync");
  };

  presentRemoteScene = (scene: PortableCanvasScene): void => {
    if (this.destroyed) return;
    try {
      this.stagedFiles.acknowledge(scene);
      if (!this.hasSeededElements && !this.pending && !this.inFlight && !this.retryable) {
        this.elementTracker.reset(scene.elements);
        this.hasSeededElements = true;
      }
      const pendingIntent = mergeAppStateIntents(
        this.inFlight?.appStateIntents ?? {},
        this.pending?.appStateIntents ?? {},
      );
      const appState = presentAppStateWithPendingIntent(scene.appState, pendingIntent);
      this.surfaceAppState = appState;
      this.onRemoteScene(appState === scene.appState ? scene : { ...scene, appState });
    } catch (error) {
      this.onError?.(toError(error));
    }
  };

  acceptRemotePresentation = (elementsIncludingDeleted: readonly unknown[]): void => {
    this.hasSeededElements = true;
    this.elementTracker.acceptRemotePresentation(
      elementsIncludingDeleted,
      new Set([
        ...(this.inFlight?.elementCandidates ?? []).map((element) => element.id as string),
        ...(this.pending?.elementCandidates ?? []).map((element) => element.id as string),
      ]),
    );
  };

  submitLocalScene = (observation: CanvasLocalSceneObservation): CanvasSceneSubmission => {
    if (this.destroyed) {
      return rejectedSubmission(new Error("Canvas scene binding is destroyed"));
    }
    if (!this.provider.getScene()) {
      const error = new Error("Canvas scene provider has not completed its initial sync");
      this.onError?.(error);
      return rejectedSubmission(error);
    }
    let elementDelta: CanvasElementObservationDelta;
    let nextAppState: CanvasSceneAppState;
    let nextIntents: CanvasSceneAppStateIntents;
    try {
      elementDelta = this.elementTracker.observeLocal(observation.elementsIncludingDeleted);
      nextAppState = pickPortableCanvasSceneAppState(observation.appState);
      nextIntents = appStateIntents(this.surfaceAppState, nextAppState);
    } catch (error) {
      const failure = toError(error);
      try {
        this.onError?.(failure);
      } catch {
        // Reporting must not escape the submission boundary.
      }
      return rejectedSubmission(failure);
    }
    this.surfaceAppState = nextAppState;
    if (elementDelta.elementCandidates.length === 0 && Object.keys(nextIntents).length === 0) {
      return resolvedSubmission();
    }

    const { waiter, submission } = createBindingSubmission();
    const next: PendingObservation = {
      elementCandidates: elementDelta.elementCandidates,
      changedImageCandidates: elementDelta.changedImageCandidates,
      appStateIntents: nextIntents,
      binaryFiles: observation.binaryFiles,
      waiters: [waiter],
    };
    const retryable = this.retryable;
    this.retryable = null;
    const withRetry = retryable ? mergeObservations(retryable, next) : next;
    this.pending = this.pending ? mergeObservations(this.pending, withRetry) : withRetry;
    this.startDrain();
    return submission;
  };

  persistDurable = async (): Promise<void> => {
    if (this.retryable && !this.pending) {
      this.pending = this.retryable;
      this.retryable = null;
      this.startDrain();
    }
    while (this.pending || this.drainPromise) {
      if (!this.drainPromise) this.startDrain();
      const active = this.drainPromise;
      if (active) await active;
    }
    if (this.lastDrainError) throw this.lastDrainError;
    await this.provider.persistDurable();
  };

  flushCommitted = async (): Promise<void> => {
    await this.persistDurable();
    await this.provider.flushCommitted();
    await Promise.all([...this.commitTasks]);
  };

  flush = (): Promise<void> => this.flushCommitted();

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
          const fileAdditions = await this.stagedFiles.materialize({
            elementsIncludingDeleted: observation.changedImageCandidates,
            binaryFiles: observation.binaryFiles,
            current: uploadedFiles,
            getAccepted: () => this.getCurrentScene().files,
            ...(this.assetDependencies ? { dependencies: this.assetDependencies } : {}),
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
        const providerSubmission = this.provider.enqueue({
          elementCandidates: observation.elementCandidates,
          appStateIntents: observation.appStateIntents,
          fileAdditions: uploadedFiles,
        });
        await providerSubmission.durable;
        this.elementTracker.markHandedOff(observation.elementCandidates);
        persisted = true;
        this.lastDrainError = null;
        observation.waiters.forEach((waiter) => waiter.resolveDurable());
        const committed = providerSubmission.committed.then(
          () => {
            observation.waiters.forEach((waiter) => waiter.resolveCommitted());
            const canonical = this.provider.getScene();
            if (canonical) this.presentRemoteScene(canonical);
          },
          (error: unknown) => {
            const failure = toError(error);
            this.elementTracker.markRejected(observation.elementCandidates);
            this.stagedFiles.reject(uploadedFiles, this.provider.getScene()?.files ?? {});
            observation.waiters.forEach((waiter) => waiter.rejectCommitted(failure));
            try {
              this.onError?.(failure);
            } catch {
              // Reporting must not strand later Canvas observations.
            }
            throw failure;
          },
        );
        this.commitTasks.add(committed);
        void committed
          .catch(() => undefined)
          .finally(() => {
            this.commitTasks.delete(committed);
          });
      } catch (error) {
        const failure = toError(error);
        this.lastDrainError = failure;
        this.elementTracker.markRejected(observation.elementCandidates);
        const retryable = { ...observation, waiters: [] };
        this.retryable = this.retryable ? mergeObservations(this.retryable, retryable) : retryable;
        const current = this.provider.getScene();
        if (current) this.surfaceAppState = current.appState;
        observation.waiters.forEach((waiter) => {
          waiter.rejectDurable(failure);
          waiter.rejectCommitted(failure);
        });
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
