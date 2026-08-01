import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  RIGHT_PANEL_COMPOSER_ACCESSORY_FROSTED_SURFACE_CLASS,
  RIGHT_PANEL_COMPOSER_ACCESSORY_INLINE_INSET_CLASS,
} from "./right-panel-composer-presentation";

interface ComposerContextRailSlotProps {
  visible: boolean;
  children: ReactNode;
}

interface ComposerContextRailProps {
  children: ReactNode;
  className?: string;
}

export function ComposerContextRailSlot({
  visible,
  children,
}: ComposerContextRailSlotProps) {
  if (!visible) return null;

  return (
    <div
      data-composer-external-footer-slot="true"
      className="relative z-0 -mb-2"
    >
      {children}
    </div>
  );
}

export function ComposerContextRail({
  children,
  className,
}: ComposerContextRailProps) {
  return (
    <div
      data-composer-lower-status-row="true"
      data-composer-context-rail="true"
      className={cn(
        RIGHT_PANEL_COMPOSER_ACCESSORY_INLINE_INSET_CLASS,
        RIGHT_PANEL_COMPOSER_ACCESSORY_FROSTED_SURFACE_CLASS,
        "-mb-4.5 flex flex-nowrap items-center gap-2 overflow-hidden rounded-t-2xl border-x border-t border-token-border/80 px-2 pt-2 pb-[27px] select-none electron:relative electron:top-1 electron:px-1.5 electron:pt-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
