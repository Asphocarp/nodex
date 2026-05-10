import { useCallback, useEffect, useRef, useState } from "react";
import { FileIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import {
  NodexDialog as Dialog,
  NodexDialogContent as DialogContent,
  NodexDialogDescription as DialogDescription,
  NodexDialogTitle as DialogTitle,
} from "@/components/ui/dialog";
import type { CodexUserAttachment, CodexUserImageAttachment } from "@/lib/types";
import { resolveAssetSourceToHttpUrl } from "@/lib/assets";
import { toApiUrl } from "@/lib/http-base";
import { cn } from "@/lib/utils";

function isDirectImageSource(source: string): boolean {
  return source.startsWith("data:image/") || source.startsWith("http://") || source.startsWith("https://");
}

function normalizeFilePointerId(value: string): string {
  return value
    .replace(/^file-service:\/\//, "")
    .replace(/^sediment:\/\//, "");
}

export function useLocalImageSource(source: string): {
  src: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const directSource = isDirectImageSource(source) || source.startsWith("nodex://assets/")
    ? resolveAssetSourceToHttpUrl(source)
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

async function resolveRemoteImageBlobUrl(pointer: string): Promise<string> {
  const fileId = normalizeFilePointerId(pointer);
  const response = await fetch(toApiUrl(`/files/download/${encodeURIComponent(fileId)}`));
  if (!response.ok) throw new Error("Could not resolve remote image");

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return URL.createObjectURL(await response.blob());
  }

  const payload = await response.json() as {
    url?: string;
    download_url?: string;
    downloadUrl?: string;
    base64?: string;
    data?: string;
    mimeType?: string;
    mime_type?: string;
  };
  const downloadUrl = payload.url ?? payload.download_url ?? payload.downloadUrl;
  if (downloadUrl) {
    const downloaded = await fetch(downloadUrl);
    if (!downloaded.ok) throw new Error("Could not download remote image");
    return URL.createObjectURL(await downloaded.blob());
  }

  const base64 = payload.base64 ?? payload.data;
  if (!base64) throw new Error("Remote image response is missing data");
  const mimeType = payload.mimeType ?? payload.mime_type ?? "image/png";
  const byteString = window.atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let index = 0; index < byteString.length; index += 1) {
    bytes[index] = byteString.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function useRemoteImageSource(pointer: string): {
  src: string | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const directSource = isDirectImageSource(pointer) || pointer.startsWith("nodex://assets/")
    ? resolveAssetSourceToHttpUrl(pointer)
    : null;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    src: directSource,
    isLoading: directSource === null,
    isError: false,
  });

  useEffect(() => {
    if (directSource !== null) {
      setState({ src: directSource, isLoading: false, isError: false });
      return;
    }

    let ignore = false;
    let objectUrl: string | null = null;
    setState({ src: null, isLoading: true, isError: false });

    void resolveRemoteImageBlobUrl(pointer)
      .then((src) => {
        objectUrl = src;
        if (!ignore) setState({ src, isLoading: false, isError: false });
      })
      .catch(() => {
        if (!ignore) setState({ src: null, isLoading: false, isError: true });
      });

    return () => {
      ignore = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [directSource, pointer, revision]);

  const refetch = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  return { ...state, refetch };
}

export function ImagePreviewDialog({
  open,
  onOpenChange,
  src,
  alt = "User attachment",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="Image preview"
        className="max-w-[min(90vw,calc(var(--thread-content-max-width)+16rem))] gap-0 overflow-hidden rounded-xl p-2"
        showCloseButton
        closeButtonAriaLabel="Close image preview"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <DialogDescription className="sr-only">Preview of the user-sent image attachment.</DialogDescription>
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          className="max-h-[82vh] w-full rounded-lg object-contain"
        />
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
      <div className="size-16 rounded-md border border-token-border bg-token-bg-tertiary text-sm text-token-description-foreground">
        <div className="flex size-full items-center justify-center">...</div>
      </div>
    );
  }

  return <UserImageButton src={src} fit="contain" bordered={false} onImageError={refetch} />;
}

function UserFileAttachmentChip({ attachment }: { attachment: Extract<CodexUserAttachment, { type: "file" }> }) {
  const Icon = attachment.sourceKind === "skill" ? SparklesIcon : FileIcon;

  return (
    <div className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-lg border border-token-border bg-token-foreground/5 px-2 text-xs text-token-foreground">
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
