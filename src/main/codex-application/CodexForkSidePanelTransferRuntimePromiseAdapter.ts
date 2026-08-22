import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexForkBrowserSidePanelSnapshot } from "../../shared/codex-fork-browser-transfer";
import {
  CodexForkSidePanelTransferError,
  type CodexForkSidePanelDirectStageInput,
  type CodexForkSidePanelPendingCaptureInput,
  type CodexForkSidePanelPendingPromotionInput,
  type CodexForkSidePanelTargetConsumeInput,
  type CodexForkSidePanelTransferRuntimeService,
} from "./CodexForkSidePanelTransferRuntime";

export interface CodexForkSidePanelTransferRuntimePromiseAdapter<
  Snapshot = CodexForkBrowserSidePanelSnapshot,
> {
  readonly stageDirect: (input: CodexForkSidePanelDirectStageInput) => Promise<void>;
  readonly capturePending: (input: CodexForkSidePanelPendingCaptureInput) => Promise<void>;
  readonly promotePending: (input: CodexForkSidePanelPendingPromotionInput) => Promise<boolean>;
  readonly discardPending: (pendingWorktreeId: string) => Promise<void>;
  readonly consumeTarget: (input: CodexForkSidePanelTargetConsumeInput) => Promise<Snapshot | null>;
}

export const makeCodexForkSidePanelTransferRuntimePromiseAdapter = <Snapshot>(
  runtime: CodexForkSidePanelTransferRuntimeService<Snapshot>,
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexForkSidePanelTransferRuntimePromiseAdapter<Snapshot> => {
  const run = <Value>(
    effect: Effect.Effect<Value, CodexForkSidePanelTransferError>,
  ): Promise<Value> =>
    callbacks.runPromise(effect).catch((error: unknown) => {
      if (error instanceof CodexForkSidePanelTransferError) throw error.cause;
      throw error;
    });

  return {
    stageDirect: (input) => run(runtime.stageDirect(input)),
    capturePending: (input) => run(runtime.capturePending(input)),
    promotePending: (input) => run(runtime.promotePending(input)),
    discardPending: (pendingWorktreeId) => run(runtime.discardPending(pendingWorktreeId)),
    consumeTarget: (input) => run(runtime.consumeTarget(input)),
  };
};
