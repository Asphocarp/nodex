import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
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
