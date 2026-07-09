import { useCallback, useEffect, useRef, useState } from "react";
import {
  animate,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  CODEX_SHELL_PANEL_TRANSITION,
  clampCodexPanelProgress,
  resolveCodexAnimatedPanelSize,
} from "./codex-panel-motion";
import {
  isCodexSidebarExpandedMounted,
  resolveCodexSidebarToggleTargetProgress,
  shouldAnimateCodexSidebarToggle,
  shouldSuppressCodexSidebarHoverOpen,
} from "./codex-sidebar-auto-reveal";

export interface CodexSidebarMotionSetOpenOptions {
  animate?: boolean;
  suppressHoverOpen?: boolean;
}

export interface CodexSidebarMotionSetOpenResolution {
  targetProgress: 0 | 1;
  shouldAnimate: boolean;
  suppressHoverOpen: boolean;
}

export interface CodexSidebarMotionState {
  progress: MotionValue<number>;
  opacity: MotionValue<number>;
  animatedWidth: MotionValue<number>;
  targetWidth: MotionValue<number>;
  logicalOpen: boolean;
  mounted: boolean;
  animating: boolean;
  getOpen: () => boolean;
  setOpen: (
    nextOpen: boolean,
    options?: CodexSidebarMotionSetOpenOptions,
  ) => CodexSidebarMotionSetOpenResolution;
  setTargetWidth: (width: number) => void;
}

export function resolveCodexSidebarMotionMounted({
  logicalOpen,
  progress,
}: {
  logicalOpen: boolean;
  progress: number;
}): boolean {
  return isCodexSidebarExpandedMounted({ open: logicalOpen, progress });
}

export function resolveCodexSidebarMotionSetOpen({
  nextOpen,
  animate: animateLayout,
  reducedMotion,
  suppressHoverOpen,
}: {
  nextOpen: boolean;
  animate?: boolean;
  reducedMotion: boolean | null;
  suppressHoverOpen?: boolean;
}): CodexSidebarMotionSetOpenResolution {
  return {
    targetProgress: resolveCodexSidebarToggleTargetProgress(nextOpen),
    shouldAnimate: shouldAnimateCodexSidebarToggle({
      animate: animateLayout,
      reducedMotion,
    }),
    suppressHoverOpen: shouldSuppressCodexSidebarHoverOpen({
      nextOpen,
      suppressHoverOpen,
    }),
  };
}

export function shouldCommitCodexSidebarMotionCompletion({
  completionGeneration,
  currentGeneration,
}: {
  completionGeneration: number;
  currentGeneration: number;
}): boolean {
  return completionGeneration === currentGeneration;
}

export function useCodexSidebarMotionState({
  initialOpen,
  targetWidth,
  reducedMotion,
}: {
  initialOpen: boolean;
  targetWidth: number;
  reducedMotion: boolean | null;
}): CodexSidebarMotionState {
  const progress = useMotionValue(initialOpen ? 1 : 0);
  const targetWidthMotionValue = useMotionValue(targetWidth);
  const opacity = useTransform(progress, clampCodexPanelProgress);
  const animatedWidth = useTransform([progress, targetWidthMotionValue], ([latestProgress, latestTargetWidth]) =>
    resolveCodexAnimatedPanelSize(Number(latestProgress), Number(latestTargetWidth))
  );
  const [logicalOpen, setLogicalOpen] = useState(initialOpen);
  const [mounted, setMounted] = useState(initialOpen);
  const [animating, setAnimating] = useState(false);
  const logicalOpenRef = useRef(initialOpen);
  const mountedRef = useRef(initialOpen);
  const animatingRef = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const animationGenerationRef = useRef(0);

  const setLogicalOpenIfChanged = useCallback((nextOpen: boolean) => {
    if (logicalOpenRef.current === nextOpen) return;
    logicalOpenRef.current = nextOpen;
    setLogicalOpen(nextOpen);
  }, []);

  const setMountedIfChanged = useCallback((nextMounted: boolean) => {
    if (mountedRef.current === nextMounted) return;
    mountedRef.current = nextMounted;
    setMounted(nextMounted);
  }, []);

  const setAnimatingIfChanged = useCallback((nextAnimating: boolean) => {
    if (animatingRef.current === nextAnimating) return;
    animatingRef.current = nextAnimating;
    setAnimating(nextAnimating);
  }, []);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const setTargetWidth = useCallback((width: number) => {
    targetWidthMotionValue.set(width);
  }, [targetWidthMotionValue]);

  useEffect(() => {
    setTargetWidth(targetWidth);
  }, [setTargetWidth, targetWidth]);

  useMotionValueEvent(progress, "change", (latestProgress) => {
    setMountedIfChanged(resolveCodexSidebarMotionMounted({
      logicalOpen: logicalOpenRef.current,
      progress: latestProgress,
    }));
  });

  const getOpen = useCallback(() => logicalOpenRef.current, []);

  const setOpen = useCallback((
    nextOpen: boolean,
    options: CodexSidebarMotionSetOpenOptions = {},
  ): CodexSidebarMotionSetOpenResolution => {
    const resolution = resolveCodexSidebarMotionSetOpen({
      nextOpen,
      animate: options.animate,
      reducedMotion: reducedMotionRef.current,
      suppressHoverOpen: options.suppressHoverOpen,
    });
    const { targetProgress, shouldAnimate } = resolution;

    animationGenerationRef.current += 1;
    const generation = animationGenerationRef.current;
    animationRef.current?.stop();
    animationRef.current = null;

    setLogicalOpenIfChanged(nextOpen);

    const currentProgress = clampCodexPanelProgress(progress.get());
    if (nextOpen || currentProgress > 0) {
      setMountedIfChanged(true);
    }

    if (!shouldAnimate) {
      setAnimatingIfChanged(false);
      progress.set(targetProgress);
      setMountedIfChanged(resolveCodexSidebarMotionMounted({
        logicalOpen: nextOpen,
        progress: targetProgress,
      }));
      return resolution;
    }

    if (currentProgress === targetProgress) {
      setAnimatingIfChanged(false);
      setMountedIfChanged(resolveCodexSidebarMotionMounted({
        logicalOpen: nextOpen,
        progress: targetProgress,
      }));
      return resolution;
    }

    setAnimatingIfChanged(true);
    const controls = animate(progress, targetProgress, {
      ...CODEX_SHELL_PANEL_TRANSITION,
      onComplete: () => {
        if (!shouldCommitCodexSidebarMotionCompletion({
          completionGeneration: generation,
          currentGeneration: animationGenerationRef.current,
        })) return;

        animationRef.current = null;
        setAnimatingIfChanged(false);
        setMountedIfChanged(resolveCodexSidebarMotionMounted({
          logicalOpen: logicalOpenRef.current,
          progress: progress.get(),
        }));
      },
    });
    animationRef.current = controls;
    return resolution;
  }, [
    progress,
    setAnimatingIfChanged,
    setLogicalOpenIfChanged,
    setMountedIfChanged,
  ]);

  useEffect(() => () => {
    animationGenerationRef.current += 1;
    animationRef.current?.stop();
    animationRef.current = null;
  }, []);

  return {
    progress,
    opacity,
    animatedWidth,
    targetWidth: targetWidthMotionValue,
    logicalOpen,
    mounted,
    animating,
    getOpen,
    setOpen,
    setTargetWidth,
  };
}
