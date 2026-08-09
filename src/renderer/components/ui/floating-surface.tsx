import {
  forwardRef,
  useEffect,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { APP_SHELL_FLOATING_UI_LAYER_CLASS } from "@/lib/app-shell-layers";
import { cn } from "@/lib/utils";

export const NODEX_FLOATING_SURFACE_DISMISS_EVENT = "codex:dismiss-tooltips";

export const NODEX_FLOATING_SURFACE_AVAILABLE_WIDTH =
  "--nodex-floating-surface-available-width";
export const NODEX_FLOATING_SURFACE_AVAILABLE_HEIGHT =
  "--nodex-floating-surface-available-height";

type FloatingSurfaceBoundaryStyle = CSSProperties & {
  [NODEX_FLOATING_SURFACE_AVAILABLE_WIDTH]?: string;
  [NODEX_FLOATING_SURFACE_AVAILABLE_HEIGHT]?: string;
};

export function dismissNodexFloatingSurfaces(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NODEX_FLOATING_SURFACE_DISMISS_EVENT));
}

let globalDismissalLeaseCount = 0;

function dismissNodexFloatingSurfacesOnHiddenDocument(): void {
  if (document.visibilityState !== "hidden") return;
  dismissNodexFloatingSurfaces();
}

/**
 * Gives a floating-surface provider a shared lease on the document lifecycle
 * listeners. Tooltip and HoverCard providers remain independently usable,
 * while nested app providers install only one listener set.
 */
export function useNodexFloatingSurfaceGlobalDismissal(): void {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (typeof document === "undefined") return undefined;

    globalDismissalLeaseCount += 1;
    if (globalDismissalLeaseCount === 1) {
      window.addEventListener("blur", dismissNodexFloatingSurfaces);
      window.addEventListener("pagehide", dismissNodexFloatingSurfaces);
      document.addEventListener(
        "visibilitychange",
        dismissNodexFloatingSurfacesOnHiddenDocument,
      );
    }

    return () => {
      globalDismissalLeaseCount -= 1;
      if (globalDismissalLeaseCount > 0) return;

      globalDismissalLeaseCount = 0;
      window.removeEventListener("blur", dismissNodexFloatingSurfaces);
      window.removeEventListener("pagehide", dismissNodexFloatingSurfaces);
      document.removeEventListener(
        "visibilitychange",
        dismissNodexFloatingSurfacesOnHiddenDocument,
      );
    };
  }, []);
}

export function makeNodexFloatingSurfaceBoundaryStyle(
  availableWidth: string,
  availableHeight: string,
): FloatingSurfaceBoundaryStyle {
  return {
    [NODEX_FLOATING_SURFACE_AVAILABLE_WIDTH]: availableWidth,
    [NODEX_FLOATING_SURFACE_AVAILABLE_HEIGHT]: availableHeight,
  };
}

export const nodexFloatingSurfaceClassName = cn(
  "no-drag m-px flex w-fit select-none flex-col rounded-xl bg-token-dropdown-background/90 text-sm text-token-foreground shadow-xl-spread ring-[0.5px] ring-token-border backdrop-blur-sm whitespace-normal break-words",
  APP_SHELL_FLOATING_UI_LAYER_CLASS,
);

export const nodexFloatingSurfaceBoundaryStyle: FloatingSurfaceBoundaryStyle = {
  maxWidth:
    "min(20rem, var(--nodex-floating-surface-available-width, calc(100vw - 16px)), calc(100vw - 16px))",
  maxHeight:
    "min(var(--nodex-floating-surface-available-height, calc(100vh - 16px)), calc(100vh - 16px))",
};

export const NodexFloatingSurface = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function NodexFloatingSurface({ className, style, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(nodexFloatingSurfaceClassName, className)}
      style={{ ...nodexFloatingSurfaceBoundaryStyle, ...style }}
      {...props}
    />
  );
});

export function NodexFloatingSurfaceBody({
  children,
  className,
  shortcut,
}: {
  children: ReactNode;
  className?: string;
  shortcut?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center gap-2">
      <div className={cn("flex min-h-0 min-w-0 w-full", className)}>
        {children}
      </div>
      {shortcut ? <span>{shortcut}</span> : null}
    </div>
  );
}
