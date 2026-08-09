import * as PopoverPrimitive from "@radix-ui/react-popover";
import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { APP_SHELL_FLOATING_UI_LAYER_CLASS } from "@/lib/app-shell-layers";
import { cn } from "@/lib/utils";

const CODEX_POPOVER_BOUNDARY_STYLE: CSSProperties = {
  maxWidth: "min(var(--radix-popover-content-available-width), calc(100vw - 16px))",
  maxHeight: "min(var(--radix-popover-content-available-height), calc(100vh - 16px))",
};

export function NodexPopover(props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function NodexPopoverTrigger(
  props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>,
) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function NodexPopoverAnchor(
  props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Anchor>,
) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export function NodexPopoverPortal(
  props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Portal>,
) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />;
}

export interface NodexPopoverContentProps
  extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
  portalled?: boolean;
  portalContainer?: HTMLElement | null;
}

export const NodexPopoverContent = forwardRef<
  HTMLDivElement,
  NodexPopoverContentProps
>(function NodexPopoverContent(
  {
    className,
    align = "start",
    sideOffset = 4,
    style,
    collisionPadding = 6,
    portalled = true,
    portalContainer,
    ...props
  },
  ref,
) {
  const content = (
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        "no-drag bg-token-dropdown-background/90 text-token-foreground ring-token-border flex w-72 origin-[var(--radix-popover-content-transform-origin)] flex-col overflow-y-auto rounded-xl px-1 py-1 shadow-lg ring-[0.5px] backdrop-blur-sm outline-hidden",
        APP_SHELL_FLOATING_UI_LAYER_CLASS,
        className,
      )}
      style={{ ...CODEX_POPOVER_BOUNDARY_STYLE, ...style }}
      {...props}
      data-nodex-keyboard-scope="local"
    />
  );

  if (!portalled) return content;

  return (
    <NodexPopoverPortal container={portalContainer ?? undefined}>
      {content}
    </NodexPopoverPortal>
  );
});

export function NodexPopoverTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  );
}
