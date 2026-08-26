import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useRender } from "@base-ui/react/use-render";
import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useRef,
  useState,
  isValidElement,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { APP_SHELL_FLOATING_UI_LAYER_CLASS } from "@/lib/app-shell-layers";
import { cn } from "@/lib/utils";
import { NodexFloatingLayerProvider, useNodexFloatingLayerIndex } from "./floating-layer";

const NODEX_POPOVER_BOUNDARY_STYLE: CSSProperties = {
  maxWidth: "min(var(--available-width), calc(100vw - 16px))",
  maxHeight: "min(var(--available-height), calc(100vh - 16px))",
};

interface NodexPopoverAnchorContextValue {
  anchor: HTMLElement | null;
  setAnchor: (anchor: HTMLElement | null) => void;
}

const NodexPopoverAnchorContext = createContext<NodexPopoverAnchorContextValue | null>(null);

export interface NodexPopoverProps {
  children?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  modal?: boolean | "trap-focus";
  onOpenChange?: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
}

export function NodexPopover({ onOpenChange, ...props }: NodexPopoverProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const anchorContext = useMemo(() => ({ anchor, setAnchor }), [anchor]);

  return (
    <NodexPopoverAnchorContext value={anchorContext}>
      <PopoverPrimitive.Root
        {...props}
        onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined}
      />
    </NodexPopoverAnchorContext>
  );
}

export interface NodexPopoverTriggerProps extends Omit<
  PopoverPrimitive.Trigger.Props,
  "render" | "children"
> {
  children: ReactNode;
}

/** Composes the trigger contract into one concrete interactive child. */
export function NodexPopoverTrigger({ children, ...props }: NodexPopoverTriggerProps) {
  if (!isValidElement(children)) {
    throw new Error("NodexPopoverTrigger requires one concrete interactive child");
  }
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" render={children} {...props} />;
}

export interface NodexPopoverAnchorProps extends Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> {
  children: ReactElement;
}

/** Registers a passive positioning anchor without making it an interactive trigger. */
export const NodexPopoverAnchor = forwardRef<HTMLElement, NodexPopoverAnchorProps>(
  function NodexPopoverAnchor({ children, ...props }, forwardedRef) {
    const context = useContext(NodexPopoverAnchorContext);
    if (!context) {
      throw new Error("NodexPopoverAnchor must be rendered inside NodexPopover");
    }

    return useRender({
      defaultTagName: "span",
      render: children,
      ref: [forwardedRef, context.setAnchor],
      props: { "data-slot": "popover-anchor", ...props },
    });
  },
);

export function NodexPopoverPortal(props: PopoverPrimitive.Portal.Props) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />;
}

export interface NodexPopoverContentProps
  extends
    Omit<PopoverPrimitive.Popup.Props, "className" | "style">,
    Pick<
      PopoverPrimitive.Positioner.Props,
      | "align"
      | "alignOffset"
      | "side"
      | "sideOffset"
      | "collisionBoundary"
      | "collisionPadding"
      | "collisionAvoidance"
      | "positionMethod"
      | "sticky"
    > {
  className?: string;
  portalled?: boolean;
  portalContainer?: HTMLElement | null;
  style?: CSSProperties;
}

export const NodexPopoverContent = forwardRef<HTMLDivElement, NodexPopoverContentProps>(
  function NodexPopoverContent(
    {
      children,
      className,
      align = "start",
      alignOffset,
      side = "bottom",
      sideOffset = 4,
      style,
      collisionBoundary,
      collisionPadding = 6,
      collisionAvoidance,
      positionMethod,
      sticky,
      portalled = true,
      portalContainer,
      ...props
    },
    ref,
  ) {
    const anchorContext = useContext(NodexPopoverAnchorContext);
    const inlinePortalRef = useRef<HTMLDivElement>(null);
    const layerIndex = useNodexFloatingLayerIndex(style?.zIndex);
    const positionedPopup = (
      <PopoverPrimitive.Positioner
        data-slot="popover-positioner"
        anchor={anchorContext?.anchor ?? undefined}
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        collisionAvoidance={collisionAvoidance}
        positionMethod={positionMethod}
        sticky={sticky}
        className={APP_SHELL_FLOATING_UI_LAYER_CLASS}
        style={{ zIndex: layerIndex }}
      >
        <PopoverPrimitive.Popup
          ref={ref}
          data-slot="popover-content"
          className={cn(
            "no-drag bg-token-dropdown-background/90 text-token-foreground ring-token-border flex w-72 origin-(--transform-origin) flex-col overflow-y-auto rounded-xl px-1 py-1 shadow-lg ring-[0.5px] backdrop-blur-sm outline-hidden",
            className,
          )}
          style={{ ...NODEX_POPOVER_BOUNDARY_STYLE, zIndex: layerIndex, ...style }}
          {...props}
          data-nodex-keyboard-scope="local"
        >
          <NodexFloatingLayerProvider zIndex={layerIndex}>{children}</NodexFloatingLayerProvider>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    );

    if (!portalled) {
      return (
        <>
          <div ref={inlinePortalRef} data-slot="popover-inline-portal" />
          <NodexPopoverPortal container={inlinePortalRef}>{positionedPopup}</NodexPopoverPortal>
        </>
      );
    }

    return (
      <NodexPopoverPortal container={portalContainer ?? undefined}>
        {positionedPopup}
      </NodexPopoverPortal>
    );
  },
);

export function NodexPopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  );
}
