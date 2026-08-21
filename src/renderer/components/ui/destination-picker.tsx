import type { KeyboardEvent, ReactNode } from "react";

import { ActivitySpinnerIcon, SearchIcon } from "@/components/shared/icons";
import { StatusIcon } from "@/lib/status-presentation";
import { cn } from "@/lib/utils";

interface NodexDestinationPickerProps {
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly query: string;
  readonly inputId: string;
  readonly listboxId: string;
  readonly activeDescendantId?: string;
  readonly busy?: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly dialogRole?: "dialog" | "presentation";
  readonly autoFocus?: boolean;
}

export function NodexDestinationPicker({
  ariaLabel,
  placeholder,
  query,
  inputId,
  listboxId,
  activeDescendantId,
  busy = false,
  onQueryChange,
  onKeyDown,
  children,
  className,
  dialogRole = "dialog",
  autoFocus = false,
}: NodexDestinationPickerProps) {
  return (
    <div
      role={dialogRole}
      aria-label={dialogRole === "dialog" ? ariaLabel : undefined}
      className={cn(
        "flex max-h-[70vh] w-[330px] max-w-[calc(100vw-24px)] flex-col overflow-hidden text-[14px] leading-[1.2]",
        className,
      )}
      contentEditable={false}
    >
      <div className="flex h-[38px] shrink-0 items-center gap-1.5 px-2 py-[5px]">
        <SearchIcon
          className="size-4 shrink-0 text-token-description-foreground"
          aria-hidden="true"
        />
        <input
          id={inputId}
          autoFocus={autoFocus}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-activedescendant={activeDescendantId}
          value={query}
          placeholder={placeholder}
          className="h-7 min-w-0 flex-1 rounded-[7px] bg-transparent px-1.5 py-[3px] text-[14px] text-token-foreground outline-hidden placeholder:text-token-description-foreground focus:bg-token-foreground/5"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            onKeyDown(event);
          }}
        />
      </div>
      <div className="notion-scroller vertical h-[374px] min-h-0 overflow-y-auto pb-3">
        <div id={listboxId} role="listbox" aria-labelledby={inputId} aria-busy={busy}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function NodexDestinationPickerSection({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="pb-1">
      <div className="flex h-7 items-end px-[14px] pb-1 pt-3 text-[12px] leading-4 font-medium text-token-description-foreground">
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
      <div className="flex flex-col gap-px px-1">{children}</div>
    </div>
  );
}

export function NodexDestinationPickerPageRowContent({
  title,
  statusId,
  statusLabel,
  projectName,
  accepting = false,
}: {
  readonly title: string;
  readonly statusId: string;
  readonly statusLabel: string;
  readonly projectName?: string;
  readonly accepting?: boolean;
}) {
  return (
    <>
      <span
        className="flex h-[18px] w-[22px] shrink-0 items-center justify-center"
        title={statusLabel}
      >
        <StatusIcon statusId={statusId} label={statusLabel} className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {projectName ? (
        <span className="ml-1 max-w-[112px] shrink truncate text-[12px] leading-4 text-token-description-foreground">
          {projectName}
        </span>
      ) : null}
      {accepting ? (
        <ActivitySpinnerIcon className="size-3.5 shrink-0 text-token-description-foreground" />
      ) : null}
    </>
  );
}

export function NodexDestinationPickerStatus({
  children,
  role,
}: {
  readonly children: ReactNode;
  readonly role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className="flex min-h-9 items-center px-3 py-2 text-[13px] leading-5 text-token-description-foreground"
    >
      {children}
    </div>
  );
}
