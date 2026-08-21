import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cn } from "../../../../lib/utils";

export const CODEX_SHIMMER_CADENCE_MS = {
  initialDelay: 600,
  activeDuration: 1_000,
  interval: 4_000,
} as const;

export const CODEX_SHIMMER_VARIANT = "cadenced" as const;

type CodexShimmerVariant = "classic" | "cadenced";

const CodexShimmerEnabledContext = createContext(true);

export function CodexShimmerProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  return (
    <CodexShimmerEnabledContext.Provider value={enabled}>
      {children}
    </CodexShimmerEnabledContext.Provider>
  );
}

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
  const contextEnabled = useContext(CodexShimmerEnabledContext);
  const ref = useRef<HTMLSpanElement | null>(null);
  const effectiveActive = active && contextEnabled;
  const useCadenced = effectiveActive && variant === "cadenced";

  useEffect(() => {
    if (!useCadenced) return;
    if (prefersReducedMotion()) return;

    const element = ref.current;
    if (!element) return;

    let clearActiveTimeout: number | undefined;
    let interval: number | undefined;
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
      interval = window.setInterval(run, CODEX_SHIMMER_CADENCE_MS.interval);
    }, CODEX_SHIMMER_CADENCE_MS.initialDelay);

    return () => {
      clearActive();
      window.clearTimeout(initialTimeout);
      if (interval !== undefined) window.clearInterval(interval);
      element.classList.remove("codex-cadenced-shimmer-active");
    };
  }, [useCadenced]);

  if (!effectiveActive) {
    return (
      <span className={className} data-codex-shimmer="static" {...props}>
        {children}
      </span>
    );
  }

  return (
    <span
      ref={useCadenced ? ref : undefined}
      className={cn(
        "loading-shimmer-pure-text",
        useCadenced && "codex-cadenced-shimmer",
        className,
      )}
      data-codex-shimmer={variant}
      {...props}
    >
      {children}
      {useCadenced ? (
        <span
          aria-hidden="true"
          className="codex-cadenced-shimmer-sweep"
          data-codex-shimmer-sweep="true"
        >
          <span className="codex-cadenced-shimmer-highlight">{children}</span>
        </span>
      ) : null}
    </span>
  );
}
