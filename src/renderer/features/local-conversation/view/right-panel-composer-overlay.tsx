import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "motion/react";
import {
  RIGHT_PANEL_COMPOSER_OVERLAY_DURATION_MS,
  RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_PX,
  RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_VAR,
  RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX,
  RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR,
  RIGHT_PANEL_COMPOSER_OVERLAY_TIMER_STEP_MS,
  resolveRightPanelComposerOverlayReservePx,
  type RightPanelComposerOverlayReserveDirection,
} from "@/lib/right-panel-composer-overlay-reserve";
import { APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS } from "@/lib/app-shell-layers";
import { cn } from "@/lib/utils";

export type RightPanelComposerOverlayPhase =
  | "hidden"
  | "entering"
  | "visible"
  | "exiting";

interface RightPanelComposerOverlayProps {
  target: HTMLElement | null;
  visible: boolean;
  children: ReactNode;
  onPointerDownOutside?: () => void;
}

function writeRightPanelComposerOverlayVars(target: HTMLElement, reservePx: number) {
  target.style.setProperty(
    RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_VAR,
    `${RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_PX}px`,
  );
  target.style.setProperty(
    RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR,
    `${reservePx}px`,
  );
}

function removeRightPanelComposerOverlayVars(target: HTMLElement) {
  target.style.removeProperty(RIGHT_PANEL_COMPOSER_OVERLAY_HEIGHT_VAR);
  target.style.removeProperty(RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_VAR);
}

function clearReserveTimer(timerRef: React.MutableRefObject<number | null>) {
  if (timerRef.current === null) return;
  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}

const RIGHT_PANEL_COMPOSER_OVERLAY_STYLE: CSSProperties = {
  bottom: "var(--app-shell-bottom-panel-height, 0px)",
  transform:
    "translateY(calc(118px - var(--right-panel-composer-overlay-reserve, 0px)))",
};

function getInitialPhase(visible: boolean): RightPanelComposerOverlayPhase {
  return visible ? "entering" : "hidden";
}

export function RightPanelComposerOverlay({
  target,
  visible,
  children,
  onPointerDownOutside,
}: RightPanelComposerOverlayProps) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<RightPanelComposerOverlayPhase>(() =>
    getInitialPhase(visible)
  );
  const interactiveRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<RightPanelComposerOverlayPhase>(phase);
  const reservePxRef = useRef(visible ? RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX : 0);
  const reserveTimerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  phaseRef.current = phase;

  const snapReserve = useEffectEvent((nextReservePx: number) => {
    clearReserveTimer(reserveTimerRef);
    reservePxRef.current = nextReservePx;
    if (targetRef.current) {
      writeRightPanelComposerOverlayVars(targetRef.current, nextReservePx);
    }
  });

  const animateReserve = useEffectEvent(({
    direction,
    fromPx,
    toPx,
  }: {
    direction: RightPanelComposerOverlayReserveDirection;
    fromPx: number;
    toPx: number;
  }) => {
    clearReserveTimer(reserveTimerRef);

    const startedAt = performance.now();
    let fallbackElapsedMs = 0;
    const tick = () => {
      const elapsedMs = Math.max(performance.now() - startedAt, fallbackElapsedMs);
      const nextReservePx = resolveRightPanelComposerOverlayReservePx({
        direction,
        elapsedMs,
        fromPx,
        toPx,
      });

      reservePxRef.current = nextReservePx;
      if (targetRef.current) {
        writeRightPanelComposerOverlayVars(targetRef.current, nextReservePx);
      }

      if (elapsedMs >= RIGHT_PANEL_COMPOSER_OVERLAY_DURATION_MS) {
        reserveTimerRef.current = null;
        reservePxRef.current = toPx;
        if (targetRef.current) {
          writeRightPanelComposerOverlayVars(targetRef.current, toPx);
        }
        if (direction === "enter" && phaseRef.current === "entering") {
          setPhase("visible");
        }
        if (direction === "exit" && phaseRef.current === "exiting") {
          if (targetRef.current) {
            removeRightPanelComposerOverlayVars(targetRef.current);
          }
          setPhase("hidden");
        }
        return;
      }

      fallbackElapsedMs = Math.min(
        RIGHT_PANEL_COMPOSER_OVERLAY_DURATION_MS,
        fallbackElapsedMs + RIGHT_PANEL_COMPOSER_OVERLAY_TIMER_STEP_MS,
      );
      reserveTimerRef.current = window.setTimeout(
        tick,
        RIGHT_PANEL_COMPOSER_OVERLAY_TIMER_STEP_MS,
      );
    };

    tick();
  });

  const handleDocumentPointerDown = useEffectEvent((event: PointerEvent) => {
    if (phase !== "visible" || !onPointerDownOutside) return;

    const eventTarget = event.target;
    if (!(eventTarget instanceof Node)) return;
    if (interactiveRef.current?.contains(eventTarget)) return;

    onPointerDownOutside();
  });

  useLayoutEffect(() => {
    const previousTarget = targetRef.current;
    if (previousTarget && previousTarget !== target) {
      removeRightPanelComposerOverlayVars(previousTarget);
    }

    targetRef.current = target;
    if (!target) return;

    if (phase === "hidden") {
      removeRightPanelComposerOverlayVars(target);
      return;
    }

    writeRightPanelComposerOverlayVars(target, reservePxRef.current);
  }, [phase, target]);

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        setPhase("visible");
        snapReserve(RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX);
        return;
      }

      setPhase("entering");
      animateReserve({
        direction: "enter",
        fromPx: reservePxRef.current,
        toPx: RIGHT_PANEL_COMPOSER_OVERLAY_RESERVE_PX,
      });
      return;
    }

    if (phaseRef.current === "hidden") {
      snapReserve(0);
      return;
    }

    if (reducedMotion) {
      setPhase("hidden");
      snapReserve(0);
      return;
    }

    setPhase("exiting");
    animateReserve({
      direction: "exit",
      fromPx: reservePxRef.current,
      toPx: 0,
    });
  }, [reducedMotion, visible]);

  useEffect(() => {
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearReserveTimer(reserveTimerRef);
      if (targetRef.current) {
        removeRightPanelComposerOverlayVars(targetRef.current);
      }
    };
  }, []);

  const handleAnimationEnd = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return;
    if (phaseRef.current !== "entering") return;

    setPhase("visible");
  };

  const handleTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return;
    if (event.propertyName !== "opacity") return;
    if (phaseRef.current !== "exiting") return;

    if (targetRef.current) {
      removeRightPanelComposerOverlayVars(targetRef.current);
    }
    setPhase("hidden");
  };

  if (phase === "hidden") return null;

  const overlay = (
    <div
      data-testid="right-panel-composer-overlay"
      aria-hidden={phase !== "visible"}
      className={cn(
        "pointer-events-none absolute inset-x-0 transition-opacity duration-[120ms] motion-reduce:transition-none",
        APP_SHELL_RIGHT_PANEL_COMPOSER_OVERLAY_LAYER_CLASS,
        phase === "entering" && "right-panel-composer-overlay-enter opacity-100",
        phase === "visible" && "opacity-100 ease-in",
        phase === "exiting" && "opacity-0 ease-out",
      )}
      style={RIGHT_PANEL_COMPOSER_OVERLAY_STYLE}
      onAnimationEnd={handleAnimationEnd}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="mx-auto w-full max-w-(--thread-content-max-width) px-toolbar pb-6">
        <div
          ref={interactiveRef}
          className={phase === "visible" ? "pointer-events-auto" : "pointer-events-none"}
        >
          {children}
        </div>
      </div>
    </div>
  );

  return target ? createPortal(overlay, target) : overlay;
}
