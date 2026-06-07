import { CodexPinnedSummaryIcon } from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";

const SUMMARY_TOGGLE_PRESSED_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-foreground bg-token-foreground/5 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10 border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square items-center justify-center !px-0";
const SUMMARY_TOGGLE_IDLE_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square items-center justify-center !px-0";

function appendClassName(baseClassName: string, className: string | undefined): string {
  const trimmedClassName = className?.trim();
  if (!trimmedClassName) return baseClassName;
  return `${baseClassName} ${trimmedClassName}`;
}

interface ThreadSummaryPanelToggleProps {
  pressed: boolean;
  onClick: () => void;
  className?: string;
}

export function ThreadSummaryPanelToggle({
  pressed,
  onClick,
  className,
}: ThreadSummaryPanelToggleProps) {
  return (
    <NodexTooltip tooltipContent="Toggle pinned summary" side="bottom">
      <button
        type="button"
        aria-label="Toggle pinned summary"
        aria-pressed={pressed}
        title="Toggle pinned summary"
        className={appendClassName(
          pressed ? SUMMARY_TOGGLE_PRESSED_CLASS : SUMMARY_TOGGLE_IDLE_CLASS,
          className,
        )}
        onClick={onClick}
      >
        <CodexPinnedSummaryIcon />
      </button>
    </NodexTooltip>
  );
}
