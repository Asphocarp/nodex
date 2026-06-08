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

function dismissNodexTooltipsOnHiddenDocument() {
  if (typeof document === "undefined") return;
  if (document.visibilityState !== "hidden") return;
  dismissNodexTooltips();
}

export type NodexTooltipProviderProps = ComponentPropsWithoutRef<typeof RadixTooltip.Provider>;

export function NodexTooltipProvider({
  delayDuration = 0,
  ...props
}: NodexTooltipProviderProps) {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (typeof document === "undefined") return undefined;

    window.addEventListener("blur", dismissNodexTooltips);
    window.addEventListener("pagehide", dismissNodexTooltips);
    document.addEventListener("visibilitychange", dismissNodexTooltipsOnHiddenDocument);

    return () => {
      window.removeEventListener("blur", dismissNodexTooltips);
      window.removeEventListener("pagehide", dismissNodexTooltips);
      document.removeEventListener("visibilitychange", dismissNodexTooltipsOnHiddenDocument);
    };
  }, []);

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
  const [dismissVersion, setDismissVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleDismiss = () => {
      const isOpen = isControlled ? open : uncontrolledOpen;

      setDismissVersion((version) => version + 1);

      if (!isControlled) setUncontrolledOpen(false);
      if (isOpen) {
        onOpenChange?.(false);
      }
    };

    window.addEventListener(CODEX_TOOLTIP_DISMISS_EVENT, handleDismiss);
    return () => {
      window.removeEventListener(CODEX_TOOLTIP_DISMISS_EVENT, handleDismiss);
    };
  }, [isControlled, onOpenChange, open, uncontrolledOpen]);

  if (disabled || tooltipContent == null) return <>{children}</>;

  const resolvedOpen = isControlled ? open : uncontrolledOpen;
  const resolvedDelay = delayOpen ? 250 : delayDuration;

  return (
    <RadixTooltip.Root
      key={dismissVersion}
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
