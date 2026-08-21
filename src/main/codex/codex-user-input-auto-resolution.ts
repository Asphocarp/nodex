import type { CodexProtocolRequestId } from "../../shared/types";
import type {
  CodexUserInputAutoResolutionChange,
  CodexUserInputAutoResolutionEntry,
} from "../../shared/codex-user-input-auto-resolution";

export const USER_INPUT_FOREGROUND_INACTIVITY_MS = 60_000;
export const USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS = 90_000;

interface TimerHandle {
  unref?: () => void;
}

interface TrackedUserInput {
  entry: CodexUserInputAutoResolutionEntry;
  timer: unknown | null;
  generation: number;
}

export interface CodexUserInputAutoResolutionTimerOptions {
  now?: () => number;
  setTimeout?: (callback: () => void, timeoutMs: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

interface CodexUserInputAutoResolutionControllerOptions extends CodexUserInputAutoResolutionTimerOptions {
  isConversationPresented: (conversationId: string) => boolean;
  onChange: (change: CodexUserInputAutoResolutionChange) => void;
  onResolve: (conversationId: string, requestId: CodexProtocolRequestId) => void | Promise<void>;
  onResolveError?: (
    error: unknown,
    conversationId: string,
    requestId: CodexProtocolRequestId,
  ) => void;
}

function sameRequestId(left: CodexProtocolRequestId, right: CodexProtocolRequestId): boolean {
  return typeof left === typeof right && left === right;
}

export class CodexUserInputAutoResolutionController {
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, timeoutMs: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly isConversationPresented: (conversationId: string) => boolean;
  private readonly onChange: (change: CodexUserInputAutoResolutionChange) => void;
  private readonly onResolve: (
    conversationId: string,
    requestId: CodexProtocolRequestId,
  ) => void | Promise<void>;
  private readonly onResolveError: (
    error: unknown,
    conversationId: string,
    requestId: CodexProtocolRequestId,
  ) => void;
  private readonly trackedByConversationId = new Map<string, TrackedUserInput>();
  private nextGeneration = 0;

  constructor(options: CodexUserInputAutoResolutionControllerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimeout ??
      ((callback, timeoutMs) => {
        const timer = setTimeout(callback, timeoutMs);
        timer.unref?.();
        return timer;
      });
    this.clearTimer =
      options.clearTimeout ??
      ((timer) => {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
    this.isConversationPresented = options.isConversationPresented;
    this.onChange = options.onChange;
    this.onResolve = options.onResolve;
    this.onResolveError = options.onResolveError ?? (() => undefined);
  }

  observeRequest(conversationId: string, requestId: CodexProtocolRequestId): void {
    if (this.getTracked(conversationId, requestId)) return;
    const previous = this.trackedByConversationId.get(conversationId);
    if (previous) this.removeTracked(previous, "replaced");

    const tracked: TrackedUserInput = {
      entry: {
        conversationId,
        requestId,
        phase: { type: "waitingForInactivity" },
      },
      timer: null,
      generation: ++this.nextGeneration,
    };
    this.trackedByConversationId.set(conversationId, tracked);
    if (this.isConversationPresented(conversationId)) {
      this.waitForInactivity(tracked);
      return;
    }
    this.scheduleCountdown(tracked);
  }

  observeResponse(conversationId: string, requestId: CodexProtocolRequestId): void {
    this.removeMatching(conversationId, requestId, "responded");
  }

  observeServerResolution(conversationId: string, requestId: CodexProtocolRequestId): void {
    this.removeMatching(conversationId, requestId, "resolved");
  }

  reevaluatePresentation(conversationId: string): void {
    const tracked = this.trackedByConversationId.get(conversationId);
    if (!tracked) return;
    if (tracked.entry.phase.type === "snoozed") return;
    if (this.isConversationPresented(conversationId)) {
      this.waitForInactivity(tracked);
      return;
    }
    if (tracked.entry.phase.type === "waitingForInactivity") {
      this.scheduleCountdown(tracked);
    }
  }

  recordActivity(conversationId: string): void {
    const tracked = this.trackedByConversationId.get(conversationId);
    if (!tracked) return;
    if (!this.isConversationPresented(conversationId)) return;
    if (tracked.entry.phase.type !== "waitingForInactivity") return;
    this.waitForInactivity(tracked, false);
  }

  snooze(conversationId: string, requestId: CodexProtocolRequestId): boolean {
    const tracked = this.getTracked(conversationId, requestId);
    if (!tracked) return false;
    this.cancelTimer(tracked);
    tracked.entry = {
      ...tracked.entry,
      phase: { type: "snoozed" },
    };
    this.publishUpdated(tracked);
    return true;
  }

  snapshot(): CodexUserInputAutoResolutionEntry[] {
    return [...this.trackedByConversationId.values()].map((tracked) => tracked.entry);
  }

  clearConversation(conversationId: string): void {
    const tracked = this.trackedByConversationId.get(conversationId);
    if (tracked) this.removeTracked(tracked, "disposed");
  }

  reconcilePendingRequests(
    conversationId: string,
    requestIds: readonly CodexProtocolRequestId[],
  ): void {
    const tracked = this.trackedByConversationId.get(conversationId);
    if (!tracked) return;
    if (requestIds.some((requestId) => sameRequestId(requestId, tracked.entry.requestId))) return;
    this.removeTracked(tracked, "disposed");
  }

  dispose(): void {
    this.clearAll("disposed");
  }

  handleDisconnect(): void {
    for (const tracked of [...this.trackedByConversationId.values()]) {
      this.removeTracked(tracked, "disconnected");
    }
  }

  private clearAll(reason: "disposed"): void {
    for (const tracked of [...this.trackedByConversationId.values()]) {
      this.removeTracked(tracked, reason);
    }
  }

  private waitForInactivity(tracked: TrackedUserInput, publish = true): void {
    this.cancelTimer(tracked);
    tracked.entry = {
      ...tracked.entry,
      phase: { type: "waitingForInactivity" },
    };
    if (publish) this.publishUpdated(tracked);
    this.installTimer(tracked, USER_INPUT_FOREGROUND_INACTIVITY_MS, () =>
      this.scheduleCountdown(tracked),
    );
  }

  private scheduleCountdown(tracked: TrackedUserInput): void {
    this.cancelTimer(tracked);
    tracked.entry = {
      ...tracked.entry,
      phase: {
        type: "scheduled",
        deadlineMs: this.now() + USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS,
      },
    };
    this.publishUpdated(tracked);
    this.installTimer(tracked, USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS, () =>
      this.handleTimeout(tracked),
    );
  }

  private installTimer(tracked: TrackedUserInput, timeoutMs: number, callback: () => void): void {
    const generation = tracked.generation;
    let timer: unknown = null;
    timer = this.setTimer(() => {
      if (
        this.trackedByConversationId.get(tracked.entry.conversationId) !== tracked ||
        tracked.generation !== generation ||
        tracked.timer !== timer
      ) {
        return;
      }
      tracked.timer = null;
      callback();
    }, timeoutMs);
    (timer as TimerHandle | null)?.unref?.();
    tracked.timer = timer;
  }

  private handleTimeout(tracked: TrackedUserInput): void {
    const { conversationId, requestId } = tracked.entry;
    if (this.getTracked(conversationId, requestId) !== tracked) return;
    this.deleteTracked(tracked);
    tracked.generation = ++this.nextGeneration;
    this.onChange({
      type: "timedOut",
      conversationId,
      requestId,
    });

    let result: void | Promise<void>;
    try {
      result = this.onResolve(conversationId, requestId);
    } catch (error) {
      this.onResolveError(error, conversationId, requestId);
      return;
    }

    void Promise.resolve(result).catch((error: unknown) => {
      this.onResolveError(error, conversationId, requestId);
    });
  }

  private removeMatching(
    conversationId: string,
    requestId: CodexProtocolRequestId,
    reason: "responded" | "resolved",
  ): boolean {
    const tracked = this.getTracked(conversationId, requestId);
    if (!tracked) return false;
    this.removeTracked(tracked, reason);
    return true;
  }

  private removeTracked(
    tracked: TrackedUserInput,
    reason: "responded" | "resolved" | "replaced" | "disconnected" | "disposed",
  ): void {
    this.cancelTimer(tracked);
    const { conversationId, requestId } = tracked.entry;
    this.deleteTracked(tracked);
    tracked.generation = ++this.nextGeneration;
    this.onChange({
      type: "removed",
      conversationId,
      requestId,
      reason,
    });
  }

  private getTracked(
    conversationId: string,
    requestId: CodexProtocolRequestId,
  ): TrackedUserInput | null {
    const tracked = this.trackedByConversationId.get(conversationId);
    if (!tracked) return null;
    return sameRequestId(tracked.entry.requestId, requestId) ? tracked : null;
  }

  private deleteTracked(tracked: TrackedUserInput): void {
    const { conversationId } = tracked.entry;
    if (this.trackedByConversationId.get(conversationId) !== tracked) return;
    this.trackedByConversationId.delete(conversationId);
  }

  private cancelTimer(tracked: TrackedUserInput): void {
    if (tracked.timer === null) return;
    this.clearTimer(tracked.timer);
    tracked.timer = null;
  }

  private publishUpdated(tracked: TrackedUserInput): void {
    this.onChange({
      type: "updated",
      entry: tracked.entry,
    });
  }
}
