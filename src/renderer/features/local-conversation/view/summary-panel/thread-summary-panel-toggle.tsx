import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { PinnedSummaryIcon } from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";

const SUMMARY_TOGGLE_PRESSED_CLASS = "border-token-border no-drag cursor-interaction flex overflow-visible items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-foreground bg-token-foreground/5 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10 border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square justify-center !px-0";
const SUMMARY_TOGGLE_IDLE_CLASS = "border-token-border no-drag cursor-interaction flex overflow-visible items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square justify-center !px-0";

function appendClassName(baseClassName: string, className: string | undefined): string {
  const trimmedClassName = className?.trim();
  if (!trimmedClassName) return baseClassName;
  return `${baseClassName} ${trimmedClassName}`;
}

type ThreadSummaryPanelToggleButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  pressed: boolean;
  label?: string;
};

export const ThreadSummaryPanelToggleButton = forwardRef<HTMLButtonElement, ThreadSummaryPanelToggleButtonProps>(
  function ThreadSummaryPanelToggleButton(
    {
      pressed,
      label = "Toggle pinned summary",
      className,
      type = "button",
      ...buttonProps
    },
    ref,
  ) {
    const ariaLabel = buttonProps["aria-label"] ?? label;
    const title = buttonProps.title ?? label;

    return (
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        aria-label={ariaLabel}
        aria-pressed={pressed}
        title={title}
        className={appendClassName(
          pressed ? SUMMARY_TOGGLE_PRESSED_CLASS : SUMMARY_TOGGLE_IDLE_CLASS,
          className,
        )}
      >
        <PinnedSummaryIcon className="shrink-0 overflow-visible" />
      </button>
    );
  },
);

type ThreadSummaryPanelToggleProps = ThreadSummaryPanelToggleButtonProps;

export function ThreadSummaryPanelToggle({
  pressed,
  onClick,
  label = "Toggle pinned summary",
  className,
  ...buttonProps
}: ThreadSummaryPanelToggleProps) {
  return (
    <NodexTooltip tooltipContent={label} side="bottom">
      <ThreadSummaryPanelToggleButton
        {...buttonProps}
        label={label}
        pressed={pressed}
        onClick={onClick}
        className={className}
      />
    </NodexTooltip>
  );
}
