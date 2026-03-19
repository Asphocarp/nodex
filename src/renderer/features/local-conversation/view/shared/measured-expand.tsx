import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../../../lib/utils";

interface MeasuredExpandProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}

const TRANSITION_STYLE = "height 180ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms cubic-bezier(0.2, 0, 0, 1)";

export function MeasuredExpand({
  open,
  children,
  className,
  innerClassName,
}: MeasuredExpandProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousOpenRef = useRef(open);
  const [height, setHeight] = useState<string>(open ? "auto" : "0px");
  const [opacity, setOpacity] = useState(open ? 1 : 0);
  const [isAnimating, setIsAnimating] = useState(false);

  useLayoutEffect(() => {
    const outerElement = outerRef.current;
    const innerElement = innerRef.current;
    if (!outerElement || !innerElement) return;

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;

    if (wasOpen === open) {
      if (open && height !== "auto") {
        setHeight("auto");
      }
      if (open) {
        setOpacity(1);
      } else {
        setHeight("0px");
        setOpacity(0);
      }
      setIsAnimating(false);
      return;
    }

    const nextHeight = innerElement.getBoundingClientRect().height;

    if (open) {
      setOpacity(1);
      if (Math.abs(nextHeight) < 1) {
        setHeight("auto");
        setIsAnimating(false);
        return;
      }
      setHeight("0px");
      setIsAnimating(true);
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setHeight(`${nextHeight}px`);
      });
      return;
    }

    const currentHeight = outerElement.getBoundingClientRect().height || nextHeight;
    if (Math.abs(currentHeight) < 1) {
      setHeight("0px");
      setOpacity(0);
      setIsAnimating(false);
      return;
    }

    setHeight(`${currentHeight}px`);
    setOpacity(1);
    setIsAnimating(true);
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setHeight("0px");
      setOpacity(0);
    });

    return () => {
      if (animationFrameRef.current === null) return;
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [height, open]);

  return (
    <div
      ref={outerRef}
      className={cn(open ? "overflow-visible" : "overflow-hidden", className)}
      data-thread-find-skip={open ? undefined : true}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (open) {
          setHeight("auto");
          setOpacity(1);
        } else {
          setHeight("0px");
          setOpacity(0);
        }
        setIsAnimating(false);
      }}
      style={{
        height,
        opacity,
        pointerEvents: open ? "auto" : "none",
        overflow: open && !isAnimating && height === "auto" ? "visible" : "hidden",
        transition: TRANSITION_STYLE,
      }}
    >
      <div ref={innerRef} className={innerClassName}>
        {children}
      </div>
    </div>
  );
}
