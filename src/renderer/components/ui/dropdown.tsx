import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  CheckmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
} from "@/components/shared/icons";
import { cn } from "@/lib/utils";
import { NodexTooltip } from "./tooltip";

export type NodexDropdownSurface = "menu" | "panel";
export type NodexDropdownContentWidth =
  | "icon"
  | "xs"
  | "sm"
  | "menuNarrow"
  | "menu"
  | "menuFixed"
  | "menuBounded"
  | "menuWide"
  | "workspace"
  | "panel"
  | "panelWide";
export type NodexDropdownContentMaxHeight = "list" | "tall";

const CONTENT_BOUNDARY_STYLE: CSSProperties = {
  maxWidth: "min(var(--radix-dropdown-menu-content-available-width), calc(100vw - 16px))",
  maxHeight: "min(var(--radix-dropdown-menu-content-available-height), calc(100vh - 16px))",
};

function NodexDropdownRoot(
  props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>,
) {
  return <DropdownMenuPrimitive.Root modal={false} {...props} />;
}

function NodexDropdownTrigger(
  props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>,
) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-trigger" {...props} />;
}

function NodexDropdownPortal(
  props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Portal>,
) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-portal" {...props} />;
}

function NodexDropdownSubmenu(
  props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Sub>,
) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-submenu" {...props} />;
}

const NodexDropdownSubmenuTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(function NodexDropdownSubmenuTrigger({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(dropdownItemBaseClassName, dropdownItemInteractiveClassName, className)}
      {...props}
    />
  );
});

const NodexDropdownSubmenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & {
    surface?: NodexDropdownSurface | "bare";
  }
>(function NodexDropdownSubmenuContent(
  {
    className,
    style,
    collisionPadding = 6,
    sideOffset = 4,
    alignOffset = -4,
    surface = "menu",
    ...props
  },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      collisionPadding={collisionPadding}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      style={{ ...CONTENT_BOUNDARY_STYLE, ...style }}
      className={cn(
        surface === "bare"
          ? "z-50 m-0 flex min-w-[180px] select-none flex-col overflow-y-auto p-0"
          : dropdownContentSurfaceClassName,
        className,
      )}
      {...props}
    />
  );
});

const dropdownContentSurfaceClassName = cn(
  "no-drag bg-token-dropdown-background/90 text-token-foreground ring-token-border z-50 m-px flex select-none flex-col overflow-y-auto rounded-xl ring-[0.5px] px-1 py-1 shadow-xl-spread backdrop-blur-sm",
  "[transform-origin:var(--radix-dropdown-menu-content-transform-origin)] [will-change:opacity,transform]",
);

const dropdownItemBaseClassName =
  "text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm";
const dropdownItemInteractiveClassName =
  "hover:bg-token-list-hover-background focus:bg-token-list-hover-background cursor-interaction";
const dropdownSectionLabelClassName =
  "px-[var(--padding-row-x)] py-1 text-sm text-token-description-foreground";
const dropdownMessageClassName = "px-[var(--padding-row-x)] text-sm";
const dropdownTitleClassName =
  "text-token-description-foreground flex min-h-6 items-center truncate px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm leading-4";
const dropdownSeparatorClassName = "w-full px-[var(--padding-row-x)] py-1";
const dropdownContentMotionClassName = cn(
  "[--dropdown-entry-transform:translateY(calc(var(--dropdown-translate)_*_-1))_scale(var(--dropdown-scale))]",
  "data-[side=top]:[--dropdown-entry-transform:translateY(calc(var(--dropdown-translate)_*_1))_scale(var(--dropdown-scale))]",
  "data-[side=right]:[--dropdown-entry-transform:translateX(calc(var(--dropdown-translate)_*_-1))_scale(var(--dropdown-scale))]",
  "data-[side=left]:[--dropdown-entry-transform:translateX(calc(var(--dropdown-translate)_*_1))_scale(var(--dropdown-scale))]",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[var(--dropdown-scale)] data-[side=bottom]:data-[state=open]:slide-in-from-top-[var(--dropdown-translate)] data-[side=left]:data-[state=open]:slide-in-from-right-[var(--dropdown-translate)] data-[side=right]:data-[state=open]:slide-in-from-left-[var(--dropdown-translate)] data-[side=top]:data-[state=open]:slide-in-from-bottom-[var(--dropdown-translate)]",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[var(--dropdown-scale)]",
);

function resolveDropdownSurfaceClass(surface: NodexDropdownSurface): string | undefined {
  if (surface === "panel") return "rounded-2xl p-4 shadow-2xl backdrop-blur-lg";
  return undefined;
}

function resolveDropdownWidthClass(width?: NodexDropdownContentWidth): string | undefined {
  if (width === "icon") return "min-w-[120px]";
  if (width === "xs") return "min-w-[160px]";
  if (width === "sm") return "min-w-[180px]";
  if (width === "menuNarrow") return "w-52";
  if (width === "menu") return "min-w-[220px]";
  if (width === "menuFixed") return "w-[220px]";
  if (width === "menuBounded") return "min-w-[200px] max-w-[320px]";
  if (width === "menuWide") return "w-[240px]";
  if (width === "workspace") return "min-w-[260px]";
  if (width === "panel") return "w-[280px]";
  if (width === "panelWide") return "w-[360px]";
  return undefined;
}

function resolveDropdownMaxHeightClass(maxHeight?: NodexDropdownContentMaxHeight): string | undefined {
  if (maxHeight === "list") return "max-h-[250px]";
  if (maxHeight === "tall") return "max-h-[350px]";
  return undefined;
}

export interface NodexDropdownMenuProps {
  triggerButton: ReactElement;
  children: ReactNode;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  dir?: "ltr" | "rtl";
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  alignOffset?: number;
  onCloseAutoFocus?: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>["onCloseAutoFocus"];
  onEscapeKeyDown?: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>["onEscapeKeyDown"];
  contentClassName?: string;
  surface?: NodexDropdownSurface;
  contentWidth?: NodexDropdownContentWidth;
  contentMaxHeight?: NodexDropdownContentMaxHeight;
  portalContainer?: HTMLElement | null;
}

export function NodexDropdownMenu({
  triggerButton,
  children,
  disabled = false,
  open,
  onOpenChange,
  dir,
  side,
  align = "start",
  sideOffset = 4,
  alignOffset,
  onCloseAutoFocus,
  onEscapeKeyDown,
  contentClassName,
  surface = "menu",
  contentWidth,
  contentMaxHeight,
  portalContainer,
}: NodexDropdownMenuProps) {
  return (
    <NodexDropdownRoot
      dir={dir}
      open={open}
      onOpenChange={onOpenChange}
    >
      <NodexDropdownTrigger asChild disabled={disabled}>
        {triggerButton}
      </NodexDropdownTrigger>
      {disabled ? null : (
        <NodexDropdownPortal container={portalContainer ?? undefined}>
          <NodexDropdownContent
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            onCloseAutoFocus={onCloseAutoFocus}
            onEscapeKeyDown={onEscapeKeyDown}
            className={cn(
              resolveDropdownWidthClass(contentWidth),
              resolveDropdownMaxHeightClass(contentMaxHeight),
              contentClassName,
            )}
            surface={surface}
          >
            {children}
          </NodexDropdownContent>
        </NodexDropdownPortal>
      )}
    </NodexDropdownRoot>
  );
}

export interface NodexDropdownContentProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  surface?: NodexDropdownSurface;
}

export const NodexDropdownContent = forwardRef<
  HTMLDivElement,
  NodexDropdownContentProps
>(function NodexDropdownContent(
  {
    children,
    className,
    align = "start",
    surface = "menu",
    style,
    collisionPadding = 6,
    ...props
  },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Content
      ref={ref}
      align={align}
      collisionPadding={collisionPadding}
      style={{ ...CONTENT_BOUNDARY_STYLE, ...style }}
      className={cn(
        dropdownContentSurfaceClassName,
        dropdownContentMotionClassName,
        "[transform-origin:var(--radix-dropdown-menu-content-transform-origin)]",
        resolveDropdownSurfaceClass(surface),
        className,
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Content>
  );
});

export const NodexDropdownButtonTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & {
    size?: "xs" | "sm" | "default";
    muted?: boolean;
    showChevron?: boolean;
    chrome?: "filled" | "transparent";
    shape?: "default" | "pill";
  }
>(function NodexDropdownButtonTrigger(
  {
    className,
    children,
    type = "button",
    size = "default",
    muted = false,
    showChevron = true,
    chrome = "filled",
    shape = "default",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex w-fit items-center justify-between gap-1 border border-transparent outline-hidden disabled:cursor-not-allowed disabled:opacity-40",
        chrome === "filled" ? "bg-token-foreground/5 hover:bg-token-foreground/10" : "bg-transparent hover:bg-token-foreground/5",
        "focus-visible:ring-token-focus focus-visible:ring-2",
        muted ? "text-token-description-foreground" : "text-token-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-token-description-foreground",
        size === "xs"
          ? "h-6 rounded-md px-2 py-0 text-xs [&_svg]:size-3"
          : size === "sm"
            ? "h-7 rounded-lg px-2 py-0 text-sm/4.5"
            : "h-7 rounded-lg px-2 py-0 text-sm/4.5",
        shape === "pill" && "rounded-full",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {showChevron ? <ChevronDownIcon className="icon-2xs" /> : null}
    </button>
  );
});

export interface NodexDropdownItemProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  subText?: ReactNode;
  keyboardShortcut?: ReactNode;
  tooltipText?: ReactNode;
  tooltipTextClassName?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  tooltipAlign?: "start" | "center" | "end";
  allowWrap?: boolean;
}

export const NodexDropdownItem = forwardRef<
  HTMLDivElement,
  NodexDropdownItemProps
>(function NodexDropdownItem(
  {
    children,
    leftSlot,
    rightSlot,
    subText,
    keyboardShortcut,
    tooltipText,
    tooltipTextClassName,
    tooltipSide = "right",
    tooltipAlign,
    allowWrap = false,
    className,
    disabled = false,
    onClick,
    onSelect,
    ...props
  },
  ref,
) {
  const item = (
    <DropdownMenuPrimitive.Item
      ref={ref}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onSelect={disabled ? undefined : onSelect}
      className={cn(
        "no-drag",
        dropdownItemBaseClassName,
        !disabled && dropdownItemInteractiveClassName,
        "flex flex-col",
        disabled && "cursor-default opacity-50",
        className,
      )}
      {...props}
    >
      <div className="flex w-full items-center gap-1.5">
        {leftSlot ? <span className="shrink-0">{leftSlot}</span> : null}
        <span className={cn("min-w-0 flex-1", allowWrap ? "whitespace-normal" : "truncate")}>
          <span className={cn("flex items-center gap-1", subText && "flex-col items-start gap-0.5")}>
            <span className={cn("min-w-0", !allowWrap && "truncate")}>{children}</span>
            {subText ? (
              <span className="min-w-0 truncate text-xs text-token-description-foreground">
                {subText}
              </span>
            ) : null}
          </span>
        </span>
        {keyboardShortcut ? (
          <span className="ml-2 shrink-0 text-xs text-token-description-foreground">
            {keyboardShortcut}
          </span>
        ) : null}
        {rightSlot ? <span className="shrink-0">{rightSlot}</span> : null}
      </div>
    </DropdownMenuPrimitive.Item>
  );

  if (!tooltipText) return item;

  return (
    <NodexTooltip
      tooltipContent={(
        <div className={cn("max-w-64 text-pretty", tooltipTextClassName)}>
          {tooltipText}
        </div>
      )}
      side={tooltipSide}
      align={tooltipAlign}
      tooltipBodyClassName={tooltipTextClassName}
    >
      {item}
    </NodexTooltip>
  );
});

export interface NodexDropdownChoiceOption {
  value: string;
  label: ReactNode;
  leftSlot?: ReactNode;
  subText?: ReactNode;
  tooltipText?: ReactNode;
  disabled?: boolean;
  allowWrap?: boolean;
}

export interface NodexDropdownChoiceMenuProps
  extends Omit<NodexDropdownMenuProps, "children"> {
  value: string;
  options: NodexDropdownChoiceOption[];
  onValueChange: (value: string) => void;
  title?: ReactNode;
  emptyMessage?: ReactNode;
}

export function NodexDropdownChoiceMenu({
  value,
  options,
  onValueChange,
  title,
  emptyMessage = "No options available",
  ...menuProps
}: NodexDropdownChoiceMenuProps) {
  return (
    <NodexDropdownMenu {...menuProps}>
      {title ? <NodexDropdownTitle>{title}</NodexDropdownTitle> : null}
      {options.length === 0 ? (
        <NodexDropdownMessage compact>{emptyMessage}</NodexDropdownMessage>
      ) : (
        options.map((option) => (
          <NodexDropdownItem
            key={option.value}
            onSelect={() => onValueChange(option.value)}
            disabled={option.disabled}
            leftSlot={option.leftSlot}
            subText={option.subText}
            tooltipText={option.tooltipText}
            allowWrap={option.allowWrap}
            rightSlot={option.value === value ? <NodexDropdownSelectedIcon /> : null}
          >
            {option.label}
          </NodexDropdownItem>
        ))
      )}
    </NodexDropdownMenu>
  );
}

export const NodexDropdownInput = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<"input">
>(function NodexDropdownInput({ className, onKeyDown, ...props }, ref) {
  return (
    <input
      ref={ref}
      autoFocus
      className={cn(
        "text-md w-full min-w-0 rounded-sm border border-none px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm !outline-none",
        className,
      )}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          event.currentTarget.select();
          return;
        }
        onKeyDown?.(event);
      }}
      {...props}
    />
  );
});

export const NodexDropdownSearchInput = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<typeof NodexDropdownInput> & {
    inputClassName?: string;
    trailingContent?: ReactNode;
  }
>(function NodexDropdownSearchInput(
  {
    className,
    inputClassName,
    trailingContent,
    ...props
  },
  ref,
) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-1.5 px-[var(--padding-row-x)] py-[var(--padding-row-y)]",
        className,
      )}
    >
      <SearchIcon className="icon-2xs shrink-0 text-token-text-tertiary" />
      <NodexDropdownInput
        ref={ref}
        className={cn(
          "!w-auto flex-1 appearance-none !rounded-none !border-none bg-transparent !px-0 !py-0 text-token-foreground placeholder:text-token-input-placeholder-foreground",
          inputClassName,
        )}
        {...props}
      />
      {trailingContent ? <div className="shrink-0">{trailingContent}</div> : null}
    </div>
  );
});

export function NodexDropdownSeparator({
  className,
  paddingClassName = "py-1",
}: {
  className?: string;
  paddingClassName?: string;
}) {
  return (
    <div className={cn(dropdownSeparatorClassName, paddingClassName, className)}>
      <div className="h-[1px] w-full bg-token-menu-border" />
    </div>
  );
}

export const NodexDropdownSurface = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function NodexDropdownSurface({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(dropdownContentSurfaceClassName, className)}
      {...props}
    />
  );
});

export function NodexDropdownScrollList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex max-h-[250px] flex-col overflow-y-auto", className)}>
      {children}
    </div>
  );
}

export function NodexDropdownActionRow({
  children,
  className,
  disabled = false,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "no-drag",
        dropdownItemBaseClassName,
        !disabled && dropdownItemInteractiveClassName,
        "focus-visible:bg-token-list-hover-background cursor-interaction flex w-full data-disabled:pointer-events-none",
        disabled && "cursor-default opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function NodexDropdownSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(dropdownSectionLabelClassName, className)}>
      {children}
    </div>
  );
}

export function NodexDropdownMessage({
  children,
  className,
  tone = "muted",
  compact = false,
  centered = false,
}: {
  children: ReactNode;
  className?: string;
  tone?: "muted" | "error";
  compact?: boolean;
  centered?: boolean;
}) {
  return (
    <div
      className={cn(
        dropdownMessageClassName,
        compact ? "py-2" : "py-3",
        tone === "error" ? "text-token-error-foreground" : "text-token-description-foreground",
        centered && "self-center text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function NodexDropdownTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(dropdownTitleClassName, className)}>
      {children}
    </div>
  );
}

export function NodexDropdownSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

export function NodexDropdownFlyoutSubmenuItem({
  label,
  children,
  leftSlot,
  className,
  disabled = false,
  contentClassName,
  contentSurface = "menu",
  onSelect,
  triggerContent,
  tooltipText,
  tooltipTextClassName,
  tooltipSide,
  tooltipAlign,
}: {
  label: ReactNode;
  children: ReactNode;
  leftSlot?: ReactNode;
  className?: string;
  disabled?: boolean;
  contentClassName?: string;
  contentSurface?: NodexDropdownSurface | "bare";
  onSelect?: () => void;
  triggerContent?: ReactNode;
  tooltipText?: ReactNode;
  tooltipTextClassName?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  tooltipAlign?: "start" | "center" | "end";
}) {
  const trigger = (
    <NodexDropdownSubmenuTrigger
      disabled={disabled}
      className={cn(
        "flex w-full items-center",
        disabled && "cursor-default opacity-50",
        className,
      )}
      onClick={(event) => {
        if (disabled || !onSelect) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
    >
      {triggerContent ?? (
        <div className="flex w-full items-center gap-1.5">
          {leftSlot ? <span className="shrink-0">{leftSlot}</span> : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronRightIcon className="icon-2xs shrink-0 text-token-input-placeholder-foreground" />
        </div>
      )}
    </NodexDropdownSubmenuTrigger>
  );

  return (
    <NodexDropdownSubmenu>
      {tooltipText ? (
        <NodexTooltip
          tooltipContent={
            <div className={cn("max-w-64 text-pretty", tooltipTextClassName)}>{tooltipText}</div>
          }
          side={tooltipSide ?? "right"}
          align={tooltipAlign}
          tooltipBodyClassName={tooltipTextClassName}
        >
          {trigger}
        </NodexTooltip>
      ) : (
        trigger
      )}
      <NodexDropdownPortal>
        <NodexDropdownSubmenuContent
          surface={contentSurface}
          className={contentClassName}
        >
          <div dir="ltr">{children}</div>
        </NodexDropdownSubmenuContent>
      </NodexDropdownPortal>
    </NodexDropdownSubmenu>
  );
}

export function NodexDropdownSelectedIcon() {
  return <CheckmarkIcon className="shrink-0 text-token-foreground" />;
}

export const NodexDropdown = {
  Menu: NodexDropdownMenu,
  Content: NodexDropdownContent,
  ButtonTrigger: NodexDropdownButtonTrigger,
  Item: NodexDropdownItem,
  ChoiceMenu: NodexDropdownChoiceMenu,
  Input: NodexDropdownInput,
  SearchInput: NodexDropdownSearchInput,
  Separator: NodexDropdownSeparator,
  Surface: NodexDropdownSurface,
  ScrollList: NodexDropdownScrollList,
  ActionRow: NodexDropdownActionRow,
  Section: NodexDropdownSection,
  SectionLabel: NodexDropdownSectionLabel,
  Message: NodexDropdownMessage,
  Title: NodexDropdownTitle,
  FlyoutSubmenuItem: NodexDropdownFlyoutSubmenuItem,
  SelectedIcon: NodexDropdownSelectedIcon,
};
