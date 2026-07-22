import { useId, useRef, useState } from "react";
import { CodeBracketsIcon } from "@/components/shared/icons";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogHeader as DialogHeader,
  NodexDialogTitle as DialogTitle,
} from "../../../../../components/ui/dialog";
import { NodexTooltip } from "../../../../../components/ui/tooltip";
import { cn } from "../../../../../lib/utils";
import { CopyMessageActionButton } from "../thread-message-actions";
import {
  LazyVirtualizedTextViewer,
  preloadVirtualizedTextViewer,
} from "@/components/ui/lazy-virtualized-text-viewer";
import {
  buildTextPreview,
  INLINE_TEXT_PREVIEW_MAX_CHARS,
  type TextPreview,
} from "@/lib/text-preview";

const electronToolIconSizeClassName = `electron:[&>svg]:${"icon-sm"}`;

export function stringifyToolCallValue(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry,
      2,
    ) ?? String(value);
  } catch {
    return String(value);
  }
}

export function ToolCallCodePanel({
  title,
  preview,
  getCopyText,
  getFullText,
  bodyClassName,
  preClassName,
  stickyHeaderClassName,
}: {
  title: string;
  preview: TextPreview;
  getCopyText?: () => string;
  getFullText?: () => string;
  bodyClassName?: string;
  preClassName?: string;
  stickyHeaderClassName?: string;
}) {
  const [fullTextOpen, setFullTextOpen] = useState(false);
  const boundedPreview = preview.text.length <= INLINE_TEXT_PREVIEW_MAX_CHARS
    ? preview
    : buildTextPreview(preview.text, INLINE_TEXT_PREVIEW_MAX_CHARS);
  return (
    <div
      className="bg-token-text-code-block-background border-token-border-heavy relative overflow-clip rounded-lg border contain-inline-size dark"
      data-theme="dark"
    >
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between py-1 ps-2 pe-2 font-sans text-sm text-token-description-foreground select-none",
          stickyHeaderClassName,
        )}
      >
        <div className="min-w-0 truncate">{title}</div>
        <div className="flex items-center">
          {boundedPreview.kind === "omitted" && getFullText ? (
            <ToolCallRawDialog
              open={fullTextOpen}
              onOpenChange={setFullTextOpen}
              title={`Full ${title}`}
              getRawText={getFullText}
              triggerLabel={`View full ${title}`}
              triggerKind="text"
              triggerText="View full"
            />
          ) : null}
          {getCopyText ? (
            <CopyMessageActionButton
              getText={getCopyText}
              label="Copy"
              copiedLabel="Copied"
              tooltipLabel="Copy"
              copiedTooltipLabel="Copied"
              className="enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background"
            />
          ) : null}
        </div>
      </div>
      <div className={cn("text-size-chat max-h-48 overflow-y-auto p-2", bodyClassName)} dir="ltr">
        <pre className={cn("m-0 whitespace-pre-wrap break-words", preClassName)}>{boundedPreview.text}</pre>
      </div>
    </div>
  );
}

export function ToolCallRawDialog({
  open,
  onOpenChange,
  title,
  getRawText,
  getRawValue,
  triggerLabel,
  triggerKind = "icon",
  triggerText = "Raw",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  getRawText?: () => string;
  getRawValue?: () => unknown;
  triggerLabel: string;
  triggerKind?: "icon" | "text";
  triggerText?: string;
}) {
  const dialogId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const trigger = (
    <button
      type="button"
      className={cn(
        "border-token-border user-select-none no-drag cursor-interaction flex items-center justify-center gap-1 border border-transparent text-token-description-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background",
        triggerKind === "icon"
          ? "rounded-full p-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 electron:rounded-md electron:p-1"
          : "rounded-md px-1.5 py-1 text-xs font-medium",
        triggerKind === "icon" && electronToolIconSizeClassName,
      )}
      aria-label={triggerLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={dialogId}
      data-state={open ? "open" : "closed"}
      onClick={() => {
        onOpenChange(true);
      }}
      onPointerEnter={preloadVirtualizedTextViewer}
      onFocus={preloadVirtualizedTextViewer}
    >
      <CodeBracketsIcon />
      {triggerKind === "text" ? <span>{triggerText}</span> : null}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {triggerKind === "icon" ? (
        <NodexTooltip tooltipContent={triggerLabel} side="top" delayDuration={0}>
          {trigger}
        </NodexTooltip>
      ) : trigger}
      <DialogContent
        id={dialogId}
        ref={contentRef}
        tabIndex={-1}
        showCloseButton={false}
        aria-describedby={undefined}
        className="codex-dialog fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 gap-0 rounded-3xl border-none bg-token-dropdown-background/90 p-0 text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-xl outline-none sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <div className="flex flex-col gap-0 px-5 py-5 text-base leading-normal tracking-normal">
          <div className="flex w-full flex-col pt-3 first:pt-0">
            <DialogHeader className="gap-0 text-left">
              <DialogTitle className="heading-dialog min-w-0 font-semibold">
                {title}
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="flex h-[min(65vh,40rem)] w-full min-h-72 flex-col pt-3 first:pt-0">
            {open ? (
              <ToolCallRawContent
                title={title}
                getRawText={getRawText}
                getRawValue={getRawValue}
              />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolCallRawContent({
  title,
  getRawText,
  getRawValue,
}: {
  readonly title: string;
  readonly getRawText?: () => string;
  readonly getRawValue?: () => unknown;
}) {
  const [rawText] = useState(() => (
    getRawText ? getRawText() : stringifyToolCallValue(getRawValue?.())
  ));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-token-text-code-block-background dark" data-theme="dark">
      <div className="flex h-8 shrink-0 items-center justify-between px-2 text-sm text-token-description-foreground">
        <span>json</span>
        <CopyMessageActionButton
          getText={() => rawText}
          label="Copy"
          copiedLabel="Copied"
          tooltipLabel="Copy"
          copiedTooltipLabel="Copied"
        />
      </div>
      <LazyVirtualizedTextViewer
        value={rawText}
        ariaLabel={title}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
