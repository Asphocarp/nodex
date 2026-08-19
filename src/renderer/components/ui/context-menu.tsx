import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import {
  NodexFloatingLayerProvider,
  useNodexFloatingLayerIndex,
} from "./floating-layer";
import { nodexMenuSurfaceClassName } from "./menu-surface";

const CONTEXT_MENU_BOUNDARY_STYLE: CSSProperties = {
  maxWidth: "min(var(--radix-context-menu-content-available-width), calc(100vw - 16px))",
  maxHeight: "min(var(--radix-context-menu-content-available-height), calc(100vh - 16px))",
};

const CONTEXT_MENU_MOTION_CLASS_NAME = cn(
  "[transform-origin:var(--radix-context-menu-content-transform-origin)] [will-change:opacity,transform]",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]",
);

const CONTEXT_SUBMENU_MOTION_CLASS_NAME =
  "data-[state=closed]:invisible data-[state=closed]:pointer-events-none";

const CONTEXT_MENU_ITEM_CLASS_NAME = cn(
  "no-drag group flex w-full items-center gap-1.5 rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm outline-hidden",
  "cursor-interaction text-token-foreground data-highlighted:bg-token-list-hover-background focus:bg-token-list-hover-background",
  "data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:opacity-50",
);

function NodexContextMenuRowContent({
  children,
  leftSlot,
  rightSlot,
  tone = "default",
}: {
  readonly children: ReactNode;
  readonly leftSlot?: ReactNode;
  readonly rightSlot?: ReactNode;
  readonly tone?: "default" | "danger";
}) {
  return (
    <>
      {leftSlot ? (
        <span className={cn(
          "shrink-0 [&_svg]:size-4 [&_svg]:shrink-0",
          tone === "danger"
            ? "text-token-error-foreground"
            : "text-token-text-secondary group-data-[highlighted]:text-token-foreground group-focus:text-token-foreground",
        )}>
          {leftSlot}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {rightSlot ? (
        <span className="ml-2 shrink-0 text-token-description-foreground">
          {rightSlot}
        </span>
      ) : null}
    </>
  );
}

export interface NodexContextMenuItemProps
  extends ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> {
  readonly leftSlot?: ReactNode;
  readonly rightSlot?: ReactNode;
  readonly tone?: "default" | "danger";
}

export const NodexContextMenuItem = forwardRef<
  HTMLDivElement,
  NodexContextMenuItemProps
>(function NodexContextMenuItem({
  children,
  className,
  leftSlot,
  rightSlot,
  tone = "default",
  ...props
}, ref) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={cn(
        CONTEXT_MENU_ITEM_CLASS_NAME,
        tone === "danger" && "text-token-error-foreground",
        className,
      )}
      {...props}
    >
      <NodexContextMenuRowContent
        leftSlot={leftSlot}
        rightSlot={rightSlot}
        tone={tone}
      >
        {children}
      </NodexContextMenuRowContent>
    </ContextMenuPrimitive.Item>
  );
});

export interface NodexContextMenuSubTriggerProps
  extends ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> {
  readonly leftSlot?: ReactNode;
  readonly rightSlot?: ReactNode;
}

export const NodexContextMenuSubTrigger = forwardRef<
  HTMLDivElement,
  NodexContextMenuSubTriggerProps
>(function NodexContextMenuSubTrigger({
  children,
  className,
  leftSlot,
  rightSlot,
  ...props
}, ref) {
  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(CONTEXT_MENU_ITEM_CLASS_NAME, className)}
      {...props}
    >
      <NodexContextMenuRowContent leftSlot={leftSlot} rightSlot={rightSlot}>
        {children}
      </NodexContextMenuRowContent>
    </ContextMenuPrimitive.SubTrigger>
  );
});

export const NodexContextMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function NodexContextMenuContent({ children, className, style, ...props }, ref) {
  const layerIndex = useNodexFloatingLayerIndex(style?.zIndex);

  return (
    <ContextMenuPrimitive.Content
      ref={ref}
      data-slot="context-menu-content"
      collisionPadding={8}
      className={cn(
        nodexMenuSurfaceClassName,
        CONTEXT_MENU_MOTION_CLASS_NAME,
        className,
      )}
      style={{ ...CONTEXT_MENU_BOUNDARY_STYLE, zIndex: layerIndex, ...style }}
      {...props}
      data-nodex-keyboard-scope="local"
    >
      <NodexFloatingLayerProvider zIndex={layerIndex}>
        {children}
      </NodexFloatingLayerProvider>
    </ContextMenuPrimitive.Content>
  );
});

export const NodexContextMenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(function NodexContextMenuSubContent({ children, className, style, ...props }, ref) {
  const layerIndex = useNodexFloatingLayerIndex(style?.zIndex);

  return (
    <ContextMenuPrimitive.SubContent
      ref={ref}
      data-slot="context-menu-subcontent"
      sideOffset={4}
      collisionPadding={8}
      className={cn(
        nodexMenuSurfaceClassName,
        CONTEXT_SUBMENU_MOTION_CLASS_NAME,
        "[transform-origin:var(--radix-context-menu-content-transform-origin)] [will-change:opacity,transform]",
        className,
      )}
      style={{ ...CONTEXT_MENU_BOUNDARY_STYLE, zIndex: layerIndex, ...style }}
      {...props}
      data-nodex-keyboard-scope="local"
    >
      <NodexFloatingLayerProvider zIndex={layerIndex}>
        {children}
      </NodexFloatingLayerProvider>
    </ContextMenuPrimitive.SubContent>
  );
});
