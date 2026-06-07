import { type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "../../../../lib/utils";

interface ThreadSummaryPanelRowProps {
  label: ReactNode;
  icon?: ReactNode;
  accessory?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
  trailingVisible?: boolean;
  title?: string;
  disabled?: boolean;
  interactive?: boolean;
  labelClassName?: string;
  className?: string;
  onClick?: () => void;
  onPointerDown?: (event: MouseEvent<HTMLDivElement>) => void;
}

function stopRowPropagation(event: MouseEvent<HTMLSpanElement>) {
  event.stopPropagation();
}

export function ThreadSummaryPanelRow({
  label,
  icon,
  accessory,
  actions,
  trailing,
  trailingVisible = false,
  title,
  disabled = false,
  interactive,
  labelClassName,
  className,
  onClick,
  onPointerDown,
}: ThreadSummaryPanelRowProps) {
  const isInteractive = interactive ?? Boolean(onClick);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !isInteractive) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick?.();
  };

  const content = (
    <>
      {icon ? <span className="shrink-0 leading-none text-token-text-tertiary">{icon}</span> : null}
      <span className={cn("min-w-0 flex-1 truncate text-base", labelClassName)}>{label}</span>
      {accessory ? (
        <span className="shrink-0 leading-none" onClick={stopRowPropagation}>
          {accessory}
        </span>
      ) : null}
      {actions ? (
        <span className="shrink-0 leading-none" onClick={stopRowPropagation}>
          {actions}
        </span>
      ) : null}
      {trailing ? (
        <span
          className={cn(
            "ms-auto shrink-0 leading-none opacity-0 group-focus-visible/summary-panel-row:opacity-100 group-hover/summary-panel-row:opacity-100",
            trailingVisible && "opacity-100",
          )}
        >
          {trailing}
        </span>
      ) : null}
    </>
  );

  const rowClassName = cn(
    "group/summary-panel-row relative isolate flex h-7 w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent px-0 py-1 text-left",
    isInteractive
      ? "cursor-interaction text-token-foreground before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-sm before:content-[''] hover:before:bg-token-list-hover-background"
      : "cursor-default text-token-text-secondary",
    disabled && "cursor-not-allowed opacity-40",
    className,
  );

  return (
    <div
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive && !disabled ? 0 : undefined}
      title={title}
      aria-disabled={disabled || undefined}
      className={rowClassName}
      onClick={() => {
        if (disabled || !isInteractive) return;
        onClick?.();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={onPointerDown}
    >
      {content}
    </div>
  );
}
