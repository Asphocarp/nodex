import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../../../lib/utils";

export const CODEX_SHIMMER_CADENCE_MS = {
  initialDelay: 600,
  activeDuration: 1_000,
  interval: 4_000,
} as const;

export const CODEX_SHIMMER_VARIANT = "classic" as const;

type CodexShimmerVariant = "classic" | "cadenced";

interface CodexShimmerTextProps extends ComponentPropsWithoutRef<"span"> {
  active?: boolean;
  variant?: CodexShimmerVariant;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function CodexShimmerText({
  active = true,
  className,
  children,
  variant = CODEX_SHIMMER_VARIANT,
  ...props
}: CodexShimmerTextProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const useCadenced = active && variant === "cadenced";

  useEffect(() => {
    if (!useCadenced) return;
    if (prefersReducedMotion()) return;

    const element = ref.current;
    if (!element) return;

    let clearActiveTimeout: number | undefined;
    const clearActive = () => {
      if (clearActiveTimeout === undefined) return;
      window.clearTimeout(clearActiveTimeout);
      clearActiveTimeout = undefined;
    };
    const run = () => {
      clearActive();
      element.classList.remove("codex-cadenced-shimmer-active");
      element.classList.add("codex-cadenced-shimmer-active");
      clearActiveTimeout = window.setTimeout(() => {
        element.classList.remove("codex-cadenced-shimmer-active");
        clearActiveTimeout = undefined;
      }, CODEX_SHIMMER_CADENCE_MS.activeDuration);
    };

    const initialTimeout = window.setTimeout(() => {
      run();
      const interval = window.setInterval(run, CODEX_SHIMMER_CADENCE_MS.interval);
      element.dataset.codexCadencedInterval = String(interval);
    }, CODEX_SHIMMER_CADENCE_MS.initialDelay);

    return () => {
      clearActive();
      window.clearTimeout(initialTimeout);
      const interval = Number(element.dataset.codexCadencedInterval);
      if (Number.isFinite(interval)) window.clearInterval(interval);
      delete element.dataset.codexCadencedInterval;
      element.classList.remove("codex-cadenced-shimmer-active");
    };
  }, [useCadenced]);

  if (!active) {
    return (
      <span className={className} {...props}>
        {children}
      </span>
    );
  }

  return (
    <span
      ref={useCadenced ? ref : undefined}
      className={cn("loading-shimmer-pure-text", useCadenced && "codex-cadenced-shimmer", className)}
      {...props}
    >
      {children}
      {useCadenced ? (
        <span aria-hidden="true" className="codex-cadenced-shimmer-sweep">
          <span className="codex-cadenced-shimmer-highlight">{children}</span>
        </span>
      ) : null}
    </span>
  );
}
