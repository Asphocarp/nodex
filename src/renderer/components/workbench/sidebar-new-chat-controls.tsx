import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { CodexNewChatIcon } from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const SIDEBAR_NEW_CHAT_ROW_CLASS = "focus-visible:outline-token-border relative h-token-nav-row px-row-x py-row-y cursor-interaction shrink-0 items-center overflow-hidden rounded-lg text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 gap-2 flex w-full hover:bg-token-list-hover-background group";
export const SIDEBAR_PROJECT_NEW_CHAT_BUTTON_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-muted-foreground enabled:hover:bg-transparent data-[state=open]:bg-transparent hover:text-token-foreground border-transparent electron:p-1 electron:[&>svg]:icon-sm flex items-center justify-center p-0.5 h-6 w-6 rounded-md !p-1";

function stopProjectActionPropagation(
  event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>,
) {
  event.stopPropagation();
}

export function SidebarNewChatButton({
  shortcutLabel,
  onClick,
}: {
  shortcutLabel: ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="shrink-0 px-row-x" data-testid="sidebar-new-chat-row-wrapper">
      <div className="flex flex-col gap-1">
        <div className="flex flex-col gap-px">
          <button
            type="button"
            className={SIDEBAR_NEW_CHAT_ROW_CLASS}
            onClick={onClick}
          >
            <div className="flex min-w-0 items-center text-base gap-2 flex-1 text-token-foreground">
              <CodexNewChatIcon />
              <span className="truncate">New chat</span>
            </div>
            <span
              aria-hidden="true"
              className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <kbd className="inline-flex !rounded-md !border-0 !bg-current/10 !font-sans !text-xs !text-current !shadow-none !px-1.5 !py-0.5 !leading-none">
                {shortcutLabel}
              </kbd>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SidebarProjectNewChatButton({
  label,
  disabledLabel,
  disabled,
  className,
  onClick,
}: {
  label: string;
  disabledLabel?: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <div className="relative mr-0.5 h-6 w-6 shrink-0" data-testid="project-new-chat-action-shell">
      <NodexTooltip
        delayOpen
        tooltipContent={disabled ? disabledLabel ?? label : label}
        side="right"
      >
        <span className={cn("inline-flex opacity-0 group-hover/folder-row:opacity-100", className)}>
          <button
            type="button"
            className={SIDEBAR_PROJECT_NEW_CHAT_BUTTON_CLASS}
            aria-label={label}
            disabled={disabled}
            onPointerDown={stopProjectActionPropagation}
            onMouseDown={stopProjectActionPropagation}
            onKeyDown={stopProjectActionPropagation}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <CodexNewChatIcon />
          </button>
        </span>
      </NodexTooltip>
    </div>
  );
}
