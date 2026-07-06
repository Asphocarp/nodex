export type LocalConversationStreamRole =
  | { role: "owner" }
  | { role: "follower"; ownerClientId: string }
  | { role: "sourceNull" };

export type LocalConversationPatchDecision =
  | { type: "apply"; sourceClientId: string | null }
  | { type: "drop"; reason: "missing-follower-role" | "owner-mismatch" | "revision-mismatch" };

type StreamStateTimer = unknown;

interface RevisionWaiter {
  conversationId: string;
  ownerClientId: string | null;
  targetRevision: number;
  timeout: StreamStateTimer;
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface LocalConversationStreamStateOptions {
  setTimeout?: (callback: () => void, ms: number) => StreamStateTimer;
  clearTimeout?: (timer: StreamStateTimer) => void;
}

function scheduleTimeout(callback: () => void, ms: number): StreamStateTimer {
  return setTimeout(callback, ms);
}

function clearScheduledTimeout(timer: StreamStateTimer): void {
  clearTimeout(timer as ReturnType<typeof setTimeout>);
}

function formatOwner(ownerClientId: string | null): string {
  return ownerClientId ?? "unknown-owner";
}

function buildSnapshotRole(sourceClientId: string | null): LocalConversationStreamRole {
  return typeof sourceClientId === "string" && sourceClientId.length > 0
    ? { role: "follower", ownerClientId: sourceClientId }
    : { role: "sourceNull" };
}

export class LocalConversationStreamState {
  private readonly streamingConversationIds = new Set<string>();
  private readonly rolesByConversationId = new Map<string, LocalConversationStreamRole>();
  private readonly revisionByConversationId = new Map<string, number>();
  private readonly waitersByConversationId = new Map<string, Set<RevisionWaiter>>();
  private readonly setTimeoutFn: (callback: () => void, ms: number) => StreamStateTimer;
  private readonly clearTimeoutFn: (timer: StreamStateTimer) => void;

  constructor(options: LocalConversationStreamStateOptions = {}) {
    this.setTimeoutFn = options.setTimeout ?? scheduleTimeout;
    this.clearTimeoutFn = options.clearTimeout ?? clearScheduledTimeout;
  }

  getRole(conversationId: string): LocalConversationStreamRole | null {
    return this.rolesByConversationId.get(conversationId) ?? null;
  }

  getRevision(conversationId: string): number | null {
    return this.revisionByConversationId.get(conversationId) ?? null;
  }

  getStreamingConversationIds(): string[] {
    return [...this.streamingConversationIds];
  }

  setStreaming(conversationId: string, streaming: boolean): void {
    if (streaming) {
      this.streamingConversationIds.add(conversationId);
      return;
    }

    this.streamingConversationIds.delete(conversationId);
  }

  markOwner(conversationId: string, revision?: number | null): void {
    this.setRole(conversationId, { role: "owner" });
    if (typeof revision === "number") {
      this.revisionByConversationId.set(conversationId, revision);
    }
  }

  recordOwnerRevision(conversationId: string, revision: number): void {
    const role = this.rolesByConversationId.get(conversationId);
    if (!role || role.role !== "owner") {
      this.markOwner(conversationId, revision);
      return;
    }

    this.revisionByConversationId.set(conversationId, revision);
  }

  acceptSnapshot(input: {
    conversationId: string;
    revision: number;
    sourceClientId: string | null;
  }): void {
    this.setRole(input.conversationId, buildSnapshotRole(input.sourceClientId));
    this.revisionByConversationId.set(input.conversationId, input.revision);
    this.resolveSatisfiedWaiters(input.conversationId);
  }

  evaluatePatch(input: {
    conversationId: string;
    baseRevision: number;
    sourceClientId: string | null;
  }): LocalConversationPatchDecision {
    const role = this.rolesByConversationId.get(input.conversationId);
    if (!role || role.role === "owner") {
      return { type: "drop", reason: "missing-follower-role" };
    }

    if (role.role === "sourceNull") {
      if (input.sourceClientId !== null) {
        return { type: "drop", reason: "owner-mismatch" };
      }
    } else if (role.ownerClientId !== input.sourceClientId) {
      return { type: "drop", reason: "owner-mismatch" };
    }

    if (this.revisionByConversationId.get(input.conversationId) !== input.baseRevision) {
      return { type: "drop", reason: "revision-mismatch" };
    }

    return { type: "apply", sourceClientId: input.sourceClientId };
  }

  acceptPatch(input: {
    conversationId: string;
    revision: number;
    sourceClientId: string | null;
  }): void {
    this.setRole(input.conversationId, buildSnapshotRole(input.sourceClientId));
    this.revisionByConversationId.set(input.conversationId, input.revision);
    this.resolveSatisfiedWaiters(input.conversationId);
  }

  waitForRevision(input: {
    conversationId: string;
    ownerClientId: string | null;
    revision: number;
    timeoutMs: number;
  }): Promise<void> {
    const role = this.rolesByConversationId.get(input.conversationId);
    if (!role || role.role !== "follower" || role.ownerClientId !== input.ownerClientId) {
      return Promise.reject(new Error(
        `Cannot wait for ${input.conversationId} revision ${input.revision} from ${formatOwner(input.ownerClientId)} because that owner is not active`,
      ));
    }

    const currentRevision = this.revisionByConversationId.get(input.conversationId) ?? 0;
    if (currentRevision >= input.revision) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter: RevisionWaiter = {
        conversationId: input.conversationId,
        ownerClientId: input.ownerClientId,
        targetRevision: input.revision,
        timeout: null,
        resolve,
        reject,
      };
      waiter.timeout = this.setTimeoutFn(() => {
        this.removeWaiter(waiter);
        reject(new Error(
          `Timed out waiting for ${input.conversationId} revision ${input.revision} from ${formatOwner(input.ownerClientId)}`,
        ));
      }, input.timeoutMs);

      this.addWaiter(waiter);
    });
  }

  markOwnerUnavailable(ownerClientId: string): string[] {
    const affectedConversationIds: string[] = [];
    for (const [conversationId, role] of this.rolesByConversationId.entries()) {
      if (role.role !== "follower" || role.ownerClientId !== ownerClientId) {
        continue;
      }

      affectedConversationIds.push(conversationId);
      this.rolesByConversationId.delete(conversationId);
      this.revisionByConversationId.delete(conversationId);
      this.rejectWaitersForConversation(
        conversationId,
        new Error(`Owner ${formatOwner(ownerClientId)} is unavailable`),
      );
    }
    return affectedConversationIds;
  }

  removeConversation(conversationId: string): void {
    this.streamingConversationIds.delete(conversationId);
    this.rolesByConversationId.delete(conversationId);
    this.revisionByConversationId.delete(conversationId);
    this.rejectWaitersForConversation(
      conversationId,
      new Error(`Conversation ${conversationId} was removed`),
    );
  }

  reset(): void {
    for (const conversationId of [...this.waitersByConversationId.keys()]) {
      this.rejectWaitersForConversation(
        conversationId,
        new Error("Stream state was reset"),
      );
    }
    this.streamingConversationIds.clear();
    this.rolesByConversationId.clear();
    this.revisionByConversationId.clear();
  }

  private setRole(conversationId: string, nextRole: LocalConversationStreamRole): void {
    const previousRole = this.rolesByConversationId.get(conversationId) ?? null;
    this.rolesByConversationId.set(conversationId, nextRole);
    if (areRolesCompatible(previousRole, nextRole)) {
      return;
    }

    this.rejectWaitersForConversation(
      conversationId,
      new Error(`Stream owner changed for ${conversationId}`),
    );
  }

  private addWaiter(waiter: RevisionWaiter): void {
    let waiters = this.waitersByConversationId.get(waiter.conversationId);
    if (!waiters) {
      waiters = new Set<RevisionWaiter>();
      this.waitersByConversationId.set(waiter.conversationId, waiters);
    }
    waiters.add(waiter);
  }

  private removeWaiter(waiter: RevisionWaiter): void {
    const waiters = this.waitersByConversationId.get(waiter.conversationId);
    if (!waiters) return;

    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.waitersByConversationId.delete(waiter.conversationId);
    }
  }

  private resolveSatisfiedWaiters(conversationId: string): void {
    const waiters = this.waitersByConversationId.get(conversationId);
    if (!waiters) return;

    const role = this.rolesByConversationId.get(conversationId) ?? null;
    const revision = this.revisionByConversationId.get(conversationId) ?? 0;
    for (const waiter of [...waiters]) {
      if (!role || role.role !== "follower" || role.ownerClientId !== waiter.ownerClientId) {
        this.rejectWaiter(waiter, new Error(`Stream owner changed for ${conversationId}`));
        continue;
      }
      if (revision < waiter.targetRevision) continue;

      this.resolveWaiter(waiter);
    }
  }

  private rejectWaitersForConversation(conversationId: string, error: Error): void {
    const waiters = this.waitersByConversationId.get(conversationId);
    if (!waiters) return;

    for (const waiter of [...waiters]) {
      this.rejectWaiter(waiter, error);
    }
  }

  private resolveWaiter(waiter: RevisionWaiter): void {
    this.removeWaiter(waiter);
    this.clearTimeoutFn(waiter.timeout);
    waiter.resolve();
  }

  private rejectWaiter(waiter: RevisionWaiter, error: Error): void {
    this.removeWaiter(waiter);
    this.clearTimeoutFn(waiter.timeout);
    waiter.reject(error);
  }
}

function areRolesCompatible(
  previousRole: LocalConversationStreamRole | null,
  nextRole: LocalConversationStreamRole,
): boolean {
  if (!previousRole) return true;
  if (previousRole.role !== nextRole.role) return false;
  if (previousRole.role === "owner") return true;
  if (previousRole.role === "sourceNull") return true;
  if (nextRole.role !== "follower") return true;

  return previousRole.ownerClientId === nextRole.ownerClientId;
}
