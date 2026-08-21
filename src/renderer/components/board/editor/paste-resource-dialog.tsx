import { FileIcon, FolderIcon, PageIcon } from "@/components/shared/icons";
import { Link2 } from "@/components/shared/icons/generic-icons";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { canMaterializePasteResourceItems, type PasteResourceDialogState } from "./paste-resource";
import {
  Dialog,
  DialogAction,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFrame,
  DialogHeader,
  DialogTitle,
} from "./paste-resource-dialog-deps";

interface PasteResourceDialogProps {
  open: boolean;
  state: PasteResourceDialogState | null;
  pending?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onChooseMode: (mode: "materialized" | "link") => void;
  onContinueInline?: () => void;
}

const TEXT_PREVIEW_CHAR_LIMIT = 100_000;
const textCountFormatter = new Intl.NumberFormat("en-US");

function getItemIcon(kind: string, allowLink: boolean) {
  if (allowLink) return Link2;
  if (kind === "folder") return FolderIcon;
  if (kind === "file") return FileIcon;
  return PageIcon;
}

function getTextPreview(text: string) {
  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  if (!normalizedText) {
    return {
      preview: "Pasted text",
      summary: "Empty text",
    };
  }

  const preview =
    normalizedText.length > TEXT_PREVIEW_CHAR_LIMIT
      ? `${normalizedText.slice(0, TEXT_PREVIEW_CHAR_LIMIT).trimEnd()}...`
      : normalizedText;
  const lineCount = normalizedText.split("\n").length;
  const lineLabel = lineCount === 1 ? "line" : "lines";

  return {
    preview,
    summary: `${textCountFormatter.format(text.length)} characters • ${textCountFormatter.format(lineCount)} ${lineLabel}`,
  };
}

export function PasteResourceDialog({
  open,
  state,
  pending = false,
  error = null,
  onOpenChange,
  onCloseAutoFocus,
  onChooseMode,
  onContinueInline,
}: PasteResourceDialogProps) {
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const count = state?.items.length ?? 0;
  const canSaveCopy = canMaterializePasteResourceItems(state?.items ?? []);
  const isFolderOnly =
    (state?.items.length ?? 0) > 0 && (state?.items ?? []).every((item) => item.kind === "folder");
  const title = state?.textPayload
    ? "This text is too large to paste"
    : count === 1
      ? "Add this to the note?"
      : `Add ${count} items to the note?`;
  const description = state?.textPayload
    ? "Save a copy to assets and link to it, paste it anyway, or cancel."
    : isFolderOnly
      ? "Keep a link to the original folder, or cancel."
      : !canSaveCopy
        ? "Keep links to the original items, or cancel."
        : "Save a copy or keep a link to the original location.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="wide"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primaryActionRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogFrame>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <DialogBody className="gap-3">
            <div className="overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--foreground)_9%,transparent)]">
              {(state?.items ?? []).map((item, index) => {
                const Icon = getItemIcon(item.kind, Boolean(item.path));
                const textPreview =
                  item.kind === "text" && state?.textPayload
                    ? getTextPreview(state.textPayload)
                    : null;

                return (
                  <div
                    key={`${item.kind}:${item.name}:${item.path ?? index}`}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5",
                      index > 0 &&
                        "border-t border-[color-mix(in_srgb,var(--foreground)_8%,transparent)]",
                    )}
                  >
                    <div className="rounded-lg bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] p-1.5 text-[color-mix(in_srgb,var(--foreground)_74%,transparent)]">
                      <Icon className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {textPreview ? (
                        <div className="scrollbar-token max-h-120 overflow-y-auto whitespace-pre-wrap break-words pr-1 font-mono text-[13px] leading-5 text-[var(--foreground)]">
                          {textPreview.preview}
                        </div>
                      ) : (
                        <div className="truncate text-sm font-medium text-[var(--foreground)]">
                          {item.name}
                        </div>
                      )}
                      <div className="truncate text-xs text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
                        {textPreview?.summary ?? item.path ?? item.mimeType ?? "Pasted text"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="rounded-lg bg-token-charts-red/10 px-3 py-2 text-sm text-token-charts-red">
                {error}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogAction disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </DialogAction>
            {state?.allowLink && (
              <DialogAction
                ref={!canSaveCopy ? primaryActionRef : undefined}
                disabled={pending}
                onClick={() => onChooseMode("link")}
              >
                {pending ? "Working..." : "Keep as Link"}
              </DialogAction>
            )}
            {state?.textPayload && (
              <DialogAction disabled={pending} onClick={() => onContinueInline?.()}>
                {pending ? "Working..." : "Paste Anyway"}
              </DialogAction>
            )}
            {canSaveCopy && (
              <DialogAction
                tone="primary"
                ref={primaryActionRef}
                disabled={pending}
                onClick={() => onChooseMode("materialized")}
              >
                {pending ? "Saving..." : "Save a Copy"}
              </DialogAction>
            )}
          </DialogFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  );
}
