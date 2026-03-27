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
import { cn } from "@/lib/utils";

const CODEX_TOOLTIP_DISMISS_EVENT = "codex:dismiss-tooltips";

export function dismissNodexTooltips() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CODEX_TOOLTIP_DISMISS_EVENT));
}

export type NodexTooltipProviderProps = ComponentPropsWithoutRef<typeof RadixTooltip.Provider>;

export function NodexTooltipProvider({
  delayDuration = 0,
  ...props
}: NodexTooltipProviderProps) {
  return <RadixTooltip.Provider delayDuration={delayDuration} {...props} />;
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
  interactive?: boolean;
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
  interactive = false,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
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
      if (isControlled) {
        onOpenChange?.(false);
        return;
      }
      setUncontrolledOpen(false);
    };

    window.addEventListener(CODEX_TOOLTIP_DISMISS_EVENT, handleDismiss);
    return () => {
      window.removeEventListener(CODEX_TOOLTIP_DISMISS_EVENT, handleDismiss);
    };
  }, [isControlled, onOpenChange]);

  if (disabled || tooltipContent == null) return <>{children}</>;

  const resolvedOpen = isControlled ? open : uncontrolledOpen;
  const resolvedDelay = delayOpen ? 250 : delayDuration;

  return (
    <RadixTooltip.Root
      open={resolvedOpen}
      defaultOpen={defaultOpen}
      onOpenChange={(nextOpen) => {
        if (!isControlled) setUncontrolledOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
      delayDuration={resolvedDelay}
      disableHoverableContent={!interactive}
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
            "bg-token-dropdown-background text-token-foreground border-token-border z-50 w-fit select-none rounded-lg border px-2 py-1 text-sm whitespace-normal break-words",
            tooltipClassName,
          )}
          style={{
            maxWidth: "min(20rem, var(--radix-tooltip-content-available-width), calc(100vw - 16px))",
            maxHeight: "min(var(--radix-tooltip-content-available-height), calc(100vh - 16px))",
            ...style,
          }}
          {...props}
        >
          <div className="flex items-center gap-2">
            <div className={cn("min-w-0", tooltipBodyClassName)}>{tooltipContent}</div>
            {shortcut ? <span>{shortcut}</span> : null}
          </div>
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
