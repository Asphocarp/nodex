import type { DatabaseNotifier } from "../local-store/notifier";
import type {
  CodexSidebarSyncNotification,
  CodexSidebarProjectionInput,
  CodexSidebarSyncInput,
  CodexSidebarSyncMetadata,
} from "../codex-application/CodexSidebarSyncRuntime";
import type { CodexSidebarSyncRuntimePromiseAdapter } from "../codex-application/CodexSidebarSyncRuntimePromiseAdapter";
import type {
  CodexSidebarRefreshReason,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
} from "../../shared/types";

interface TestCodexSidebarSyncRuntimeOptions {
  readonly refresh: (input: {
    readonly includeArchived: boolean;
    readonly reason: CodexSidebarRefreshReason;
  }) => Promise<CodexSidebarSyncMetadata>;
  readonly buildSnapshot: (
    includeArchived: boolean,
    revision: number,
  ) => Promise<CodexSidebarSnapshot>;
  readonly emit: (result: CodexSidebarSyncResult, reason: CodexSidebarRefreshReason) => void;
  readonly notifier: DatabaseNotifier;
  readonly notificationDebounceMs?: number;
}

const EMPTY_METADATA: CodexSidebarSyncMetadata = {
  changedProjectIds: [],
  projectlessChanged: false,
  materializedSessionIds: [],
  failedThreadIds: [],
};

const shouldEmit = (result: CodexSidebarSyncResult): boolean =>
  result.refreshed ||
  result.changedProjectIds.length > 0 ||
  result.projectlessChanged ||
  result.materializedSessionIds.length > 0 ||
  result.failedThreadIds.length > 0;

interface TestCatalogState {
  lastSuccessfulGeneration: number;
  lastSuccessfulRefreshAt: number;
  failureBackoffUntil: number;
  failureBackoffMs: number;
  lastFailure: unknown;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexSidebarSyncRuntime implements CodexSidebarSyncRuntimePromiseAdapter {
  readonly #active = new Map<boolean, Promise<CodexSidebarSyncResult>>();
  readonly #cache = new Map<
    boolean,
    { readonly revision: number; readonly snapshot: CodexSidebarSnapshot }
  >();
  readonly #catalogStates = new Map<boolean, TestCatalogState>();
  readonly #invalidate = (): void => {
    this.#revision += 1;
  };
  #revision = 0;
  #generation = 0;
  #notificationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: TestCodexSidebarSyncRuntimeOptions) {
    options.notifier.on("project-sessions-changed", this.#invalidate);
  }

  async sync(input: CodexSidebarSyncInput = {}): Promise<CodexSidebarSyncResult> {
    const includeArchived = input.includeArchived === true;
    const policy = input.policy ?? "stale";
    const reason = input.reason ?? "manual";
    const state = this.#stateFor(includeArchived);
    if (policy === "read") {
      return await this.publish({
        includeArchived,
        source: "core",
        refreshed: false,
        refreshedAt: state.lastSuccessfulRefreshAt,
        metadata: EMPTY_METADATA,
        reason,
      });
    }

    const now = Date.now();
    const cached = this.#cache.get(includeArchived);
    if (
      policy === "stale" &&
      state.lastSuccessfulGeneration > 0 &&
      now - state.lastSuccessfulRefreshAt < 60_000 &&
      state.failureBackoffUntil <= now &&
      cached?.revision === this.#revision
    ) {
      return this.#cachedResult(cached.snapshot, "core", includeArchived);
    }
    if (policy === "stale" && state.failureBackoffUntil > now) {
      if (cached) return this.#cachedResult(cached.snapshot, "stale-last-known", includeArchived);
      throw state.lastFailure ?? new Error("Core is busy");
    }

    const existing = this.#active.get(includeArchived);
    if (existing) return await existing;
    const generation = ++this.#generation;
    const physical = this.#runRefresh(includeArchived, reason, generation);
    this.#active.set(includeArchived, physical);
    try {
      return await physical;
    } finally {
      if (this.#active.get(includeArchived) === physical) this.#active.delete(includeArchived);
    }
  }

  async publish(input: CodexSidebarProjectionInput): Promise<CodexSidebarSyncResult> {
    const revisionAtStart = this.#revision;
    const snapshot = await this.options.buildSnapshot(input.includeArchived, revisionAtStart);
    const result: CodexSidebarSyncResult = {
      snapshot,
      source: input.source,
      refreshed: input.refreshed,
      refreshedAt:
        input.refreshedAt ?? this.#stateFor(input.includeArchived).lastSuccessfulRefreshAt,
      changedProjectIds: [...input.metadata.changedProjectIds],
      projectlessChanged: input.metadata.projectlessChanged,
      materializedSessionIds: [...input.metadata.materializedSessionIds],
      failedThreadIds: [...input.metadata.failedThreadIds],
    };
    this.#cache.set(input.includeArchived, { revision: revisionAtStart, snapshot });
    if (input.forceEmit || shouldEmit(result)) this.options.emit(result, input.reason);
    return result;
  }

  invalidate(): void {
    this.#invalidate();
  }

  scheduleNotification(_request: CodexSidebarSyncNotification): void {
    const minimumSyncGeneration = this.#generation + 1;
    if (this.#notificationTimer) clearTimeout(this.#notificationTimer);
    this.#notificationTimer = setTimeout(() => {
      this.#notificationTimer = null;
      void this.#repairAfterNotification(minimumSyncGeneration).catch(() => undefined);
    }, this.options.notificationDebounceMs ?? 300);
  }

  dispose(): void {
    if (this.#notificationTimer) clearTimeout(this.#notificationTimer);
    this.#notificationTimer = null;
    this.options.notifier.off("project-sessions-changed", this.#invalidate);
    this.#active.clear();
    this.#cache.clear();
    this.#catalogStates.clear();
  }

  async #runRefresh(
    includeArchived: boolean,
    reason: CodexSidebarRefreshReason,
    generation: number,
  ): Promise<CodexSidebarSyncResult> {
    const state = this.#stateFor(includeArchived);
    try {
      const metadata = await this.options.refresh({ includeArchived, reason });
      const refreshedAt = Date.now();
      const result = await this.publish({
        includeArchived,
        source: "app-server",
        refreshed: true,
        refreshedAt,
        metadata,
        reason,
      });
      state.lastSuccessfulRefreshAt = refreshedAt;
      state.lastSuccessfulGeneration = Math.max(state.lastSuccessfulGeneration, generation);
      state.failureBackoffUntil = 0;
      state.failureBackoffMs = 2_000;
      state.lastFailure = null;
      return result;
    } catch (error) {
      state.lastFailure = error;
      state.failureBackoffUntil = Date.now() + state.failureBackoffMs;
      state.failureBackoffMs = Math.min(state.failureBackoffMs * 2, 60_000);
      const cached = this.#cache.get(includeArchived);
      if (cached) return this.#cachedResult(cached.snapshot, "stale-last-known", includeArchived);
      throw error;
    }
  }

  async #repairAfterNotification(minimumSyncGeneration: number): Promise<void> {
    const state = this.#stateFor(false);
    if (state.lastSuccessfulGeneration >= minimumSyncGeneration) return;
    try {
      await this.#active.get(false);
    } catch {
      // A failed older request does not satisfy the notification fence.
    }
    if (state.lastSuccessfulGeneration >= minimumSyncGeneration) return;
    await this.sync({ policy: "force", reason: "host-message" });
  }

  #cachedResult(
    snapshot: CodexSidebarSnapshot,
    source: "core" | "stale-last-known",
    includeArchived: boolean,
  ): CodexSidebarSyncResult {
    return {
      snapshot,
      source,
      refreshed: false,
      refreshedAt: this.#stateFor(includeArchived).lastSuccessfulRefreshAt,
      changedProjectIds: [],
      projectlessChanged: false,
      materializedSessionIds: [],
      failedThreadIds: [],
    };
  }

  #stateFor(includeArchived: boolean): TestCatalogState {
    const existing = this.#catalogStates.get(includeArchived);
    if (existing) return existing;
    const state: TestCatalogState = {
      lastSuccessfulGeneration: 0,
      lastSuccessfulRefreshAt: 0,
      failureBackoffUntil: 0,
      failureBackoffMs: 2_000,
      lastFailure: null,
    };
    this.#catalogStates.set(includeArchived, state);
    return state;
  }
}
