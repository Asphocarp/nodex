import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, LoaderCircleIcon, SparklesIcon } from "@/components/shared/icons/generic-icons";
import { FileIcon } from "@/components/shared/icons";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogDescription as DialogDescription,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import type { CodexUserAttachment, CodexUserImageAttachment } from "@/lib/types";
import { resolveAssetSourceToDisplayUrl } from "@/lib/assets";
import { cn } from "@/lib/utils";
import { useConversationImageAsset } from "./use-conversation-image-asset";

function isDirectImageSource(source: string): boolean {
  return source.startsWith("data:image/") || source.startsWith("http://") || source.startsWith("https://");
}

export function useLocalImageSource(source: string): {
  src: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const directSource = isDirectImageSource(source) || source.startsWith("nodex://assets/")
    ? resolveAssetSourceToDisplayUrl(source)
    : null;
  const [state, setState] = useState<{
    src: string | null;
    isLoading: boolean;
    isError: boolean;
  }>({
    src: directSource,
    isLoading: false,
    isError: directSource === null,
  });

  useEffect(() => {
    if (directSource !== null) {
      setState({ src: directSource, isLoading: false, isError: false });
      return;
    }

    setState({ src: null, isLoading: false, isError: true });
  }, [directSource, source]);

  return state;
}

export function useRemoteImageSource(pointer: string): {
  src: string | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const asset = useConversationImageAsset(pointer, {
    shouldLoadFileDataUrl: false,
  });
  return {
    src: asset.previewSrc,
    isLoading: asset.isLoading,
    isError: asset.isError,
    refetch: asset.refetch,
  };
}

export function ImagePreviewDialog({
  open,
  onOpenChange,
  src,
  downloadSrc = src,
  downloadFileName,
  alt = "User attachment",
  onPreviousImage,
  onNextImage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  downloadSrc?: string;
  downloadFileName?: string;
  alt?: string;
  onPreviousImage?: () => void;
  onNextImage?: () => void;
}) {
  const resolvedDownloadFileName = downloadFileName ?? alt;
  const handleDownload = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!downloadSrc.startsWith("data:")) return;

    event.preventDefault();
    const [metadata = "", base64 = ""] = downloadSrc.split(",", 2);
    const mimeType = /^data:([^;,]+)/u.exec(metadata)?.[1] ?? "application/octet-stream";
    const bytes = metadata.includes(";base64")
      ? Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(base64));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = resolvedDownloadFileName;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && onPreviousImage) {
        event.preventDefault();
        onPreviousImage();
        return;
      }
      if (event.key === "ArrowRight" && onNextImage) {
        event.preventDefault();
        onNextImage();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onNextImage, onPreviousImage, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="Image preview"
        className="w-[min(90vw,calc(var(--thread-content-max-width)+16rem))] max-w-none rounded-xl p-2"
        showCloseButton
        closeButtonAriaLabel="Close image preview"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <DialogDescription className="sr-only">Preview of the selected image.</DialogDescription>
        <a
          href={downloadSrc}
          download={resolvedDownloadFileName}
          aria-label="Download image"
          className="absolute top-3 right-11 z-20 flex size-8 cursor-interaction items-center justify-center rounded-md text-token-text-secondary hover:bg-token-bg-tertiary hover:text-token-text-primary focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none"
          onClick={handleDownload}
        >
          <DownloadIcon className="icon-xs" aria-hidden="true" />
        </a>
        <div className="relative flex min-h-0 items-center justify-center">
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            className="max-h-[82vh] w-full rounded-lg object-contain"
          />
          {onPreviousImage ? (
            <button
              type="button"
              aria-label="Previous image"
              className="absolute left-3 flex size-8 cursor-interaction items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm hover:bg-black/70 focus-visible:ring-1 focus-visible:ring-white focus-visible:outline-none"
              onClick={onPreviousImage}
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          {onNextImage ? (
            <button
              type="button"
              aria-label="Next image"
              className="absolute right-3 flex size-8 cursor-interaction items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm hover:bg-black/70 focus-visible:ring-1 focus-visible:ring-white focus-visible:outline-none"
              onClick={onNextImage}
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImageLoadingTile({ label }: { label: string }) {
  return (
    <div
      className="size-16 rounded-lg border border-token-border bg-token-bg-tertiary text-token-description-foreground"
      aria-label={label}
    >
      <div className="flex size-full items-center justify-center">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
      </div>
    </div>
  );
}

function ImageErrorTile() {
  return (
    <div
      className="size-16 rounded-lg border border-token-border bg-token-bg-tertiary text-token-description-foreground"
      aria-label="Image unavailable"
    >
      <div className="flex size-full items-center justify-center text-sm">!</div>
    </div>
  );
}

function UserImageButton({
  src,
  fit,
  bordered,
  onImageError,
}: {
  src: string;
  fit: "cover" | "contain";
  bordered: boolean;
  onImageError?: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setPreviewOpen(nextOpen);
    if (nextOpen) return;
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-composer-attachment-pill="true"
        aria-label="Open image preview"
        className={cn(
          "size-16 cursor-interaction overflow-hidden rounded-lg focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:outline-none",
          bordered && "border border-token-border",
        )}
        onClick={() => setPreviewOpen(true)}
      >
        <img
          src={src}
          width={64}
          height={64}
          alt="User attachment"
          referrerPolicy="no-referrer"
          className={cn(
            "h-full w-full rounded-md",
            fit === "cover" ? "object-cover" : "object-contain",
          )}
          onError={onImageError}
        />
      </button>
      <ImagePreviewDialog
        open={previewOpen}
        onOpenChange={handleOpenChange}
        src={src}
      />
    </>
  );
}

export function LocalUserImageAttachment({ attachment }: { attachment: CodexUserImageAttachment }) {
  const { src, isLoading, isError } = useLocalImageSource(attachment.source);

  if (isLoading) return <ImageLoadingTile label="Loading user attachment" />;
  if (!src) return isError ? <ImageErrorTile /> : <ImageLoadingTile label="Loading user attachment" />;

  return <UserImageButton src={src} fit="cover" bordered />;
}

export function RemoteUserImageAttachment({ attachment }: { attachment: CodexUserImageAttachment }) {
  const { src, isLoading, isError, refetch } = useRemoteImageSource(attachment.source);

  if (isError) return null;
  if (isLoading || !src) {
    return (
      <div
        aria-label="Loading user attachment"
        className="size-16 rounded-md border border-token-border bg-token-bg-tertiary text-sm text-token-description-foreground"
      >
        <div className="flex size-full items-center justify-center">...</div>
      </div>
    );
  }

  return <UserImageButton src={src} fit="contain" bordered={false} onImageError={refetch} />;
}

function UserFileAttachmentChip({ attachment }: { attachment: Extract<CodexUserAttachment, { type: "file" }> }) {
  const Icon = attachment.sourceKind === "skill" ? SparklesIcon : FileIcon;

  return (
    <div
      data-composer-attachment-pill="true"
      className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-lg border border-token-border bg-token-foreground/5 px-2 text-xs text-token-foreground"
    >
      <Icon className="size-3 shrink-0 text-token-description-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{attachment.label}</span>
    </div>
  );
}

export function UserAttachmentStrip({ attachments }: { attachments: CodexUserAttachment[] }) {
  if (attachments.length === 0) return null;

  const remoteOnly = attachments.every((attachment) =>
    attachment.type === "image" && attachment.sourceKind === "remote");

  return (
    <div
      className={cn(
        remoteOnly
          ? "flex flex-wrap gap-2 self-end"
          : "flex flex-wrap items-end justify-end gap-2 self-end",
      )}
      data-user-attachment-strip="true"
    >
      {attachments.map((attachment) => {
        if (attachment.type === "file") {
          return <UserFileAttachmentChip key={attachment.id} attachment={attachment} />;
        }

        return attachment.sourceKind === "remote"
          ? <RemoteUserImageAttachment key={attachment.id} attachment={attachment} />
          : <LocalUserImageAttachment key={attachment.id} attachment={attachment} />;
      })}
    </div>
  );
}
