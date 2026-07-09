export type CodexContextCompactionSource = "automatic" | "manual";

/**
 * Mirrors the app's per-thread manual-compaction admission counter. Registration
 * happens before the request, and an accepted context-compaction start consumes
 * exactly one registration.
 */
export class CodexManualCompactionTracker {
  private readonly pendingCounts = new Map<string, number>();

  register(threadId: string): number {
    const count = (this.pendingCounts.get(threadId) ?? 0) + 1;
    this.pendingCounts.set(threadId, count);
    return count;
  }

  cancel(threadId: string): number {
    return this.decrement(threadId);
  }

  consumeSource(threadId: string): CodexContextCompactionSource {
    const pendingCount = this.pendingCounts.get(threadId) ?? 0;
    if (pendingCount === 0) return "automatic";

    this.decrement(threadId);
    return "manual";
  }

  getPendingCount(threadId: string): number {
    return this.pendingCounts.get(threadId) ?? 0;
  }

  clear(threadId: string): void {
    this.pendingCounts.delete(threadId);
  }

  private decrement(threadId: string): number {
    const pendingCount = this.pendingCounts.get(threadId) ?? 0;
    if (pendingCount <= 1) {
      this.pendingCounts.delete(threadId);
      return 0;
    }

    const count = pendingCount - 1;
    this.pendingCounts.set(threadId, count);
    return count;
  }
}
