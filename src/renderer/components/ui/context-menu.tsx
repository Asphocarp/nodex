import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { NodexFloatingLayerProvider, useNodexFloatingLayerIndex } from "./floating-layer";
import { nodexMenuSurfaceClassName } from "./menu-surface";

const CONTEXT_MENU_BOUNDARY_STYLE: CSSProperties = {
  maxWidth: "min(var(--radix-context-menu-content-available-width), calc(100vw - 16px))",
  maxHeight: "min(var(--radix-context-menu-content-available-height), calc(100vh - 16px))",
};

const CONTEXT_SUBMENU_MOTION_CLASS_NAME =
  "data-[state=closed]:invisible data-[state=closed]:pointer-events-none";

const CONTEXT_MENU_ITEM_CLASS_NAME = cn(
  "no-drag group flex w-full items-center gap-1.5 rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm outline-hidden",
  "cursor-interaction text-token-foreground data-highlighted:bg-token-list-hover-background focus:bg-token-list-hover-background",
  "data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:opacity-50",
);

interface ContextMenuSubmenuRegistration {
  readonly id: symbol;
  readonly close: () => void;
}

interface ContextMenuSubmenuCoordinator {
  activate(registration: ContextMenuSubmenuRegistration): void;
  deactivate(id: symbol): void;
  dismissActive(): void;
}

const createContextMenuSubmenuCoordinator = (): ContextMenuSubmenuCoordinator => {
  let active: ContextMenuSubmenuRegistration | null = null;
  return {
    activate(registration) {
      if (active?.id === registration.id) return;
      const previous = active;
      active = registration;
      previous?.close();
    },
    deactivate(id) {
      if (active?.id === id) active = null;
    },
    dismissActive() {
      const previous = active;
      active = null;
      previous?.close();
    },
  };
};

const ContextMenuSubmenuCoordinatorContext = createContext<ContextMenuSubmenuCoordinator | null>(
  null,
);

function ContextMenuSubmenuCoordinatorProvider({ children }: { readonly children: ReactNode }) {
  const coordinatorRef = useRef<ContextMenuSubmenuCoordinator>(null);
  if (!coordinatorRef.current) coordinatorRef.current = createContextMenuSubmenuCoordinator();
  return (
    <ContextMenuSubmenuCoordinatorContext.Provider value={coordinatorRef.current}>
      {children}
    </ContextMenuSubmenuCoordinatorContext.Provider>
  );
}

export const NodexContextMenuRoot = ContextMenuPrimitive.Root;
export const NodexContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const NodexContextMenuPortal = ContextMenuPrimitive.Portal;
export const NodexContextMenuCheckboxItem = ContextMenuPrimitive.CheckboxItem;
export const NodexContextMenuItemIndicator = ContextMenuPrimitive.ItemIndicator;
export const NodexContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;
export const NodexContextMenuRadioItem = ContextMenuPrimitive.RadioItem;

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
        <span
          className={cn(
            "shrink-0 [&_svg]:size-4 [&_svg]:shrink-0",
            tone === "danger"
              ? "text-token-error-foreground"
              : "text-token-text-secondary group-data-[highlighted]:text-token-foreground group-focus:text-token-foreground",
          )}
        >
          {leftSlot}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {rightSlot ? (
        <span className="ml-2 shrink-0 text-token-description-foreground">{rightSlot}</span>
      ) : null}
    </>
  );
}

export interface NodexContextMenuItemProps extends ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Item
> {
  readonly leftSlot?: ReactNode;
  readonly rightSlot?: ReactNode;
  readonly tone?: "default" | "danger";
}

export const NodexContextMenuItem = forwardRef<HTMLDivElement, NodexContextMenuItemProps>(
  function NodexContextMenuItem(
    {
      children,
      className,
      leftSlot,
      rightSlot,
      tone = "default",
      onPointerEnter,
      onPointerMove,
      ...props
    },
    ref,
  ) {
    const coordinator = useContext(ContextMenuSubmenuCoordinatorContext);
    const handlePointerEnter: PointerEventHandler<HTMLDivElement> = (event) => {
      onPointerEnter?.(event);
      if (event.defaultPrevented || event.pointerType === "touch" || !coordinator) return;
      coordinator.dismissActive();
    };
    const handlePointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
      onPointerMove?.(event);
      if (event.defaultPrevented || event.pointerType === "touch" || !coordinator) return;
      coordinator.dismissActive();
    };

    return (
      <ContextMenuPrimitive.Item
        ref={ref}
        className={cn(
          CONTEXT_MENU_ITEM_CLASS_NAME,
          tone === "danger" && "text-token-error-foreground",
          className,
        )}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        {...props}
      >
        <NodexContextMenuRowContent leftSlot={leftSlot} rightSlot={rightSlot} tone={tone}>
          {children}
        </NodexContextMenuRowContent>
      </ContextMenuPrimitive.Item>
    );
  },
);

export interface NodexContextMenuSubmenuTriggerProps extends ComponentPropsWithoutRef<"div"> {
  readonly leftSlot?: ReactNode;
  readonly rightSlot?: ReactNode;
}

/** A styled row for `NodexContextMenuSubmenu.trigger`, without another Radix trigger. */
export const NodexContextMenuSubmenuTrigger = forwardRef<
  HTMLDivElement,
  NodexContextMenuSubmenuTriggerProps
>(function NodexContextMenuSubmenuTrigger(
  { children, className, leftSlot, rightSlot, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(CONTEXT_MENU_ITEM_CLASS_NAME, className)} {...props}>
      <NodexContextMenuRowContent leftSlot={leftSlot} rightSlot={rightSlot}>
        {children}
      </NodexContextMenuRowContent>
    </div>
  );
});

export interface NodexContextMenuSubmenuProps {
  readonly disabled?: boolean;
  readonly trigger: ReactElement;
  readonly renderContent: () => ReactNode;
  readonly contentClassName?: string;
  readonly alignOffset?: number;
  readonly onContentFocusOutside?: ComponentPropsWithoutRef<
    typeof ContextMenuPrimitive.SubContent
  >["onFocusOutside"];
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * Owns the complete submenu interaction contract. Content is not evaluated
 * until this submenu opens, and sibling coordination never updates a feature
 * menu's root state.
 */
export function NodexContextMenuSubmenu({
  disabled = false,
  trigger,
  renderContent,
  contentClassName,
  alignOffset,
  onContentFocusOutside,
  onOpenChange,
}: NodexContextMenuSubmenuProps) {
  const coordinator = useContext(ContextMenuSubmenuCoordinatorContext);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const idRef = useRef(Symbol("nodex-context-submenu"));
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  const registrationRef = useRef<ContextMenuSubmenuRegistration>(null);
  if (!registrationRef.current) {
    registrationRef.current = {
      id: idRef.current,
      close: () => {
        openRef.current = false;
        setOpen(false);
        onOpenChangeRef.current?.(false);
      },
    };
  }

  useEffect(() => () => coordinator?.deactivate(idRef.current), [coordinator]);

  const commitOpen = (nextOpen: boolean): void => {
    if (openRef.current === nextOpen) return;
    openRef.current = nextOpen;
    if (nextOpen) {
      coordinator?.activate(registrationRef.current!);
    } else {
      coordinator?.deactivate(idRef.current);
    }
    setOpen(nextOpen);
    onOpenChangeRef.current?.(nextOpen);
  };

  const handlePointerActivation: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.defaultPrevented || event.pointerType === "touch" || disabled) return;
    commitOpen(true);
  };

  return (
    <ContextMenuPrimitive.Sub open={open} onOpenChange={commitOpen}>
      <ContextMenuPrimitive.SubTrigger
        asChild
        disabled={disabled}
        data-nodex-context-menu-subtrigger="true"
        onPointerEnter={handlePointerActivation}
        onPointerMove={handlePointerActivation}
      >
        {trigger}
      </ContextMenuPrimitive.SubTrigger>
      <ContextMenuPrimitive.Portal>
        <NodexContextMenuSubContent
          alignOffset={alignOffset}
          onFocusOutside={onContentFocusOutside}
          className={contentClassName}
        >
          {open ? renderContent() : null}
        </NodexContextMenuSubContent>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Sub>
  );
}

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
      className={cn(nodexMenuSurfaceClassName, className)}
      style={{ ...CONTEXT_MENU_BOUNDARY_STYLE, zIndex: layerIndex, ...style }}
      {...props}
      data-nodex-keyboard-scope="local"
    >
      <NodexFloatingLayerProvider zIndex={layerIndex}>
        <ContextMenuSubmenuCoordinatorProvider>{children}</ContextMenuSubmenuCoordinatorProvider>
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
      sideOffset={0}
      collisionPadding={8}
      className={cn(nodexMenuSurfaceClassName, CONTEXT_SUBMENU_MOTION_CLASS_NAME, className)}
      style={{ ...CONTEXT_MENU_BOUNDARY_STYLE, zIndex: layerIndex, ...style }}
      {...props}
      data-nodex-keyboard-scope="local"
    >
      <NodexFloatingLayerProvider zIndex={layerIndex}>
        <ContextMenuSubmenuCoordinatorProvider>{children}</ContextMenuSubmenuCoordinatorProvider>
      </NodexFloatingLayerProvider>
    </ContextMenuPrimitive.SubContent>
  );
});
