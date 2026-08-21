import { AnimatePresence, motion, type MotionValue, type Transition } from "motion/react";
import type { ReactNode } from "react";
import {
  ProjectSessionSidebar,
  type ProjectSessionSidebarProps,
} from "./workbench-session-sidebar";
import { cn } from "@/lib/utils";

type WorkbenchSidebarPlacementProp =
  | "animatedWidth"
  | "contentOpacity"
  | "floating"
  | "header"
  | "onHoverSurfaceOpenChange"
  | "onResizeActiveChange"
  | "resizeDisabled";

export type WorkbenchSidebarBodyProps = Omit<
  ProjectSessionSidebarProps,
  WorkbenchSidebarPlacementProp
>;

interface WorkbenchInlineSidebarPlacement {
  readonly visible: boolean;
  readonly animatedWidth: MotionValue<number>;
  readonly contentOpacity: MotionValue<number>;
  readonly resizeDisabled: boolean;
}

interface WorkbenchFloatingSidebarPlacement {
  readonly visible: boolean;
  readonly header: ReactNode;
  readonly outerClassName: string;
  readonly resizing: boolean;
  readonly reducedMotion: boolean;
  readonly exitX: number;
  readonly transition: Transition;
  readonly onResizeActiveChange: (active: boolean) => void;
  readonly onHoverSurfaceOpenChange: (open: boolean) => void;
}

interface WorkbenchSidebarProps {
  readonly body: WorkbenchSidebarBodyProps;
  readonly inline: WorkbenchInlineSidebarPlacement;
  readonly floating: WorkbenchFloatingSidebarPlacement;
}

/**
 * Owns the two chrome placements for one logical sidebar body. Placement can
 * change without duplicating the catalog/selection/command Interface.
 */
export function WorkbenchSidebar({ body, inline, floating }: WorkbenchSidebarProps) {
  return (
    <>
      {inline.visible ? (
        <ProjectSessionSidebar
          {...body}
          animatedWidth={inline.animatedWidth}
          contentOpacity={inline.contentOpacity}
          resizeDisabled={inline.resizeDisabled}
        />
      ) : null}

      <AnimatePresence initial={false}>
        {floating.visible ? (
          <motion.div
            key="codex-floating-left-panel"
            data-sidebar-floating-focus-area="true"
            data-testid="floating-project-session-sidebar-shell"
            className={cn(floating.outerClassName, floating.resizing && "cursor-col-resize")}
            style={{ width: body.width }}
            initial={floating.reducedMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: floating.exitX }}
            transition={floating.transition}
          >
            <ProjectSessionSidebar
              {...body}
              floating
              header={floating.header}
              onResizeActiveChange={floating.onResizeActiveChange}
              onHoverSurfaceOpenChange={floating.onHoverSurfaceOpenChange}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
