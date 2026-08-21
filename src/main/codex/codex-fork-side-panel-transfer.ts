import type {
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserSceneContext,
} from "../../shared/codex-fork-browser-transfer";

export interface CodexForkSidePanelDirectStageInput {
  readonly sourceConversationId: string;
  readonly targetConversationId: string;
  readonly sourceSceneContext?: CodexForkBrowserSceneContext;
}

export interface CodexForkSidePanelPendingCaptureInput {
  readonly pendingWorktreeId: string;
  readonly sourceConversationId: string;
  readonly sourceWorkspaceRoot: string;
  readonly sourceSceneContext?: CodexForkBrowserSceneContext;
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
  readonly targetBrowserViewScopeId?: string;
}

export interface CodexForkSidePanelTransferLifecycle<Snapshot = CodexForkBrowserSidePanelSnapshot> {
  stageDirect(input: CodexForkSidePanelDirectStageInput): Promise<void>;
  capturePending(input: CodexForkSidePanelPendingCaptureInput): Promise<void>;
  promotePending(input: CodexForkSidePanelPendingPromotionInput): Promise<boolean>;
  discardPending(pendingWorktreeId: string): void;
  consumeTarget(input: CodexForkSidePanelTargetConsumeInput): Promise<Snapshot | null>;
  clear(): void;
}

export interface CodexForkSidePanelSnapshotAdapter<Snapshot> {
  capture(
    sourceConversationId: string,
    sourceSceneContext?: CodexForkBrowserSceneContext,
  ): Promise<Snapshot>;
  rebase(
    snapshot: Snapshot,
    input: {
      readonly targetConversationId: string;
      readonly sourceWorkspaceRoot?: string;
      readonly targetWorkspaceRoot?: string;
    },
  ): Promise<Snapshot>;
  apply(
    snapshot: Snapshot,
    input: {
      readonly targetConversationId: string;
      readonly targetProjectSessionId: string;
      readonly targetBrowserViewScopeId: string;
    },
  ): Promise<Snapshot | void>;
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
export class CodexForkSidePanelTransferManager<
  Snapshot,
> implements CodexForkSidePanelTransferLifecycle<Snapshot> {
  private readonly pendingByWorktreeId = new Map<string, PendingForkSidePanelSnapshot<Snapshot>>();
  private readonly targetByConversationId = new Map<string, Snapshot>();

  constructor(private readonly adapter: CodexForkSidePanelSnapshotAdapter<Snapshot>) {}

  async stageDirect(input: CodexForkSidePanelDirectStageInput): Promise<void> {
    const captured = await this.adapter.capture(
      input.sourceConversationId,
      input.sourceSceneContext,
    );
    const rebased = await this.adapter.rebase(captured, {
      targetConversationId: input.targetConversationId,
    });
    this.targetByConversationId.set(input.targetConversationId, rebased);
  }

  async capturePending(input: CodexForkSidePanelPendingCaptureInput): Promise<void> {
    const captured = await this.adapter.capture(
      input.sourceConversationId,
      input.sourceSceneContext,
    );
    this.pendingByWorktreeId.set(input.pendingWorktreeId, {
      sourceWorkspaceRoot: input.sourceWorkspaceRoot,
      snapshot: captured,
    });
  }

  async promotePending(input: CodexForkSidePanelPendingPromotionInput): Promise<boolean> {
    const pending = this.pendingByWorktreeId.get(input.pendingWorktreeId);
    if (!pending) return false;

    const rebased = await this.adapter.rebase(pending.snapshot, {
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

  async consumeTarget(input: CodexForkSidePanelTargetConsumeInput): Promise<Snapshot | null> {
    if (input.routeKind !== "local-thread") {
      throw new Error("Expected local conversation route");
    }
    if (!this.targetByConversationId.has(input.targetConversationId)) return null;

    const snapshot = this.targetByConversationId.get(input.targetConversationId) as Snapshot;
    const applied = await this.adapter.apply(snapshot, {
      targetConversationId: input.targetConversationId,
      targetProjectSessionId: input.targetProjectSessionId,
      targetBrowserViewScopeId:
        input.targetBrowserViewScopeId ?? `headless:${input.targetProjectSessionId}`,
    });
    this.targetByConversationId.delete(input.targetConversationId);
    return applied ?? snapshot;
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
