import type {
  CodexPostResumeGoalLoadResult,
  CodexPostResumeGoalRuntimeOptions,
} from "../codex-application/CodexPostResumeGoalRuntime";
import type { CodexPostResumeGoalRuntimePromiseAdapter } from "../codex-application/CodexPostResumeGoalRuntimePromiseAdapter";

export interface TestCodexPostResumeGoalRuntimeOptions {
  readonly load: (threadId: string) => Promise<CodexPostResumeGoalLoadResult>;
  readonly commit: CodexPostResumeGoalRuntimeOptions["commit"];
  readonly requestContinuation: CodexPostResumeGoalRuntimeOptions["requestContinuation"];
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexPostResumeGoalRuntime implements CodexPostResumeGoalRuntimePromiseAdapter {
  private readonly loads = new Map<string, Promise<CodexPostResumeGoalLoadResult>>();
  private readonly activeRequests = new Set<string>();
  private readonly latestRevision = new Map<string, number>();
  private readonly deferred = new Set<string>();

  constructor(private readonly options: TestCodexPostResumeGoalRuntimeOptions) {}

  async hydrate(threadId: string, expectedRevision: number): Promise<void> {
    const result = await this.load(threadId);
    if (!result.ok) return;
    if (this.options.commit(threadId, expectedRevision, result.goal)) {
      this.options.requestContinuation(threadId);
    }
  }

  request(threadId: string, expectedRevision: number): void {
    this.latestRevision.set(threadId, expectedRevision);
    this.options.requestContinuation(threadId);
    if (this.activeRequests.has(threadId)) return;
    this.activeRequests.add(threadId);
    void this.load(threadId)
      .then((result) => {
        const revision = this.latestRevision.get(threadId);
        if (result.ok && revision !== undefined) {
          if (this.options.commit(threadId, revision, result.goal)) {
            this.options.requestContinuation(threadId);
          }
        }
      })
      .finally(() => {
        this.activeRequests.delete(threadId);
        this.latestRevision.delete(threadId);
      });
  }

  defer(threadId: string): void {
    this.deferred.add(threadId);
  }

  release(threadId: string, expectedRevision: number): boolean {
    if (!this.deferred.delete(threadId)) return false;
    this.request(threadId, expectedRevision);
    return true;
  }

  clear(threadId: string): void {
    this.loads.delete(threadId);
    this.activeRequests.delete(threadId);
    this.latestRevision.delete(threadId);
    this.deferred.delete(threadId);
  }

  private load(threadId: string): Promise<CodexPostResumeGoalLoadResult> {
    const existing = this.loads.get(threadId);
    if (existing) return existing;
    const pending = this.options
      .load(threadId)
      .catch(() => ({ ok: false, goal: null }) satisfies CodexPostResumeGoalLoadResult);
    this.loads.set(threadId, pending);
    return pending.finally(() => {
      if (this.loads.get(threadId) === pending) this.loads.delete(threadId);
    });
  }
}
