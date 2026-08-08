import * as React from "react";
import * as Slot from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const nodexButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "outline-hidden transition-colors disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:ring-token-focus focus-visible:ring-2",
    "cursor-interaction",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-']):not([class*='icon-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-token-foreground text-token-background hover:bg-token-foreground/90",
        primary:
          "bg-token-foreground text-token-background hover:bg-token-foreground/90",
        secondary:
          "bg-token-foreground/6 text-token-foreground hover:bg-token-foreground/10",
        outline:
          "border border-token-border bg-token-main-surface-primary text-token-foreground hover:bg-token-list-hover-background",
        ghost:
          "text-token-foreground hover:bg-token-list-hover-background",
        destructive:
          "bg-token-error-background text-token-error-foreground hover:opacity-90",
      },
      size: {
        default: "h-9 rounded-xl px-4 text-sm",
        sm: "h-8 rounded-lg px-3 text-sm",
        xs: "h-6 rounded-md px-2 text-xs [&_svg:not([class*='size-']):not([class*='icon-'])]:size-3",
        composer: "h-token-button-composer rounded-lg px-2 py-0 text-base leading-[18px]",
        lg: "h-10 rounded-xl px-5 text-sm",
        icon: "size-9 rounded-xl",
        "icon-sm": "size-8 rounded-lg",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-']):not([class*='icon-'])]:size-3",
        "icon-lg": "size-10 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface NodexButtonProps
  extends React.ComponentProps<"button">,
  VariantProps<typeof nodexButtonVariants> {
  asChild?: boolean;
}

export function NodexButton({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: NodexButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="codex-button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(nodexButtonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export interface NodexIconButtonProps extends React.ComponentProps<"button"> {
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  tone?: "default" | "danger";
  size?: "xs" | "sm" | "default";
  ariaLabel: string;
}

export function NodexIconButton({
  icon: Icon,
  active = false,
  tone = "default",
  size = "default",
  disabled = false,
  className,
  ariaLabel,
  type = "button",
  title,
  ...props
}: NodexIconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      className={cn(
        "inline-flex items-center justify-center rounded-md outline-hidden transition-colors",
        "focus-visible:ring-token-focus focus-visible:ring-2",
        size === "xs" && "size-6",
        size === "sm" && "size-7",
        size === "default" && "size-8",
        tone === "danger"
          ? active
            ? "text-token-error-foreground"
            : "text-token-error-foreground/70 hover:bg-token-error-background/10 hover:text-token-error-foreground"
          : active
            ? "text-(--accent-blue)"
            : "text-[color-mix(in_srgb,var(--foreground)_62%,transparent)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] hover:text-(--foreground)",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export interface NodexSwitchProps {
  ariaLabel?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  onCheckedChange: (nextChecked: boolean) => void;
}

export function NodexSwitch({
  ariaLabel,
  checked,
  className,
  disabled = false,
  onCheckedChange,
}: NodexSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex items-center text-sm outline-hidden",
        "focus-visible:rounded-full focus-visible:ring-token-focus-border focus-visible:ring-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-interaction",
        className,
      )}
    >
      <span
        className={cn(
          "relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ease-out",
          checked ? "bg-token-charts-blue" : "bg-token-foreground/10",
        )}
        data-state={checked ? "checked" : "unchecked"}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] shadow-sm transition-transform duration-200 ease-out",
            checked ? "translate-x-[14px]" : "translate-x-[2px]",
          )}
          data-state={checked ? "checked" : "unchecked"}
        />
      </span>
    </button>
  );
}
