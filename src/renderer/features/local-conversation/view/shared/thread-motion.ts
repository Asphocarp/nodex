import type { TargetAndTransition, Transition } from "motion/react";

export const CODEX_THREAD_ACCORDION_TRANSITION: Transition = {
  duration: 0.5,
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
