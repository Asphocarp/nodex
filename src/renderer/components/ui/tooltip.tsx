import * as RadixTooltip from "@radix-ui/react-tooltip";
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  type ReactNode,
  type RefObject,
} from "react";
import { APP_SHELL_FLOATING_UI_LAYER_CLASS } from "@/lib/app-shell-layers";
import { cn } from "@/lib/utils";
import {
  dismissNodexFloatingSurfaces,
  makeNodexFloatingSurfaceBoundaryStyle,
  NODEX_FLOATING_SURFACE_DISMISS_EVENT,
  nodexFloatingSurfaceBoundaryStyle,
  nodexFloatingSurfaceClassName,
  NodexFloatingSurfaceBody,
  useNodexFloatingSurfaceGlobalDismissal,
} from "./floating-surface";

export function dismissNodexTooltips() {
  dismissNodexFloatingSurfaces();
}

export type NodexTooltipProviderProps = ComponentPropsWithoutRef<typeof RadixTooltip.Provider>;

export function NodexTooltipProvider({
  children,
  delayDuration = 0,
  ...props
}: NodexTooltipProviderProps) {
  useNodexFloatingSurfaceGlobalDismissal();

  return (
    <RadixTooltip.Provider delayDuration={delayDuration} {...props}>
      {children}
    </RadixTooltip.Provider>
  );
}

export interface NodexTooltipProps
  extends Omit<ComponentPropsWithoutRef<typeof RadixTooltip.Content>, "content">,
  Pick<
    ComponentPropsWithoutRef<typeof RadixTooltip.Root>,
    "open" | "defaultOpen" | "onOpenChange" | "delayDuration"
  > {
  children: ReactNode;
  tooltipContent: ReactNode;
  shortcut?: ReactNode;
  disabled?: boolean;
  triggerAsChild?: boolean;
  triggerRef?: RefObject<HTMLElement | null>;
  delayOpen?: boolean;
  hoverable?: boolean;
  surface?: "default" | "rich";
  tooltipClassName?: string;
  tooltipBodyClassName?: string;
}

export function NodexTooltip({
  children,
  tooltipContent,
  shortcut,
  disabled = false,
  triggerAsChild = true,
  triggerRef,
  delayOpen,
  hoverable = false,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
  surface = "default",
  tooltipClassName,
  tooltipBodyClassName,
  align,
  side = "bottom",
  sideOffset = 2,
  style,
  ...props
}: NodexTooltipProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleDismiss = () => {
      const isOpen = isControlled ? open : uncontrolledOpen;

      if (!isControlled) setUncontrolledOpen(false);
      if (isOpen) {
        onOpenChange?.(false);
      }
    };

    window.addEventListener(
      NODEX_FLOATING_SURFACE_DISMISS_EVENT,
      handleDismiss,
    );
    return () => {
      window.removeEventListener(
        NODEX_FLOATING_SURFACE_DISMISS_EVENT,
        handleDismiss,
      );
    };
  }, [isControlled, onOpenChange, open, uncontrolledOpen]);

  if (disabled || tooltipContent == null) return <>{children}</>;

  const resolvedOpen = isControlled ? open : uncontrolledOpen;
  const resolvedDelay = delayOpen ? 250 : delayDuration;
  const richSurface = surface === "rich";

  return (
    <RadixTooltip.Root
      open={resolvedOpen}
      defaultOpen={defaultOpen}
      onOpenChange={(nextOpen) => {
        if (!isControlled) setUncontrolledOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
      delayDuration={resolvedDelay}
      disableHoverableContent={!hoverable}
    >
      <RadixTooltip.Trigger
        asChild={triggerAsChild}
        ref={
          triggerRef as ComponentPropsWithRef<typeof RadixTooltip.Trigger>["ref"]
        }
      >
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          ref={contentRef}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(
            richSurface
              ? nodexFloatingSurfaceClassName
              : "bg-token-dropdown-background text-token-foreground border-token-border w-fit select-none rounded-lg border px-2 py-1 text-sm whitespace-normal break-words",
            !richSurface && APP_SHELL_FLOATING_UI_LAYER_CLASS,
            tooltipClassName,
          )}
          style={{
            ...(richSurface
              ? {
                  ...nodexFloatingSurfaceBoundaryStyle,
                  ...makeNodexFloatingSurfaceBoundaryStyle(
                    "var(--radix-tooltip-content-available-width)",
                    "var(--radix-tooltip-content-available-height)",
                  ),
                }
              : {
                  maxWidth:
                    "min(20rem, var(--radix-tooltip-content-available-width), calc(100vw - 16px))",
                  maxHeight:
                    "min(var(--radix-tooltip-content-available-height), calc(100vh - 16px))",
                }),
            ...style,
          }}
          {...props}
        >
          {richSurface ? (
            <NodexFloatingSurfaceBody
              className={tooltipBodyClassName}
              shortcut={shortcut}
            >
              {tooltipContent}
            </NodexFloatingSurfaceBody>
          ) : (
            <div className="flex items-center gap-2">
              <div className={cn("min-w-0", tooltipBodyClassName)}>
                {tooltipContent}
              </div>
              {shortcut ? <span>{shortcut}</span> : null}
            </div>
          )}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
