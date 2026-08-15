import {
  forwardRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { NodexButton } from "@/components/ui/button";
import {
  CheckmarkIcon,
  LinkToolbarCopyIcon,
  LinkToolbarDeleteIcon,
  LinkToolbarGlobeIcon,
} from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface NfmCompactLinkToolbarProps {
  href: string;
  canOpen: boolean;
  openTooltip: ReactNode;
  copyLabel: string;
  copyTooltip: ReactNode;
  copiedLabel: string;
  copiedTooltip: ReactNode;
  copyState?: "idle" | "copied";
  editTooltip: ReactNode;
  editLabel: string;
  disabledReason?: ReactNode;
  onOpenLink: () => void;
  onCopyLink: () => void;
  onEditLink: () => void;
}

export function NfmCompactLinkToolbar({
  href,
  canOpen,
  openTooltip,
  copyLabel,
  copyTooltip,
  copiedLabel,
  copiedTooltip,
  copyState = "idle",
  editTooltip,
  editLabel,
  disabledReason,
  onOpenLink,
  onCopyLink,
  onEditLink,
}: NfmCompactLinkToolbarProps) {
  const linkTooltip = disabledReason ?? openTooltip;
  const isCopied = copyState === "copied";
  const handleActionPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // Keep the editor from treating toolbar interactions as selection changes.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      role="toolbar"
      aria-label="Link actions"
      data-testid="nfm-compact-link-toolbar"
      contentEditable={false}
      className="inline-flex max-w-[min(32rem,calc(100vw-24px))] items-center gap-0.5 rounded-[14px] bg-token-dropdown-background/95 p-0.5 text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-sm"
    >
      <NodexTooltip tooltipContent={linkTooltip} side="top" delayDuration={0}>
        <button
          type="button"
          contentEditable={false}
          aria-disabled={!canOpen}
          aria-label={typeof linkTooltip === "string" ? linkTooltip : href}
          title={typeof disabledReason === "string" ? disabledReason : href}
          onPointerDown={handleActionPointerDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canOpen) return;
            onOpenLink();
          }}
          className={cn(
            "inline-flex min-w-0 flex-1 items-center gap-1 rounded-[10px] py-1 pl-1.5 pr-1.5 text-left outline-hidden",
            canOpen
              ? "cursor-pointer text-token-text-secondary"
              : "cursor-default text-token-text-secondary/80",
            "hover:bg-[color-mix(in_srgb,var(--color-token-foreground)_6%,transparent)] hover:text-token-foreground focus-visible:bg-[color-mix(in_srgb,var(--color-token-foreground)_6%,transparent)] focus-visible:text-token-foreground",
            !canOpen && "hover:bg-transparent focus-visible:bg-transparent",
          )}
        >
          <LinkToolbarGlobeIcon className="size-[14px] shrink-0 text-token-text-secondary" />
          <span className="min-w-0 truncate text-[12px] leading-4">{href}</span>
        </button>
      </NodexTooltip>

      <NodexTooltip tooltipContent={isCopied ? copiedTooltip : copyTooltip} side="top" delayDuration={0}>
        <button
          type="button"
          contentEditable={false}
          aria-label={isCopied ? copiedLabel : copyLabel}
          onPointerDown={handleActionPointerDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCopyLink();
          }}
          className={cn(
            "inline-flex h-6.5 shrink-0 items-center justify-center rounded-[9px] px-2 text-[12px] leading-4 text-token-text-secondary outline-hidden",
            "hover:bg-[color-mix(in_srgb,var(--color-token-foreground)_6%,transparent)] hover:text-token-foreground focus-visible:bg-[color-mix(in_srgb,var(--color-token-foreground)_6%,transparent)] focus-visible:text-token-foreground",
            isCopied && "bg-token-foreground/10 text-token-foreground",
            "w-7",
          )}
        >
          {isCopied ? (
            <CheckmarkIcon className="size-[14px]" />
          ) : (
            <LinkToolbarCopyIcon className="size-[15px]" />
          )}
        </button>
      </NodexTooltip>

      <NodexTooltip tooltipContent={editTooltip} side="top" delayDuration={0}>
        <button
          type="button"
          contentEditable={false}
          aria-label={typeof editTooltip === "string" ? editTooltip : editLabel}
          onPointerDown={handleActionPointerDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEditLink();
          }}
          className={cn(
            "inline-flex h-6.5 shrink-0 items-center justify-center rounded-[9px] px-2 text-[12px] leading-4 text-token-text-secondary outline-hidden",
            "hover:bg-[color-mix(in_srgb,var(--color-token-foreground)_6%,transparent)] hover:text-token-foreground focus-visible:bg-[color-mix(in_srgb,var(--color-token-foreground)_6%,transparent)] focus-visible:text-token-foreground",
            "min-w-[3rem]",
          )}
        >
          {editLabel}
        </button>
      </NodexTooltip>
    </div>
  );
}

export interface NfmLinkEditDialogSurfaceProps {
  urlLabel: string;
  titleLabel: string;
  urlPlaceholder: string;
  titlePlaceholder: string;
  urlValue: string;
  titleValue: string;
  removeLabel: string;
  onUrlChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onUrlKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveLink: () => void;
}

export interface NfmCreateLinkDialogSurfaceProps {
  urlLabel: string;
  urlPlaceholder: string;
  urlValue: string;
  submitLabel: string;
  onUrlChange: (value: string) => void;
  onUrlKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const NfmLinkEditDialogSurface = forwardRef<
  HTMLDivElement,
  NfmLinkEditDialogSurfaceProps
>(function NfmLinkEditDialogSurface(
  {
    urlLabel,
    titleLabel,
    urlPlaceholder,
    titlePlaceholder,
    urlValue,
    titleValue,
    removeLabel,
    onUrlChange,
    onTitleChange,
    onUrlKeyDown,
    onTitleKeyDown,
    onRemoveLink,
  },
  ref,
) {
  const handleSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  const handleActionPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Edit link"
      data-testid="nfm-link-edit-dialog"
      contentEditable={false}
      onPointerDown={handleSurfacePointerDown}
      className="flex w-[19.5rem] max-w-[min(19.5rem,calc(100vw-24px))] flex-col rounded-[16px] bg-token-dropdown-background/95 text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-sm"
    >
      <div className="flex flex-col gap-3 px-4 pt-4 pb-2.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] leading-4 font-medium text-token-text-secondary">{urlLabel}</span>
          <div className="relative flex w-full items-center rounded-sm border-[0.5px] border-token-border bg-token-input-background shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-token-foreground)_2%,transparent)] focus-within:border-token-focus-border focus-within:ring-1 focus-within:ring-token-focus-border">
            <input
              autoFocus
              type="text"
              value={urlValue}
              placeholder={urlPlaceholder}
              onChange={(event) => {
                onUrlChange(event.currentTarget.value);
              }}
              onKeyDown={onUrlKeyDown}
              className="w-full appearance-none border-none bg-transparent px-1.5 py-1.5 text-[13px] leading-5 text-token-foreground outline-none placeholder:text-token-input-placeholder-foreground"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] leading-4 font-medium text-token-text-secondary">{titleLabel}</span>
          <div className="relative flex w-full items-center rounded-sm border-[0.5px] border-token-border bg-token-input-background shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-token-foreground)_2%,transparent)] focus-within:border-token-focus-border focus-within:ring-1 focus-within:ring-token-focus-border">
            <input
              type="text"
              value={titleValue}
              placeholder={titlePlaceholder}
              onChange={(event) => {
                onTitleChange(event.currentTarget.value);
              }}
              onKeyDown={onTitleKeyDown}
              className="w-full appearance-none border-none bg-transparent px-1.5 py-1.5 text-[13px] leading-5 text-token-foreground outline-none placeholder:text-token-input-placeholder-foreground"
            />
          </div>
        </label>
      </div>

      <div className="px-4">
        <div className="h-px bg-[color-mix(in_srgb,var(--color-token-foreground)_8%,transparent)]" />
      </div>

      <button
        type="button"
        contentEditable={false}
        aria-label={removeLabel}
        onPointerDown={handleActionPointerDown}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemoveLink();
        }}
        className="inline-flex py-2.5 items-center gap-2.5 px-4 text-left text-[13px] text-token-foreground outline-hidden hover:bg-[color-mix(in_srgb,var(--color-token-foreground)_4%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--color-token-foreground)_4%,transparent)]"
      >
        <LinkToolbarDeleteIcon className="size-4 text-token-description-foreground" />
        <span>{removeLabel}</span>
      </button>
    </div>
  );
});

export const NfmCreateLinkDialogSurface = forwardRef<
  HTMLDivElement,
  NfmCreateLinkDialogSurfaceProps
>(function NfmCreateLinkDialogSurface(
  {
    urlLabel,
    urlPlaceholder,
    urlValue,
    submitLabel,
    onUrlChange,
    onUrlKeyDown,
    onSubmit,
    secondaryActionLabel,
    onSecondaryAction,
  },
  ref,
) {
  const handleSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={submitLabel}
      data-testid="nfm-create-link-dialog"
      contentEditable={false}
      onPointerDown={handleSurfacePointerDown}
      className="flex w-[16.5rem] max-w-[min(16.5rem,calc(100vw-24px))] flex-col rounded-[14px] bg-token-dropdown-background/95 text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-sm"
    >
      <div className="flex flex-col gap-2.5 px-3 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] leading-4 font-medium text-token-text-secondary">{urlLabel}</span>
          <div className="relative flex w-full items-center rounded-md border-[0.5px] border-token-border bg-token-input-background shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-token-foreground)_2%,transparent)] focus-within:border-token-focus-border focus-within:ring-1 focus-within:ring-token-focus-border">
            <input
              autoFocus
              type="text"
              value={urlValue}
              placeholder={urlPlaceholder}
              onChange={(event) => {
                onUrlChange(event.currentTarget.value);
              }}
              onKeyDown={onUrlKeyDown}
              className="w-full appearance-none border-none bg-transparent px-2 py-1.5 text-[13px] leading-5 text-token-foreground outline-none placeholder:text-token-input-placeholder-foreground"
            />
          </div>
        </label>
      </div>
      <div className="px-3 pb-3">
        <NodexButton
          variant="secondary"
          size="xs"
          className="w-full justify-center rounded-md"
          onClick={onSubmit}
        >
          {submitLabel}
        </NodexButton>
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="mt-1.5 inline-flex h-7 w-full items-center justify-center rounded-md text-xs text-token-text-secondary outline-hidden hover:bg-token-foreground/5 hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-token-focus-border"
          >
            {secondaryActionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
});
