export interface CodexForkSidePanelDirectStageInput {
  readonly sourceConversationId: string;
  readonly targetConversationId: string;
}

export interface CodexForkSidePanelPendingCaptureInput {
  readonly pendingWorktreeId: string;
  readonly sourceConversationId: string;
  readonly sourceWorkspaceRoot: string;
}

export interface CodexForkSidePanelPendingPromotionInput {
  readonly pendingWorktreeId: string;
  readonly targetConversationId: string;
  readonly targetWorkspaceRoot: string;
}

export interface CodexForkSidePanelTargetConsumeInput {
  readonly routeKind: "local-thread" | string;
  readonly targetConversationId: string;
  readonly targetProjectSessionId: string;
}

export interface CodexForkSidePanelTransferLifecycle {
  stageDirect(input: CodexForkSidePanelDirectStageInput): void;
  capturePending(input: CodexForkSidePanelPendingCaptureInput): void;
  promotePending(input: CodexForkSidePanelPendingPromotionInput): boolean;
  discardPending(pendingWorktreeId: string): void;
  consumeTarget(input: CodexForkSidePanelTargetConsumeInput): boolean;
  clear(): void;
}

export interface CodexForkSidePanelSnapshotAdapter<Snapshot> {
  capture(sourceConversationId: string): Snapshot;
  rebase(
    snapshot: Snapshot,
    input: {
      readonly targetConversationId: string;
      readonly sourceWorkspaceRoot?: string;
      readonly targetWorkspaceRoot?: string;
    },
  ): Snapshot;
  apply(
    snapshot: Snapshot,
    input: {
      readonly targetConversationId: string;
      readonly targetProjectSessionId: string;
    },
  ): unknown;
}

interface PendingForkSidePanelSnapshot<Snapshot> {
  readonly sourceWorkspaceRoot: string;
  readonly snapshot: Snapshot;
}

/**
 * Process-local `uyn`/`dyn`/`fyn`/`pyn`/`myn` lifecycle. Snapshot contents are
 * deliberately adapter-owned so browser identity and heterogeneous tab copying
 * can evolve without changing the exact two-slot ownership state machine.
 */
export class CodexForkSidePanelTransferManager<Snapshot>
  implements CodexForkSidePanelTransferLifecycle {
  private readonly pendingByWorktreeId = new Map<
    string,
    PendingForkSidePanelSnapshot<Snapshot>
  >();
  private readonly targetByConversationId = new Map<string, Snapshot>();

  constructor(private readonly adapter: CodexForkSidePanelSnapshotAdapter<Snapshot>) {}

  stageDirect(input: CodexForkSidePanelDirectStageInput): void {
    const captured = this.adapter.capture(input.sourceConversationId);
    const rebased = this.adapter.rebase(captured, {
      targetConversationId: input.targetConversationId,
    });
    this.targetByConversationId.set(input.targetConversationId, rebased);
  }

  capturePending(input: CodexForkSidePanelPendingCaptureInput): void {
    const captured = this.adapter.capture(input.sourceConversationId);
    this.pendingByWorktreeId.set(input.pendingWorktreeId, {
      sourceWorkspaceRoot: input.sourceWorkspaceRoot,
      snapshot: captured,
    });
  }

  promotePending(input: CodexForkSidePanelPendingPromotionInput): boolean {
    const pending = this.pendingByWorktreeId.get(input.pendingWorktreeId);
    if (!pending) return false;

    const rebased = this.adapter.rebase(pending.snapshot, {
      targetConversationId: input.targetConversationId,
      sourceWorkspaceRoot: pending.sourceWorkspaceRoot,
      targetWorkspaceRoot: input.targetWorkspaceRoot,
    });
    this.targetByConversationId.set(input.targetConversationId, rebased);
    this.pendingByWorktreeId.delete(input.pendingWorktreeId);
    return true;
  }

  discardPending(pendingWorktreeId: string): void {
    this.pendingByWorktreeId.delete(pendingWorktreeId);
  }

  consumeTarget(input: CodexForkSidePanelTargetConsumeInput): boolean {
    if (input.routeKind !== "local-thread") {
      throw new Error("Expected local conversation route");
    }
    if (!this.targetByConversationId.has(input.targetConversationId)) return false;

    const snapshot = this.targetByConversationId.get(input.targetConversationId) as Snapshot;
    this.adapter.apply(snapshot, {
      targetConversationId: input.targetConversationId,
      targetProjectSessionId: input.targetProjectSessionId,
    });
    this.targetByConversationId.delete(input.targetConversationId);
    return true;
  }

  clear(): void {
    this.pendingByWorktreeId.clear();
    this.targetByConversationId.clear();
  }

  getPendingSnapshot(pendingWorktreeId: string): Snapshot | null {
    return this.pendingByWorktreeId.get(pendingWorktreeId)?.snapshot ?? null;
  }

  getTargetSnapshot(targetConversationId: string): Snapshot | null {
    return this.targetByConversationId.get(targetConversationId) ?? null;
  }
}
