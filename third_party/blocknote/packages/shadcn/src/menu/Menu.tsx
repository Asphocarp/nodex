import { assertEmpty } from "@blocknote/core";
import { ComponentProps } from "@blocknote/react";
import { ChevronRight } from "lucide-react";
import { forwardRef, useMemo, useRef } from "react";

import type { DropdownMenuTrigger as ShadCNDropdownMenuTrigger } from "../components/ui/dropdown-menu.js";
import { cn } from "../lib/utils.js";
import { useShadCNComponentsContext } from "../ShadCNComponentsContext.js";

const MENU_TRIGGER_DRAG_TOLERANCE_PX = 4;

type MenuTriggerPointerActivation = {
  dragStarted: boolean;
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};

function hasMovedBeyondDragTolerance(
  activation: MenuTriggerPointerActivation,
  event: React.PointerEvent,
) {
  return (
    Math.abs(event.clientX - activation.startX) > MENU_TRIGGER_DRAG_TOLERANCE_PX ||
    Math.abs(event.clientY - activation.startY) > MENU_TRIGGER_DRAG_TOLERANCE_PX
  );
}

// hacky HoC to change DropdownMenuTrigger to open a menu on PointerUp instead of PointerDown
// Needed to fix this issue: https://github.com/radix-ui/primitives/issues/2867
const MenuTriggerWithPointerUp = (Comp: typeof ShadCNDropdownMenuTrigger) =>
  forwardRef<any, React.ComponentProps<typeof ShadCNDropdownMenuTrigger>>(
    (props, ref) => {
      const {
        onDragStart,
        onPointerCancel,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        ...triggerProps
      } = props;
      const pointerActivationRef = useRef<MenuTriggerPointerActivation | null>(null);

      return (
        <Comp
          onPointerDown={(e) => {
            if (!(e.nativeEvent as any).fakeEvent) {
              // setting ctrlKey will block the menu from opening
              // as it will block this line: https://github.com/radix-ui/primitives/blob/b32a93318cdfce383c2eec095710d35ffbd33a1c/packages/react/dropdown-menu/src/DropdownMenu.tsx#L120
              e.ctrlKey = true;
              pointerActivationRef.current =
                e.isPrimary && e.button === 0
                  ? {
                      dragStarted: false,
                      moved: false,
                      pointerId: e.pointerId,
                      startX: e.clientX,
                      startY: e.clientY,
                    }
                  : null;
            }
            onPointerDown?.(e);
          }}
          onPointerMove={(event) => {
            const activation = pointerActivationRef.current;
            if (
              activation
              && activation.pointerId === event.pointerId
              && hasMovedBeyondDragTolerance(activation, event)
            ) {
              activation.moved = true;
            }
            onPointerMove?.(event);
          }}
          onPointerUp={(event) => {
            const activation = pointerActivationRef.current;
            pointerActivationRef.current = null;
            onPointerUp?.(event);

            if (!activation) return;
            if (activation.pointerId !== event.pointerId) return;
            if (activation.dragStarted) return;
            if (activation.moved || hasMovedBeyondDragTolerance(activation, event)) return;
            if (event.defaultPrevented) return;

            // dispatch a pointerdown event so the Radix pointer down handler gets called that opens the menu
            const e = new PointerEvent("pointerdown", event.nativeEvent);
            (e as any).fakeEvent = true;
            event.currentTarget.dispatchEvent(e);
          }}
          onPointerCancel={(event) => {
            const activation = pointerActivationRef.current;
            if (activation?.pointerId === event.pointerId) {
              pointerActivationRef.current = null;
            }
            onPointerCancel?.(event);
          }}
          onDragStart={(event) => {
            if (pointerActivationRef.current) {
              pointerActivationRef.current.dragStarted = true;
            }
            onDragStart?.(event);
          }}
          {...triggerProps}
          ref={ref}
        />
      );
    },
  );

const preventMenuPointerFocusLoss = (
  event: React.PointerEvent<HTMLElement>,
) => {
  if (event.defaultPrevented) {
    return;
  }

  if (event.pointerType !== "mouse" || event.button !== 0) {
    return;
  }

  event.preventDefault();
};

export const Menu = (props: ComponentProps["Generic"]["Menu"]["Root"]) => {
  const {
    children,
    onOpenChange,
    position, // Unused
    sub,
    ...rest
  } = props;

  assertEmpty(rest);

  const ShadCNComponents = useShadCNComponentsContext()!;

  if (sub) {
    return (
      <ShadCNComponents.DropdownMenu.DropdownMenuSub
        onOpenChange={onOpenChange}
      >
        {children}
      </ShadCNComponents.DropdownMenu.DropdownMenuSub>
    );
  } else {
    return (
      <ShadCNComponents.DropdownMenu.DropdownMenu
        modal={false}
        onOpenChange={onOpenChange}
      >
        {children}
      </ShadCNComponents.DropdownMenu.DropdownMenu>
    );
  }
};

export const MenuTrigger = (
  props: ComponentProps["Generic"]["Menu"]["Trigger"],
) => {
  const { children, sub, ...rest } = props;

  assertEmpty(rest);

  const ShadCNComponents = useShadCNComponentsContext()!;

  const DropdownMenuTrigger = useMemo(
    () =>
      MenuTriggerWithPointerUp(
        ShadCNComponents.DropdownMenu.DropdownMenuTrigger,
      ),
    [ShadCNComponents.DropdownMenu.DropdownMenuTrigger],
  );

  if (sub) {
    return (
      <ShadCNComponents.DropdownMenu.DropdownMenuSubTrigger
        onPointerDownCapture={preventMenuPointerFocusLoss}
      >
        {children}
      </ShadCNComponents.DropdownMenu.DropdownMenuSubTrigger>
    );
  } else {
    return (
      <DropdownMenuTrigger asChild={true} {...rest}>
        {children}
      </DropdownMenuTrigger>
    );
  }
};

export const MenuDropdown = forwardRef<
  HTMLDivElement,
  ComponentProps["Generic"]["Menu"]["Dropdown"]
>((props, ref) => {
  const { className, children, sub, ...rest } = props;

  assertEmpty(rest);

  const ShadCNComponents = useShadCNComponentsContext()!;

  if (sub) {
    return (
      <ShadCNComponents.DropdownMenu.DropdownMenuSubContent
        className={className}
        ref={ref}
      >
        {children}
      </ShadCNComponents.DropdownMenu.DropdownMenuSubContent>
    );
  } else {
    return (
      <ShadCNComponents.DropdownMenu.DropdownMenuContent
        className={className}
        ref={ref}
      >
        {children}
      </ShadCNComponents.DropdownMenu.DropdownMenuContent>
    );
  }
});

export const MenuItem = forwardRef<
  HTMLDivElement,
  ComponentProps["Generic"]["Menu"]["Item"]
>((props, ref) => {
  const { className, children, icon, checked, disabled, subTrigger, onClick, ...rest } =
    props;

  assertEmpty(rest);

  const ShadCNComponents = useShadCNComponentsContext()!;

  if (subTrigger) {
    return (
      <>
        {icon}
        {children}
      </>
    );
  }

  if (checked !== undefined) {
    return (
      <ShadCNComponents.DropdownMenu.DropdownMenuCheckboxItem
        className={cn(className, "gap-1", checked ? "" : "px-2")}
        ref={ref}
        checked={checked}
        disabled={disabled}
        onPointerDownCapture={preventMenuPointerFocusLoss}
        onClick={onClick}
        {...rest}
      >
        {icon}
        {children}
      </ShadCNComponents.DropdownMenu.DropdownMenuCheckboxItem>
    );
  }

  return (
    <ShadCNComponents.DropdownMenu.DropdownMenuItem
      className={className}
      ref={ref}
      disabled={disabled}
      onPointerDownCapture={preventMenuPointerFocusLoss}
      onClick={onClick}
      {...rest}
    >
      {icon}
      {children}
      {subTrigger && <ChevronRight className="ml-auto h-4 w-4" />}
    </ShadCNComponents.DropdownMenu.DropdownMenuItem>
  );
});

export const MenuDivider = forwardRef<
  HTMLDivElement,
  ComponentProps["Generic"]["Menu"]["Divider"]
>((props, ref) => {
  const { className, ...rest } = props;

  assertEmpty(rest);

  const ShadCNComponents = useShadCNComponentsContext()!;

  return (
    <ShadCNComponents.DropdownMenu.DropdownMenuSeparator
      className={className}
      ref={ref}
    />
  );
});

export const MenuLabel = forwardRef<
  HTMLDivElement,
  ComponentProps["Generic"]["Menu"]["Label"]
>((props, ref) => {
  const { className, children, ...rest } = props;

  assertEmpty(rest);

  const ShadCNComponents = useShadCNComponentsContext()!;

  return (
    <ShadCNComponents.DropdownMenu.DropdownMenuLabel
      className={className}
      ref={ref}
    >
      {children}
    </ShadCNComponents.DropdownMenu.DropdownMenuLabel>
  );
});
