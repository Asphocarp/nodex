import type { ThreadFooterModel } from "../../thread-stage-types";

export function isInterruptedTurnResumeEligible(input: {
  readonly model: ThreadFooterModel;
  readonly hasResumeAction: boolean;
}): boolean {
  const { model, hasResumeAction } = input;
  if (!hasResumeAction || !model.conversation || model.isThreadRunning) return false;
  if (model.conversation.threadGoal) return false;
  return model.conversation.turns.at(-1)?.status === "interrupted";
}

export interface InterruptedTurnResumeGate {
  tryAcquire(eligible: boolean): (() => void) | null;
}

/** Owns the single-flight boundary for an interrupted-turn resume attempt. */
export function createInterruptedTurnResumeGate(): InterruptedTurnResumeGate {
  let inFlight = false;

  return {
    tryAcquire(eligible) {
      if (!eligible || inFlight) return null;
      inFlight = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight = false;
      };
    },
  };
}
