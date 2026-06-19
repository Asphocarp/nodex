import { useEffect, useMemo, useRef, useState } from "react";
import { Info, Workflow } from "lucide-react";
import { CodexThreadIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./thread-section-send-dialog-deps";

export interface ThreadSectionSendDialogState {
  sectionTitle: string;
  plainTextPreview: string;
  threadLabel: string;
  sendActionLabel: string;
  autoCreateSection: boolean;
}

interface ThreadSectionSendDialogProps {
  open: boolean;
  state: ThreadSectionSendDialogState | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { doNotAskAgain: boolean }) => void;
}

const textCountFormatter = new Intl.NumberFormat("en-US");

function summarizePlainTextPreview(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return {
      preview: "No plain-text content.",
      summary: "0 characters",
    };
  }

  const lineCount = normalized.split("\n").length;
  return {
    preview: normalized,
    summary: `${textCountFormatter.format(normalized.length)} characters · ${textCountFormatter.format(lineCount)} ${lineCount === 1 ? "line" : "lines"}`,
  };
}

export function ThreadSectionSendDialog({
  open,
  state,
  onOpenChange,
  onConfirm,
}: ThreadSectionSendDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [doNotAskAgain, setDoNotAskAgain] = useState(false);
  const preview = useMemo(
    () => summarizePlainTextPreview(state?.plainTextPreview ?? ""),
    [state?.plainTextPreview],
  );

  useEffect(() => {
    if (!open) return;
    setDoNotAskAgain(false);
  }, [open, state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl gap-2.5 p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
        <DialogHeader className="gap-0.5">
          <DialogTitle className="text-base font-medium">Send this thread section?</DialogTitle>
          <DialogDescription className="text-sm text-token-description-foreground">
            Review the plain-text preview before sending to Codex.
          </DialogDescription>
        </DialogHeader>

        {/* Metadata — single flat card, internal divider */}
        <div className="overflow-hidden rounded-lg bg-token-foreground/4 ring-[0.5px] ring-token-foreground/9">
          <div className="flex items-center gap-2 px-3 py-2">
            <CodexThreadIcon className="size-3.5 shrink-0 text-token-description-foreground" />
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-token-description-foreground">Section</span>
            <span className="ml-auto truncate text-sm text-token-foreground">{state?.sectionTitle ?? "Untitled section"}</span>
          </div>
          <div className="border-t border-token-foreground/8" />
          <div className="flex items-center gap-2 px-3 py-2">
            <Workflow className="size-3.5 shrink-0 text-token-description-foreground" />
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-token-description-foreground">Target</span>
            <div className="ml-auto min-w-0 text-right">
              <div className="truncate text-sm text-token-foreground">{state?.sendActionLabel ?? "Start a new thread"}</div>
              <div className="truncate text-xs text-token-text-secondary">{state?.threadLabel ?? "No existing thread"}</div>
            </div>
          </div>
        </div>

        {state?.autoCreateSection && (
          <div className="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--accent-blue)_8%,transparent)] px-3 py-2 text-sm text-token-foreground ring-[0.5px] ring-[color-mix(in_srgb,var(--accent-blue)_20%,transparent)]">
            <Info className="mt-0.5 size-4 shrink-0 text-(--accent-blue)" />
            <span>A new <code className="rounded bg-token-foreground/6 px-1 py-px text-xs">threadSection</code> block will be inserted before the current block when you send.</span>
          </div>
        )}

        {/* Preview — flat card with header divider */}
        <div className="overflow-hidden rounded-lg bg-token-foreground/4 ring-[0.5px] ring-token-foreground/9">
          <div className="flex items-center justify-between border-b border-token-foreground/8 px-3 py-1.5">
            <span className="text-xs font-medium text-token-description-foreground">Preview</span>
            <span className="text-xs tabular-nums text-token-description-foreground">{preview.summary}</span>
          </div>
          <pre
            className={cn(
              "scrollbar-token max-h-120 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5",
              "font-mono text-[13px] leading-5 text-token-foreground",
            )}
          >
            {preview.preview}
          </pre>
        </div>

        {/* Footer row — checkbox + actions on a single line */}
        <div className="flex items-center gap-3 pt-0.5">
          <label className="flex items-center gap-2 text-sm text-token-text-secondary">
            <button
              type="button"
              role="checkbox"
              aria-checked={doNotAskAgain}
              onClick={() => setDoNotAskAgain((v) => !v)}
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded",
                "ring-[0.5px] ring-token-foreground/20 outline-hidden",
                "focus-visible:ring-token-focus focus-visible:ring-2",
                doNotAskAgain
                  ? "bg-token-foreground text-token-background"
                  : "bg-token-foreground/6",
              )}
            >
              {doNotAskAgain && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="text-current">
                  <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span>
              Do not ask again
              <span className="text-token-description-foreground"> — revertible in Settings</span>
            </span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-full text-token-text-secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              ref={confirmButtonRef}
              className="rounded-full bg-token-foreground text-token-background hover:bg-token-foreground/90"
              onClick={() => onConfirm({ doNotAskAgain })}
            >
              Send section
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
