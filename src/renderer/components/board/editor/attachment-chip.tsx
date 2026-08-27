import { FileIcon, FolderIcon, FolderOpenIcon, PageIcon } from "@/components/shared/icons";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import { ArrowUpRight, Copy, Link2 } from "@/components/shared/icons/generic-icons";

import { NodexPopover, NodexPopoverContent, NodexPopoverTrigger } from "@/components/ui/popover";
import { NodexTooltip } from "@/components/ui/tooltip";
import {
  inlineTintedChipIconClassName,
  inlineTintedChipLabelClassName,
  inlineTintedChipVariants,
} from "@/components/ui/inline-tinted-chip";
import { readManagedAssetPreview } from "@/lib/assets";
import { invoke } from "@/lib/api";
import { useFileReferenceRouter } from "@/lib/file-reference-router";
import { useFileLinkOpener } from "@/lib/use-file-link-opener";
import { cn } from "@/lib/utils";
import { attachmentInlineContentConfig } from "../../../../shared/block-documents/blocknote-schema-config";
import { formatAttachmentBytes } from "./attachment-chip-format";
import { getAttachmentTooltipLines } from "./attachment-chip-tooltip";
import type { ManagedFolderManifest } from "../../../../shared/managed-assets";

type AttachmentPreview =
  | { type: "text"; content: string; truncated: boolean }
  | { type: "folder"; manifest: ManagedFolderManifest }
  | null;

interface AttachmentProps {
  kind: "text" | "file" | "folder";
  mode: "materialized" | "link";
  source: string;
  name: string;
  mimeType?: string;
  bytes?: number;
  origin?: string;
}

const ATTACHMENT_INLINE_LABEL_LIMIT = 48;

export function isTextLikeMimeType(mimeType: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/sql" ||
    mimeType === "application/toml" ||
    mimeType === "application/xml" ||
    mimeType === "application/yaml"
  );
}

function getAttachmentSizeLabel(props: Pick<AttachmentProps, "kind" | "bytes">): string {
  if (props.kind === "folder") return "";
  return formatAttachmentBytes(props.bytes);
}

export function getAttachmentLabel(
  props: Pick<AttachmentProps, "kind" | "name">,
  maxLength = ATTACHMENT_INLINE_LABEL_LIMIT,
): string {
  const base = props.name.trim();
  const fallback = props.kind === "text" ? "Pasted text" : "Untitled attachment";
  const label = base.length > 0 ? base : fallback;
  return label.length > maxLength ? `${label.slice(0, maxLength).trimEnd()}...` : label;
}

function getAttachmentIcon(kind: AttachmentProps["kind"], mode: AttachmentProps["mode"]) {
  if (mode === "link") return Link2;
  if (kind === "folder") return FolderIcon;
  if (kind === "file") return FileIcon;
  return PageIcon;
}

function canPreviewAttachment(props: AttachmentProps): boolean {
  if (props.mode !== "materialized") return false;
  if (!props.source.startsWith("nodex://assets/")) return false;
  if (props.kind === "folder" || props.kind === "text") return true;
  return isTextLikeMimeType(props.mimeType ?? "");
}

async function loadAttachmentPreview(props: AttachmentProps): Promise<AttachmentPreview> {
  if (!canPreviewAttachment(props)) return null;

  try {
    const preview = await readManagedAssetPreview({
      source: props.source,
      kind: props.kind === "folder" ? "folder" : "text",
    });
    return preview.kind === "folder"
      ? { type: "folder", manifest: preview.manifest }
      : {
          type: "text",
          content: preview.content,
          truncated: preview.truncated,
        };
  } catch {
    return null;
  }
}

function AttachmentPopover({
  props,
  onPrimaryOpen,
}: {
  props: AttachmentProps;
  onPrimaryOpen: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<AttachmentPreview>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { opener } = useFileLinkOpener();

  useEffect(() => {
    if (!canPreviewAttachment(props)) return;

    let cancelled = false;
    const run = async () => {
      setPreviewLoading(true);
      try {
        const nextPreview = await loadAttachmentPreview(props);
        if (!cancelled) {
          setPreview(nextPreview);
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [props]);

  const sizeLabel = getAttachmentSizeLabel(props);
  const stateLabel = props.mode === "materialized" ? "Saved in Nodex" : "Linked to the original";
  const hasOriginal =
    typeof props.origin === "string" && props.origin.length > 0 && props.origin !== props.source;

  const resolvePrimaryPath = useCallback(async (): Promise<string | null> => {
    if (props.mode === "link") return props.source || null;
    const resolved = await invoke("asset:resolve-path", props.source);
    return typeof resolved === "string" && resolved.trim().length > 0 ? resolved : null;
  }, [props.mode, props.source]);

  const openPath = useCallback(
    async (path: string, nextOpener = opener) => {
      await invoke("shell:open-file-link", { path }, nextOpener);
    },
    [opener],
  );

  const handleReveal = useCallback(async () => {
    const targetPath = await resolvePrimaryPath();
    if (!targetPath) return;
    await openPath(targetPath, "fileManager");
  }, [openPath, resolvePrimaryPath]);

  const handleCopyPath = useCallback(async () => {
    const targetPath = await resolvePrimaryPath();
    await navigator.clipboard.writeText(targetPath || props.source);
  }, [props.source, resolvePrimaryPath]);

  const handleOpenOriginal = useCallback(async () => {
    if (!props.origin) return;
    await openPath(props.origin);
  }, [openPath, props.origin]);

  return (
    <div className="w-[min(32rem,calc(100vw-2rem))] p-1 text-sm">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 rounded-lg bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] p-1.5 text-[color-mix(in_srgb,var(--foreground)_76%,transparent)]">
          {(() => {
            const Icon = getAttachmentIcon(props.kind, props.mode);
            return <Icon className="size-3.5" />;
          })()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--foreground)]">
            {props.name || "Untitled attachment"}
          </div>
          <div className="mt-0.5 text-xs text-[color-mix(in_srgb,var(--foreground)_54%,transparent)]">
            {props.kind}
            {sizeLabel ? ` • ${sizeLabel}` : ""} • {stateLabel}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-xs text-[color-mix(in_srgb,var(--foreground)_58%,transparent)]">
        <div className="truncate">Source: {props.source}</div>
        {hasOriginal && <div className="truncate">Original: {props.origin}</div>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <AttachmentActionButton label="Open" icon={ArrowUpRight} onClick={onPrimaryOpen} />
        <AttachmentActionButton label="Reveal" icon={FolderOpenIcon} onClick={handleReveal} />
        <AttachmentActionButton label="Copy path" icon={Copy} onClick={handleCopyPath} />
        {hasOriginal && (
          <AttachmentActionButton label="Open original" icon={Link2} onClick={handleOpenOriginal} />
        )}
      </div>

      {canPreviewAttachment(props) && (
        <div className="mt-3 overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
          {previewLoading && (
            <div className="px-3 py-2 text-xs text-[color-mix(in_srgb,var(--foreground)_54%,transparent)]">
              Loading preview...
            </div>
          )}

          {!previewLoading && preview?.type === "text" && (
            <div className="px-3 py-2">
              <pre className="scrollbar-token max-h-64 overflow-auto whitespace-pre-wrap break-words font-[var(--font-mono)] text-[12px] leading-5 text-[color-mix(in_srgb,var(--foreground)_88%,transparent)]">
                {preview.content}
              </pre>
              {preview.truncated && (
                <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
                  Preview limited to 200 lines or 64 KiB.
                </p>
              )}
            </div>
          )}

          {!previewLoading && preview?.type === "folder" && (
            <div className="px-3 py-2">
              <div className="max-h-64 space-y-1 overflow-auto font-[var(--font-mono)] text-[12px] leading-5 text-[color-mix(in_srgb,var(--foreground)_84%,transparent)]">
                {preview.manifest.entries.map((entry) => (
                  <div key={`${entry.kind}:${entry.path}`} className="truncate">
                    {entry.kind === "folder" ? "📁" : "·"} {entry.path}
                    {entry.kind === "file" && typeof entry.bytes === "number"
                      ? ` (${formatAttachmentBytes(entry.bytes)})`
                      : ""}
                  </div>
                ))}
              </div>
              {preview.manifest.truncated && (
                <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
                  Snapshot limited to {preview.manifest.maxEntries} entries and{" "}
                  {preview.manifest.maxDepth} levels.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!canPreviewAttachment(props) && props.mode === "link" && (
        <p className="mt-3 text-xs text-[color-mix(in_srgb,var(--foreground)_52%,transparent)]">
          This attachment keeps a link to the original location instead of copying its contents into
          Nodex.
        </p>
      )}

      {!canPreviewAttachment(props) && props.mode === "materialized" && (
        <p className="mt-3 text-xs text-[color-mix(in_srgb,var(--foreground)_52%,transparent)]">
          This saved attachment doesn&apos;t have an inline preview.
        </p>
      )}
    </div>
  );
}

function AttachmentActionButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] px-2.5 py-1 text-xs text-[color-mix(in_srgb,var(--foreground)_72%,transparent)] hover:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] hover:text-[var(--foreground)]"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void onClick();
      }}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}

function AttachmentInlineContent({ inlineContent }: { inlineContent: { props: AttachmentProps } }) {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => getAttachmentLabel(inlineContent.props), [inlineContent.props]);
  const tooltipLines = getAttachmentTooltipLines(inlineContent.props);
  const fileReferenceRouter = useFileReferenceRouter();

  const resolvePrimaryPath = useCallback(async (): Promise<string | null> => {
    if (inlineContent.props.mode === "link") return inlineContent.props.source || null;
    const resolved = await invoke("asset:resolve-path", inlineContent.props.source);
    return typeof resolved === "string" && resolved.trim().length > 0 ? resolved : null;
  }, [inlineContent.props.mode, inlineContent.props.source]);

  const handlePrimaryOpen = useCallback(async () => {
    const path = await resolvePrimaryPath();
    if (!path) return;
    await fileReferenceRouter.open({ path }, { title: label });
  }, [fileReferenceRouter, label, resolvePrimaryPath]);

  const Icon = getAttachmentIcon(inlineContent.props.kind, inlineContent.props.mode);

  return (
    <NodexPopover open={open} onOpenChange={setOpen}>
      <NodexTooltip
        tooltipContent={
          <div className="space-y-0.5">
            <div className="font-medium text-[var(--foreground)]">{tooltipLines.primary}</div>
            <div className="text-xs text-[color-mix(in_srgb,var(--foreground)_58%,transparent)]">
              {tooltipLines.secondary}
            </div>
          </div>
        }
        side="top"
        delay={0}
      >
        <span className="inline align-baseline">
          <NodexPopoverTrigger>
            <button
              type="button"
              contentEditable={false}
              className={cn(
                inlineTintedChipVariants({ tone: "purple", interactive: true }),
                "blend",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpen((current) => !current);
              }}
            >
              <Icon className={inlineTintedChipIconClassName} />
              <span className={cn(inlineTintedChipLabelClassName, "blend truncate")}>{label}</span>
              {inlineContent.props.mode === "link" && (
                <Link2 className="-mr-0.5 ml-0.5 inline-block size-3.5 shrink-0 self-center" />
              )}
            </button>
          </NodexPopoverTrigger>
        </span>
      </NodexTooltip>

      <NodexPopoverContent side="top" align="start" className="w-full" initialFocus={false}>
        <AttachmentPopover props={inlineContent.props} onPrimaryOpen={handlePrimaryOpen} />
      </NodexPopoverContent>
    </NodexPopover>
  );
}

export function createAttachmentInlineContentSpec() {
  return createReactInlineContentSpec(attachmentInlineContentConfig, {
    render: ({ inlineContent }) => (
      <AttachmentInlineContent inlineContent={inlineContent as { props: AttachmentProps }} />
    ),
    toExternalHTML: ({ inlineContent }) => {
      const Icon = getAttachmentIcon(
        (inlineContent as { props: AttachmentProps }).props.kind,
        (inlineContent as { props: AttachmentProps }).props.mode,
      );
      const label = getAttachmentLabel((inlineContent as { props: AttachmentProps }).props, 80);
      const modeLabel =
        (inlineContent as { props: AttachmentProps }).props.mode === "link"
          ? "Linked attachment"
          : "Saved attachment";

      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] px-2 py-0.5 text-xs text-[var(--foreground)]">
          <Icon className="size-3" />
          <span>{label}</span>
          <span className="opacity-60">({modeLabel})</span>
        </span>
      );
    },
  });
}
