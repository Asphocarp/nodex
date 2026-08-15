import type { TargetAndTransition, Transition } from "motion/react";

export const CODEX_THREAD_ACCORDION_TRANSITION: Transition = {
  duration: 0.3,
  ease: [0.19, 1, 0.22, 1],
};

export const CODEX_THREAD_DIVIDER_ENTER_INITIAL: TargetAndTransition = {
  opacity: 0,
  height: 0,
};

export const CODEX_THREAD_DIVIDER_ENTER_ANIMATE: TargetAndTransition = {
  opacity: 1,
  height: "auto",
};

export const CODEX_THREAD_DIVIDER_EXIT: TargetAndTransition = {
  opacity: 0,
  height: 0,
};

/**
 * Historical agent work enters as a complete layout block. Collapsing removes
 * it immediately, so this contract intentionally has no exit state.
 */
export function resolveCodexThreadWorkedForEnterMotion(reducedMotion: boolean) {
  return {
    initial: {
      opacity: 0,
      transform: reducedMotion ? "translateY(0)" : "translateY(-8px)",
    } satisfies TargetAndTransition,
    animate: {
      opacity: 1,
      transform: "translateY(0)",
    } satisfies TargetAndTransition,
    transition: {
      duration: reducedMotion ? 0.12 : 0.22,
      ease: [0.33, 1, 0.68, 1],
    } satisfies Transition,
  };
}
