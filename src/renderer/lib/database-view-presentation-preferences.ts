import { useMemo, useSyncExternalStore } from "react";

import { parseDatabaseViewId, type DatabaseViewId } from "../../shared/database-identities";
import {
  parseDatabaseViewPresentationOverride,
  type DatabaseViewPresentationOverride,
} from "../../shared/database-kernel";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyReceiptV2,
  type DatabaseViewPersonalPreferencesV2,
} from "../../shared/database-module-v2";
import { applyDatabaseModule, readDatabaseModule } from "./api";

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
    // A failed cleanup is harmless; Core remains authoritative after migration.
  }
};

const normalizePreference = (
  input: DatabaseViewPersonalPreferencesV2,
): DatabaseViewPersonalPreferencesV2 => ({
  presentationOverride: parseDatabaseViewPresentationOverride(
    input.presentationOverride,
  ),
  collapsedGroupKeys: [...new Set(input.collapsedGroupKeys)],
  revision: input.revision,
});

const samePreference = (
  left: Pick<DatabaseViewPersonalPreferencesV2, "presentationOverride" | "collapsedGroupKeys">,
  right: Pick<DatabaseViewPersonalPreferencesV2, "presentationOverride" | "collapsedGroupKeys">,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const readCorePreference = async (
  projectId: string,
  viewId: DatabaseViewId,
): Promise<{
  readonly storeEpoch: string;
  readonly preference: DatabaseViewPersonalPreferencesV2;
}> => {
  const result = await readDatabaseModule(projectId, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId,
    read: {
      target: { kind: "view", viewId },
      mode: "view_personal_preferences",
    },
  });
  if (!result.ok) throw new Error(result.error.message);
  if (result.value.value.kind !== "view_personal_preferences") {
    throw new Error("Database Core returned unrelated View preferences");
  }
  return {
    storeEpoch: result.value.storeEpoch,
    preference: normalizePreference(result.value.value.value),
  };
};

const preferenceRevisionFromReceipt = (
  receipt: DatabaseApplyReceiptV2,
  viewId: DatabaseViewId,
): number | null => Object.entries(receipt.committedRevisions).find(
  ([key]) => key.startsWith("view_preferences:") && key.endsWith(`:${viewId}`),
)?.[1] ?? null;

const writeCorePreference = async (input: {
  readonly projectId: string;
  readonly viewId: DatabaseViewId;
  readonly storeEpoch: string;
  readonly preference: DatabaseViewPersonalPreferencesV2;
}): Promise<number> => {
  const result = await applyDatabaseModule(input.projectId, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId: input.projectId,
    operationId: crypto.randomUUID(),
    storeEpoch: input.storeEpoch,
    actor: { kind: "renderer_database_view_preferences" },
    operations: [{
      kind: "put_view_personal_preferences",
      viewId: input.viewId,
      expectedRevision: input.preference.revision,
      presentationOverride: input.preference.presentationOverride,
      collapsedGroupKeys: input.preference.collapsedGroupKeys,
    }],
  });
  if (!result.ok) throw new Error(result.error.message);
  return preferenceRevisionFromReceipt(result.value, input.viewId)
    ?? input.preference.revision + 1;
};

export interface DatabaseViewPersonalPreferenceController {
  readonly presentationOverride: DatabaseViewPresentationOverride | undefined;
  readonly collapsedGroupKeys: readonly string[];
  readonly revision: number;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly setPresentationOverride: (
    override: DatabaseViewPresentationOverride | null,
  ) => Promise<boolean>;
  readonly setCollapsedGroupKeys: (keys: readonly string[]) => Promise<boolean>;
  readonly flush: () => Promise<DatabaseViewPersonalPreferencesV2>;
  readonly acceptCommitted: (input: {
    readonly presentationOverride: DatabaseViewPresentationOverride | null;
    readonly collapsedGroupKeys: readonly string[];
    readonly revision: number;
  }) => void;
  readonly synchronizeStoreEpoch: (storeEpoch: string) => void;
}

const EMPTY_PREFERENCE: DatabaseViewPersonalPreferencesV2 = Object.freeze({
  presentationOverride: {},
  collapsedGroupKeys: [],
  revision: 0,
});

interface DatabaseViewPersonalPreferenceSnapshot {
  readonly preference: DatabaseViewPersonalPreferencesV2;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: string | null;
}

const EMPTY_SNAPSHOT: DatabaseViewPersonalPreferenceSnapshot = Object.freeze({
  preference: EMPTY_PREFERENCE,
  loading: true,
  saving: false,
  error: null,
});

type PreferenceListener = () => void;

const MAX_RETAINED_PREFERENCE_STORES = 128;

class DatabaseViewPersonalPreferenceStore {
  private readonly listeners = new Set<PreferenceListener>();

  private snapshot = EMPTY_SNAPSHOT;

  private storeEpoch = "";

  private committed = EMPTY_PREFERENCE;

  private desired = EMPTY_PREFERENCE;

  private revision = 0;

  private writeChain: Promise<void> = Promise.resolve();

  private hydrationPromise: Promise<void> | null = null;

  private hydrated = false;

  private hydrationError: string | null = null;

  private localEditVersion = 0;

  private generation = 0;

  /** Store epoch the owning Database View expects the next read to belong to. */
  private expectedStoreEpoch: string | null = null;

  constructor(
    private readonly projectId: string,
    private readonly viewId: DatabaseViewId,
    private readonly onAccess: () => void,
    private readonly onInactive: () => void,
  ) {}

  getSnapshot = (): DatabaseViewPersonalPreferenceSnapshot => this.snapshot;

  subscribe = (listener: PreferenceListener): (() => void) => {
    this.onAccess();
    this.listeners.add(listener);
    this.ensureHydrated();
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
    this.listeners.clear();
  }

  private publish(
    patch: Partial<DatabaseViewPersonalPreferenceSnapshot>,
  ): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private ensureHydrated(): void {
    if (this.hydrationPromise) return;
    const generation = this.generation;
    const hydration = this.hydrate(generation, this.expectedStoreEpoch);
    this.hydrationPromise = hydration;
    this.writeChain = this.writeChain.catch(() => undefined).then(
      async () => await hydration,
    );
  }

  private async hydrate(
    generation: number,
    expectedStoreEpoch: string | null,
  ): Promise<void> {
    this.publish({ loading: true, error: null });
    try {
      let loaded = await readCorePreference(this.projectId, this.viewId);
      if (generation !== this.generation) return;
      if (
        expectedStoreEpoch !== null
        && loaded.storeEpoch !== expectedStoreEpoch
      ) {
        throw new Error(
          "Database View preference read crossed a Store epoch",
        );
      }
      const legacy = loaded.preference.revision === 0
        ? readLegacyOverrides()[this.viewId]
        : undefined;
      if (legacy) {
        const next = {
          presentationOverride: legacy,
          collapsedGroupKeys: [],
          revision: 0,
        };
        const revision = await writeCorePreference({
          projectId: this.projectId,
          viewId: this.viewId,
          storeEpoch: loaded.storeEpoch,
          preference: next,
        });
        loaded = {
          storeEpoch: loaded.storeEpoch,
          preference: { ...next, revision },
        };
        removeMigratedLegacyOverride(this.viewId);
      }
      if (generation !== this.generation) return;

      this.storeEpoch = loaded.storeEpoch;
      this.committed = loaded.preference;
      this.revision = loaded.preference.revision;
      this.hydrated = true;
      const desired = this.localEditVersion === 0
        ? loaded.preference
        : { ...this.desired, revision: loaded.preference.revision };
      this.desired = desired;
      this.publish({
        preference: desired,
        loading: false,
        error: null,
      });
    } catch (cause) {
      if (generation !== this.generation) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      this.hydrationError = message;
      this.publish({ loading: false, error: message });
    }
  }

  private enqueue(
    next: Pick<
      DatabaseViewPersonalPreferencesV2,
      "presentationOverride" | "collapsedGroupKeys"
    >,
  ): Promise<boolean> {
    this.ensureHydrated();
    const normalized = {
      presentationOverride: parseDatabaseViewPresentationOverride(
        next.presentationOverride,
      ),
      collapsedGroupKeys: [...new Set(next.collapsedGroupKeys)],
      revision: this.revision,
    };
    this.localEditVersion += 1;
    this.desired = normalized;
    this.publish({ preference: normalized, error: null });

    const generation = this.generation;
    let succeeded = true;
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      if (generation !== this.generation) {
        succeeded = false;
        return;
      }
      if (!this.hydrated) {
        succeeded = false;
        this.desired = this.committed;
        const message = this.hydrationError
          ?? "Database View preferences are not available";
        this.hydrationError = message;
        this.publish({ preference: this.committed, error: message });
        return;
      }

      const desired = this.desired;
      if (samePreference(desired, this.committed)) {
        this.desired = this.committed;
        this.publish({ preference: this.committed });
        return;
      }

      this.publish({ saving: true });
      try {
        const pending = { ...desired, revision: this.revision };
        const revision = await writeCorePreference({
          projectId: this.projectId,
          viewId: this.viewId,
          storeEpoch: this.storeEpoch,
          preference: pending,
        });
        if (generation !== this.generation) return;

        const committed = { ...desired, revision };
        this.revision = revision;
        this.committed = committed;
        this.desired = samePreference(this.desired, desired)
          ? committed
          : { ...this.desired, revision };
        this.publish({ preference: this.desired, error: null });
      } catch (cause) {
        if (generation !== this.generation) return;
        succeeded = false;
        this.desired = this.committed;
        this.publish({
          preference: this.committed,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        if (generation === this.generation) this.publish({ saving: false });
      }
    });
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation.then(() => succeeded);
  }

  setPresentationOverride = (
    override: DatabaseViewPresentationOverride | null,
  ): Promise<boolean> => this.enqueue({
    presentationOverride: override ?? {},
    collapsedGroupKeys: this.desired.collapsedGroupKeys,
  });

  setCollapsedGroupKeys = (keys: readonly string[]): Promise<boolean> =>
    this.enqueue({
      presentationOverride: this.desired.presentationOverride,
      collapsedGroupKeys: keys,
    });

  flush = async (): Promise<DatabaseViewPersonalPreferencesV2> => {
    this.ensureHydrated();
    await this.writeChain;
    if (!this.hydrated) {
      throw new Error(
        this.hydrationError ?? "Database View preferences are not available",
      );
    }
    return this.committed;
  };

  acceptCommitted = (input: {
    readonly presentationOverride: DatabaseViewPresentationOverride | null;
    readonly collapsedGroupKeys: readonly string[];
    readonly revision: number;
  }): void => {
    const committed = {
      presentationOverride: input.presentationOverride ?? {},
      collapsedGroupKeys: [...new Set(input.collapsedGroupKeys)],
      revision: input.revision,
    };
    this.revision = committed.revision;
    this.committed = committed;
    this.desired = committed;
    this.publish({ preference: committed, error: null });
  };

  synchronizeStoreEpoch = (storeEpoch: string): void => {
    if (!storeEpoch || storeEpoch === this.storeEpoch) return;
    if (!this.hydrated) {
      if (this.snapshot.loading) return;
      // A read that repeatedly resolves to another Store must settle as an
      // error instead of creating a render/read loop. A genuinely newer model
      // epoch may still start a fresh hydration.
      if (storeEpoch === this.expectedStoreEpoch) return;
    }
    // Store epochs are independent authority domains. Re-read the preference
    // before another write, while retaining the last preference only as a
    // non-writable presentation placeholder during hydration.
    this.generation += 1;
    this.hydrated = false;
    this.hydrationPromise = null;
    this.hydrationError = null;
    this.storeEpoch = "";
    this.expectedStoreEpoch = storeEpoch;
    this.localEditVersion = 0;
    this.publish({ loading: true, saving: false, error: null });
    this.ensureHydrated();
  };
}

class DatabaseViewPersonalPreferenceRegistry {
  private readonly stores = new Map<string, {
    readonly store: DatabaseViewPersonalPreferenceStore;
    lastAccess: number;
  }>();

  private accessSequence = 0;

  getStore(
    projectId: string,
    viewId: DatabaseViewId,
  ): DatabaseViewPersonalPreferenceStore {
    const key = JSON.stringify([projectId, viewId]);
    const existing = this.stores.get(key);
    if (existing) {
      this.touch(existing);
      return existing.store;
    }
    const store = new DatabaseViewPersonalPreferenceStore(
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
    if (this.stores.size <= MAX_RETAINED_PREFERENCE_STORES) return;
    const candidates = [...this.stores.entries()]
      .filter(([, entry]) => !entry.store.isActive())
      .sort(([, left], [, right]) => left.lastAccess - right.lastAccess);
    for (const [key, entry] of candidates) {
      if (this.stores.size <= MAX_RETAINED_PREFERENCE_STORES) return;
      entry.store.dispose();
      this.stores.delete(key);
    }
  }
}

const sharedPreferenceRegistry = new DatabaseViewPersonalPreferenceRegistry();

export const useDatabaseViewPresentationPreference = (
  projectId: string,
  rawViewId: string,
): DatabaseViewPersonalPreferenceController => {
  const viewId = parseDatabaseViewId(rawViewId);
  const store = useMemo(
    () => sharedPreferenceRegistry.getStore(projectId, viewId),
    [projectId, viewId],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const { preference } = snapshot;

  return {
    presentationOverride: Object.keys(preference.presentationOverride).length === 0
      ? undefined
      : preference.presentationOverride,
    collapsedGroupKeys: preference.collapsedGroupKeys,
    revision: preference.revision,
    loading: snapshot.loading,
    saving: snapshot.saving,
    error: snapshot.error,
    setPresentationOverride: store.setPresentationOverride,
    setCollapsedGroupKeys: store.setCollapsedGroupKeys,
    flush: store.flush,
    acceptCommitted: store.acceptCommitted,
    synchronizeStoreEpoch: store.synchronizeStoreEpoch,
  };
};

export const databaseViewPresentationPreferencesStorageKey = LEGACY_STORAGE_KEY;

export const resetDatabaseViewPresentationPreferencesForTests = (): void => {
  sharedPreferenceRegistry.reset();
};
