import { useMemo, useSyncExternalStore } from "react";

import { parseDatabaseViewId, type DatabaseViewId } from "../../shared/database-identities";
import {
  parseDatabaseViewPresentationOverride,
  type DatabaseViewPresentationOverride,
} from "../../shared/database-kernel";
import {
  type DatabaseApplyReceiptV2,
  type DatabaseViewDisclosureTargetV2,
  type DatabaseViewPersonalPresentationV2,
} from "../../shared/database-module-v2";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import {
  applyDatabaseModule,
  readDatabaseModule,
  subscribeDatabaseChanges,
} from "./api";

const LEGACY_STORAGE_KEY = "nodex-database-view-presentation-overrides-v1";
const EMPTY_OVERRIDES: Readonly<Record<string, DatabaseViewPresentationOverride>> =
  Object.freeze({});

type OverrideMap = Readonly<Record<string, DatabaseViewPresentationOverride>>;

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

export const normalizeDatabaseViewPresentationPreferences = (
  value: unknown,
): OverrideMap => {
  const candidates = record(value);
  if (!candidates) return EMPTY_OVERRIDES;
  const normalized: Record<string, DatabaseViewPresentationOverride> = {};
  for (const [viewId, candidate] of Object.entries(candidates)) {
    if (!viewId) continue;
    try {
      const parsed = parseDatabaseViewPresentationOverride(candidate);
      if (Object.keys(parsed).length > 0) normalized[viewId] = parsed;
    } catch {
      // One stale legacy View preference must not block another View's migration.
    }
  }
  return Object.keys(normalized).length === 0 ? EMPTY_OVERRIDES : normalized;
};

const readLegacyOverrides = (): OverrideMap => {
  if (typeof window === "undefined") return EMPTY_OVERRIDES;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw
      ? normalizeDatabaseViewPresentationPreferences(JSON.parse(raw))
      : EMPTY_OVERRIDES;
  } catch {
    return EMPTY_OVERRIDES;
  }
};

const removeMigratedLegacyOverride = (viewId: string): void => {
  if (typeof window === "undefined") return;
  const current = readLegacyOverrides();
  if (!(viewId in current)) return;
  const next = { ...current };
  delete next[viewId];
  try {
    if (Object.keys(next).length === 0) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Core is already authoritative; local cleanup can safely retry next launch.
  }
};

const normalizePresentation = (
  input: DatabaseViewPersonalPresentationV2,
): DatabaseViewPersonalPresentationV2 => ({
  presentationOverride: parseDatabaseViewPresentationOverride(
    input.presentationOverride,
  ),
  revision: input.revision,
});

const sameOverride = (
  left: DatabaseViewPresentationOverride,
  right: DatabaseViewPresentationOverride,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const disclosureTargetKey = (target: DatabaseViewDisclosureTargetV2): string =>
  JSON.stringify([target.kind, target.occurrenceKey]);

const receiptPresentationRevision = (
  receipt: DatabaseApplyReceiptV2,
  viewId: DatabaseViewId,
): number | null => Object.entries(receipt.committedRevisions).find(
  ([key]) => key.startsWith("view_presentation:") && key.endsWith(`:${viewId}`),
)?.[1] ?? null;

const readCorePresentation = async (
  projectId: string,
  viewId: DatabaseViewId,
): Promise<{
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly value: DatabaseViewPersonalPresentationV2;
}> => {
  const result = await readDatabaseModule(projectId, {
    projectId,
    read: {
      target: { kind: "view", viewId },
      mode: "view_personal_presentation",
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  if (result.value.value.kind !== "view_personal_presentation") {
    throw new Error("Database Core returned unrelated personal presentation state");
  }
  return {
    storeEpoch: result.value.storeEpoch,
    commitSeq: result.value.commitSeq,
    value: normalizePresentation(result.value.value.value),
  };
};

const readCoreCollapsedOccurrences = async (
  projectId: string,
  viewId: DatabaseViewId,
): Promise<{
  readonly storeEpoch: string;
  readonly commitSeq: number;
  readonly targets: readonly DatabaseViewDisclosureTargetV2[];
}> => {
  const result = await readDatabaseModule(projectId, {
    projectId,
    read: {
      target: { kind: "view", viewId },
      mode: "view_collapsed_occurrences",
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  if (result.value.value.kind !== "view_collapsed_occurrences") {
    throw new Error("Database Core returned unrelated occurrence disclosure state");
  }
  return {
    storeEpoch: result.value.storeEpoch,
    commitSeq: result.value.commitSeq,
    targets: result.value.value.value.targets,
  };
};

const writeCorePresentation = async (input: {
  readonly projectId: string;
  readonly viewId: DatabaseViewId;
  readonly storeEpoch: string;
  readonly value: DatabaseViewPersonalPresentationV2;
}): Promise<{ readonly revision: number; readonly commitSeq: number }> => {
  const result = await applyDatabaseModule(input.projectId, {
    projectId: input.projectId,
    operationId: crypto.randomUUID(),
    storeEpoch: input.storeEpoch,
    actor: { kind: "renderer_database_view_personal_state" },
    operations: [{
      kind: "put_view_personal_presentation",
      viewId: input.viewId,
      expectedRevision: input.value.revision,
      presentationOverride: input.value.presentationOverride,
    }],
  });
  if (!result.ok) throw new Error(result.error.message);
  return {
    revision: receiptPresentationRevision(result.value, input.viewId)
      ?? input.value.revision + 1,
    commitSeq: result.value.commitSeq,
  };
};

const writeCoreDisclosure = async (input: {
  readonly projectId: string;
  readonly viewId: DatabaseViewId;
  readonly storeEpoch: string;
  readonly target: DatabaseViewDisclosureTargetV2;
  readonly collapsed: boolean;
}): Promise<number> => {
  const result = await applyDatabaseModule(input.projectId, {
    projectId: input.projectId,
    operationId: crypto.randomUUID(),
    storeEpoch: input.storeEpoch,
    actor: { kind: "renderer_database_view_personal_state" },
    operations: [{
      kind: "set_view_occurrence_disclosure",
      viewId: input.viewId,
      target: input.target,
      collapsed: input.collapsed,
    }],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.commitSeq;
};

export interface DatabaseViewPersonalStateController {
  readonly presentationOverride: DatabaseViewPresentationOverride | undefined;
  readonly collapsedOccurrenceKeys: readonly string[];
  readonly presentationRevision: number;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly setPresentationOverride: (
    override: DatabaseViewPresentationOverride | null,
  ) => Promise<boolean>;
  readonly setOccurrenceDisclosure: (
    target: DatabaseViewDisclosureTargetV2,
    collapsed: boolean,
  ) => Promise<boolean>;
  readonly flushPresentation: () => Promise<DatabaseViewPersonalPresentationV2>;
  readonly acceptPresentationCommitted: (input: {
    readonly presentationOverride: DatabaseViewPresentationOverride | null;
    readonly revision: number;
    readonly commitSeq: number;
  }) => void;
  readonly synchronizeStoreEpoch: (storeEpoch: string) => void;
}

const EMPTY_PRESENTATION: DatabaseViewPersonalPresentationV2 = Object.freeze({
  presentationOverride: {},
  revision: 0,
});

interface DatabaseViewPersonalStateSnapshot {
  readonly presentation: DatabaseViewPersonalPresentationV2;
  readonly collapsedOccurrenceKeys: readonly string[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: string | null;
}

const EMPTY_SNAPSHOT: DatabaseViewPersonalStateSnapshot = Object.freeze({
  presentation: EMPTY_PRESENTATION,
  collapsedOccurrenceKeys: [],
  loading: true,
  saving: false,
  error: null,
});

type PersonalStateListener = () => void;
const MAX_RETAINED_PERSONAL_STATE_STORES = 128;

class DatabaseViewPersonalStateStore {
  private readonly listeners = new Set<PersonalStateListener>();
  private snapshot = EMPTY_SNAPSHOT;
  private storeEpoch = "";
  private expectedStoreEpoch: string | null = null;
  private committedPresentation = EMPTY_PRESENTATION;
  private desiredPresentation = EMPTY_PRESENTATION;
  private committedCollapsedOccurrenceKeys = new Set<string>();
  private collapsedOccurrenceKeys = new Set<string>();
  private presentationCommitSeq = 0;
  private disclosureCommitSeq = 0;
  private readonly disclosureCommitSeqByTarget = new Map<string, number>();
  private presentationWriteChain: Promise<void> = Promise.resolve();
  private readonly disclosureWriteChains = new Map<string, Promise<void>>();
  private hydrationPromise: Promise<void> | null = null;
  private hydrated = false;
  private hydrationError: string | null = null;
  private presentationLocalEditVersion = 0;
  private disclosureEditSequence = 0;
  private readonly disclosureOverrides = new Map<string, {
    readonly target: DatabaseViewDisclosureTargetV2;
    readonly collapsed: boolean;
    readonly version: number;
  }>();
  private pendingPresentationWrites = 0;
  private pendingDisclosureWrites = 0;
  private generation = 0;
  private releaseChanges: (() => void) | null = null;

  constructor(
    private readonly projectId: string,
    private readonly viewId: DatabaseViewId,
    private readonly onAccess: () => void,
    private readonly onInactive: () => void,
  ) {}

  getSnapshot = (): DatabaseViewPersonalStateSnapshot => this.snapshot;

  subscribe = (listener: PersonalStateListener): (() => void) => {
    this.onAccess();
    this.listeners.add(listener);
    this.ensureChangeSubscription();
    void this.ensureHydrated();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.onInactive();
    };
  };

  isActive(): boolean {
    return this.listeners.size > 0;
  }

  dispose(): void {
    this.generation += 1;
    this.releaseChanges?.();
    this.releaseChanges = null;
    this.listeners.clear();
    this.disclosureWriteChains.clear();
  }

  private ensureChangeSubscription(): void {
    if (this.releaseChanges) return;
    this.releaseChanges = subscribeDatabaseChanges(this.projectId, this.acceptChangeEvent);
  }

  private publish(patch: Partial<DatabaseViewPersonalStateSnapshot> = {}): void {
    this.snapshot = {
      ...this.snapshot,
      presentation: this.desiredPresentation,
      collapsedOccurrenceKeys: [...this.collapsedOccurrenceKeys].sort(),
      saving: this.pendingPresentationWrites + this.pendingDisclosureWrites > 0,
      ...patch,
    };
    for (const listener of this.listeners) listener();
  }

  private rebuildCollapsedOccurrences(): void {
    const next = new Set(this.committedCollapsedOccurrenceKeys);
    for (const override of this.disclosureOverrides.values()) {
      if (override.collapsed) next.add(override.target.occurrenceKey);
      else next.delete(override.target.occurrenceKey);
    }
    this.collapsedOccurrenceKeys = next;
  }

  private applyCommittedDisclosure(
    target: DatabaseViewDisclosureTargetV2,
    collapsed: boolean,
  ): void {
    if (collapsed) this.committedCollapsedOccurrenceKeys.add(target.occurrenceKey);
    else this.committedCollapsedOccurrenceKeys.delete(target.occurrenceKey);
  }

  private ensureHydrated(): Promise<void> {
    if (this.hydrationPromise) return this.hydrationPromise;
    const generation = this.generation;
    const hydration = this.hydrate(generation, this.expectedStoreEpoch);
    this.hydrationPromise = hydration;
    return hydration;
  }

  private async hydrate(
    generation: number,
    expectedStoreEpoch: string | null,
  ): Promise<void> {
    this.publish({ loading: true, error: null });
    try {
      const [loadedPresentation, disclosure] = await Promise.all([
        readCorePresentation(this.projectId, this.viewId),
        readCoreCollapsedOccurrences(this.projectId, this.viewId),
      ]);
      let presentation = loadedPresentation;
      if (generation !== this.generation) return;
      if (presentation.storeEpoch !== disclosure.storeEpoch) {
        throw new Error("Database View personal state read crossed a Store epoch");
      }
      if (
        expectedStoreEpoch !== null
        && presentation.storeEpoch !== expectedStoreEpoch
      ) {
        throw new Error("Database View personal state read crossed a Store epoch");
      }

      const legacy = presentation.value.revision === 0
        ? readLegacyOverrides()[this.viewId]
        : undefined;
      if (legacy) {
        const result = await writeCorePresentation({
          projectId: this.projectId,
          viewId: this.viewId,
          storeEpoch: presentation.storeEpoch,
          value: { presentationOverride: legacy, revision: 0 },
        });
        presentation = {
          ...presentation,
          commitSeq: result.commitSeq,
          value: { presentationOverride: legacy, revision: result.revision },
        };
        removeMigratedLegacyOverride(this.viewId);
      }
      if (generation !== this.generation) return;

      this.storeEpoch = presentation.storeEpoch;
      if (presentation.commitSeq >= this.presentationCommitSeq) {
        this.presentationCommitSeq = presentation.commitSeq;
        this.committedPresentation = presentation.value;
        if (this.presentationLocalEditVersion === 0) {
          this.desiredPresentation = presentation.value;
        } else {
          this.desiredPresentation = {
            ...this.desiredPresentation,
            revision: presentation.value.revision,
          };
        }
      }
      if (disclosure.commitSeq >= this.disclosureCommitSeq) {
        this.disclosureCommitSeq = disclosure.commitSeq;
        this.committedCollapsedOccurrenceKeys = new Set(
          disclosure.targets.map((target) => target.occurrenceKey),
        );
        this.rebuildCollapsedOccurrences();
      }
      this.hydrated = true;
      this.hydrationError = null;
      this.publish({ loading: false, error: null });
    } catch (cause) {
      if (generation !== this.generation) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      this.hydrationError = message;
      this.publish({ loading: false, error: message });
    }
  }

  private acceptChangeEvent = (event: DatabaseChangeEvent): void => {
    if (event.storeEpoch !== this.storeEpoch) {
      if (this.storeEpoch) this.synchronizeStoreEpoch(event.storeEpoch);
      return;
    }
    let changed = false;
    for (const change of event.personalViewChanges) {
      if (change.viewId !== this.viewId) continue;
      if (change.kind === "presentation") {
        if (event.commitSeq < this.presentationCommitSeq) continue;
        const incoming = normalizePresentation({
          presentationOverride: change.presentationOverride,
          revision: change.revision,
        });
        this.presentationCommitSeq = event.commitSeq;
        this.committedPresentation = incoming;
        if (
          this.pendingPresentationWrites === 0
          || sameOverride(this.desiredPresentation.presentationOverride, incoming.presentationOverride)
        ) {
          this.desiredPresentation = incoming;
        }
        changed = true;
        continue;
      }
      const targetKey = disclosureTargetKey(change.target);
      if (event.commitSeq < this.disclosureCommitSeq) continue;
      const seen = this.disclosureCommitSeqByTarget.get(targetKey) ?? 0;
      if (event.commitSeq < seen) continue;
      this.disclosureCommitSeqByTarget.set(targetKey, event.commitSeq);
      this.disclosureCommitSeq = Math.max(this.disclosureCommitSeq, event.commitSeq);
      this.applyCommittedDisclosure(change.target, change.collapsed);
      this.rebuildCollapsedOccurrences();
      changed = true;
    }
    if (changed) this.publish({ error: null });
  };

  private async refreshPresentation(generation: number): Promise<void> {
    const loaded = await readCorePresentation(this.projectId, this.viewId);
    if (generation !== this.generation || loaded.storeEpoch !== this.storeEpoch) return;
    if (loaded.commitSeq < this.presentationCommitSeq) return;
    this.presentationCommitSeq = loaded.commitSeq;
    this.committedPresentation = loaded.value;
    this.desiredPresentation = loaded.value;
  }

  private async refreshDisclosure(generation: number): Promise<void> {
    const loaded = await readCoreCollapsedOccurrences(this.projectId, this.viewId);
    if (generation !== this.generation || loaded.storeEpoch !== this.storeEpoch) return;
    if (loaded.commitSeq < this.disclosureCommitSeq) return;
    this.disclosureCommitSeq = loaded.commitSeq;
    this.committedCollapsedOccurrenceKeys = new Set(
      loaded.targets.map((target) => target.occurrenceKey),
    );
    this.rebuildCollapsedOccurrences();
  }

  setPresentationOverride = (
    override: DatabaseViewPresentationOverride | null,
  ): Promise<boolean> => {
    void this.ensureHydrated();
    this.presentationLocalEditVersion += 1;
    this.pendingPresentationWrites += 1;
    this.desiredPresentation = {
      presentationOverride: parseDatabaseViewPresentationOverride(override ?? {}),
      revision: this.committedPresentation.revision,
    };
    this.publish({ error: null });

    const generation = this.generation;
    let succeeded = true;
    const operation = this.presentationWriteChain.catch(() => undefined).then(async () => {
      await this.ensureHydrated();
      if (generation !== this.generation || !this.hydrated) {
        succeeded = false;
        return;
      }
      const desired = this.desiredPresentation;
      if (sameOverride(
        desired.presentationOverride,
        this.committedPresentation.presentationOverride,
      )) {
        this.desiredPresentation = this.committedPresentation;
        return;
      }
      try {
        const result = await writeCorePresentation({
          projectId: this.projectId,
          viewId: this.viewId,
          storeEpoch: this.storeEpoch,
          value: {
            presentationOverride: desired.presentationOverride,
            revision: this.committedPresentation.revision,
          },
        });
        if (generation !== this.generation) return;
        const committed = { ...desired, revision: result.revision };
        if (result.commitSeq >= this.presentationCommitSeq) {
          this.presentationCommitSeq = result.commitSeq;
          this.committedPresentation = committed;
        }
        this.desiredPresentation = sameOverride(
          this.desiredPresentation.presentationOverride,
          desired.presentationOverride,
        )
          ? this.committedPresentation
          : { ...this.desiredPresentation, revision: result.revision };
      } catch (cause) {
        if (generation !== this.generation) return;
        succeeded = false;
        try {
          await this.refreshPresentation(generation);
        } catch {
          this.desiredPresentation = this.committedPresentation;
        }
        this.hydrationError = cause instanceof Error ? cause.message : String(cause);
      }
    }).finally(() => {
      if (generation !== this.generation) return;
      this.pendingPresentationWrites = Math.max(0, this.pendingPresentationWrites - 1);
      this.publish({ error: succeeded ? null : this.hydrationError });
    });
    this.presentationWriteChain = operation.then(() => undefined, () => undefined);
    return operation.then(() => succeeded);
  };

  setOccurrenceDisclosure = (
    target: DatabaseViewDisclosureTargetV2,
    collapsed: boolean,
  ): Promise<boolean> => {
    void this.ensureHydrated();
    this.disclosureEditSequence += 1;
    this.pendingDisclosureWrites += 1;
    const targetKey = disclosureTargetKey(target);
    const version = this.disclosureEditSequence;
    this.disclosureOverrides.set(targetKey, { target, collapsed, version });
    this.rebuildCollapsedOccurrences();
    this.publish({ error: null });

    const generation = this.generation;
    let succeeded = true;
    const previous = this.disclosureWriteChains.get(targetKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await this.ensureHydrated();
      if (generation !== this.generation || !this.hydrated) {
        succeeded = false;
        return;
      }
      try {
        const commitSeq = await writeCoreDisclosure({
          projectId: this.projectId,
          viewId: this.viewId,
          storeEpoch: this.storeEpoch,
          target,
          collapsed,
        });
        if (generation !== this.generation) return;
        const seen = this.disclosureCommitSeqByTarget.get(targetKey) ?? 0;
        if (commitSeq >= seen) {
          this.disclosureCommitSeqByTarget.set(targetKey, commitSeq);
          this.disclosureCommitSeq = Math.max(this.disclosureCommitSeq, commitSeq);
          this.applyCommittedDisclosure(target, collapsed);
        }
      } catch (cause) {
        if (generation !== this.generation) return;
        succeeded = false;
        try {
          await this.refreshDisclosure(generation);
        } catch {
          // Keep the optimistic state visible until a later authoritative event/read.
        }
        this.hydrationError = cause instanceof Error ? cause.message : String(cause);
      }
    }).finally(() => {
      if (generation !== this.generation) return;
      if (this.disclosureOverrides.get(targetKey)?.version === version) {
        this.disclosureOverrides.delete(targetKey);
      }
      this.rebuildCollapsedOccurrences();
      this.pendingDisclosureWrites = Math.max(0, this.pendingDisclosureWrites - 1);
      this.publish({ error: succeeded ? null : this.hydrationError });
    });
    const settled = operation.then(() => undefined, () => undefined);
    this.disclosureWriteChains.set(targetKey, settled);
    void settled.finally(() => {
      if (this.disclosureWriteChains.get(targetKey) === settled) {
        this.disclosureWriteChains.delete(targetKey);
      }
    });
    return operation.then(() => succeeded);
  };

  flushPresentation = async (): Promise<DatabaseViewPersonalPresentationV2> => {
    await this.ensureHydrated();
    await this.presentationWriteChain;
    if (!this.hydrated) {
      throw new Error(
        this.hydrationError ?? "Database View personal presentation is not available",
      );
    }
    return this.committedPresentation;
  };

  acceptPresentationCommitted = (input: {
    readonly presentationOverride: DatabaseViewPresentationOverride | null;
    readonly revision: number;
    readonly commitSeq: number;
  }): void => {
    if (input.commitSeq < this.presentationCommitSeq) return;
    const committed = normalizePresentation({
      presentationOverride: input.presentationOverride ?? {},
      revision: input.revision,
    });
    this.presentationCommitSeq = input.commitSeq;
    this.committedPresentation = committed;
    this.desiredPresentation = committed;
    this.publish({ error: null });
  };

  synchronizeStoreEpoch = (storeEpoch: string): void => {
    if (!storeEpoch || storeEpoch === this.storeEpoch) return;
    if (!this.hydrated) {
      if (this.snapshot.loading) return;
      if (storeEpoch === this.expectedStoreEpoch) return;
    }
    this.generation += 1;
    this.hydrated = false;
    this.hydrationPromise = null;
    this.hydrationError = null;
    this.storeEpoch = "";
    this.expectedStoreEpoch = storeEpoch;
    this.presentationCommitSeq = 0;
    this.disclosureCommitSeq = 0;
    this.disclosureCommitSeqByTarget.clear();
    this.presentationLocalEditVersion = 0;
    this.disclosureEditSequence = 0;
    this.disclosureOverrides.clear();
    this.committedCollapsedOccurrenceKeys = new Set(this.collapsedOccurrenceKeys);
    this.pendingPresentationWrites = 0;
    this.pendingDisclosureWrites = 0;
    this.presentationWriteChain = Promise.resolve();
    this.disclosureWriteChains.clear();
    this.publish({ loading: true, saving: false, error: null });
    void this.ensureHydrated();
  };
}

class DatabaseViewPersonalStateRegistry {
  private readonly stores = new Map<string, {
    readonly store: DatabaseViewPersonalStateStore;
    lastAccess: number;
  }>();
  private accessSequence = 0;

  getStore(projectId: string, viewId: DatabaseViewId): DatabaseViewPersonalStateStore {
    const key = JSON.stringify([projectId, viewId]);
    const existing = this.stores.get(key);
    if (existing) {
      this.touch(existing);
      return existing.store;
    }
    const store = new DatabaseViewPersonalStateStore(
      projectId,
      viewId,
      () => {
        const entry = this.stores.get(key);
        if (entry) this.touch(entry);
      },
      () => this.pruneInactiveStores(),
    );
    const entry = { store, lastAccess: 0 };
    this.touch(entry);
    this.stores.set(key, entry);
    this.pruneInactiveStores();
    return store;
  }

  reset(): void {
    for (const { store } of this.stores.values()) store.dispose();
    this.stores.clear();
  }

  private touch(entry: { lastAccess: number }): void {
    this.accessSequence += 1;
    entry.lastAccess = this.accessSequence;
  }

  private pruneInactiveStores(): void {
    if (this.stores.size <= MAX_RETAINED_PERSONAL_STATE_STORES) return;
    const candidates = [...this.stores.entries()]
      .filter(([, entry]) => !entry.store.isActive())
      .sort(([, left], [, right]) => left.lastAccess - right.lastAccess);
    for (const [key, entry] of candidates) {
      if (this.stores.size <= MAX_RETAINED_PERSONAL_STATE_STORES) return;
      entry.store.dispose();
      this.stores.delete(key);
    }
  }
}

const sharedPersonalStateRegistry = new DatabaseViewPersonalStateRegistry();

export const useDatabaseViewPresentationPreference = (
  projectId: string,
  rawViewId: string,
): DatabaseViewPersonalStateController => {
  const viewId = parseDatabaseViewId(rawViewId);
  const store = useMemo(
    () => sharedPersonalStateRegistry.getStore(projectId, viewId),
    [projectId, viewId],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return {
    presentationOverride: Object.keys(snapshot.presentation.presentationOverride).length === 0
      ? undefined
      : snapshot.presentation.presentationOverride,
    collapsedOccurrenceKeys: snapshot.collapsedOccurrenceKeys,
    presentationRevision: snapshot.presentation.revision,
    loading: snapshot.loading,
    saving: snapshot.saving,
    error: snapshot.error,
    setPresentationOverride: store.setPresentationOverride,
    setOccurrenceDisclosure: store.setOccurrenceDisclosure,
    flushPresentation: store.flushPresentation,
    acceptPresentationCommitted: store.acceptPresentationCommitted,
    synchronizeStoreEpoch: store.synchronizeStoreEpoch,
  };
};

export const databaseViewPresentationPreferencesStorageKey = LEGACY_STORAGE_KEY;

export const resetDatabaseViewPresentationPreferencesForTests = (): void => {
  sharedPersonalStateRegistry.reset();
};
