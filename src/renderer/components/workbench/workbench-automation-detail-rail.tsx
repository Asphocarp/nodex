import { motion, type MotionStyle, type MotionValue } from "motion/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { APP_SHELL_RIGHT_PANEL_LAYER_CLASS } from "@/lib/app-shell-layers";
import { cn } from "@/lib/utils";

export function WorkbenchAutomationDetailRail({
  mounted,
  width,
  onResizePointerDown,
  onPortalElementChange,
}: {
  readonly mounted: boolean;
  readonly width: MotionValue<number>;
  readonly onResizePointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  readonly onPortalElementChange: (element: HTMLDivElement | null) => void;
}) {
  if (!mounted) return null;

  return (
    <motion.aside
      data-app-shell-focus-area="right-panel"
      data-testid="automation-detail-rail"
      data-right-panel-width-mode="regular"
      className={cn(
        "relative ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible",
        APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
      )}
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize scheduled task details"
        className="group absolute top-0 bottom-0 left-0 z-40 flex w-4 -translate-x-2 cursor-col-resize touch-none select-none active:cursor-col-resize"
        onPointerDown={onResizePointerDown}
      >
        <div className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
      </div>

      <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
        <motion.div
          ref={onPortalElementChange}
          className="absolute top-0 bottom-0 left-0 min-w-0 border-l border-token-border bg-token-main-surface-primary"
          style={{
            width,
            minWidth: width,
            "--thread-content-top-inset": "calc(var(--spacing) * 8)",
          } as MotionStyle}
        />
      </div>
    </motion.aside>
  );
}
