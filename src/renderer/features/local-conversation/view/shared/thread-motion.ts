import type { TargetAndTransition, Transition } from "motion/react";

export const CODEX_THREAD_ACCORDION_TRANSITION: Transition = {
  duration: 0.45,
  ease: [0.4, 0, 0.1, 1],
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

export const CODEX_THREAD_MICRO_SCALE_FADE_INITIAL: TargetAndTransition = {
  opacity: 0,
  scale: 0.9,
};

export const CODEX_THREAD_MICRO_SCALE_FADE_ANIMATE: TargetAndTransition = {
  opacity: 1,
  scale: 1,
};

export const CODEX_THREAD_MICRO_SCALE_FADE_EXIT: TargetAndTransition = {
  opacity: 0,
  scale: 0.9,
};

export const CODEX_THREAD_MICRO_SCALE_FADE_TRANSITION: Transition = {
  duration: 0.15,
  ease: "easeOut",
};
