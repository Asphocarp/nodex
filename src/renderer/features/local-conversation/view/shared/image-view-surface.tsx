import { useCallback, useState, type KeyboardEvent } from "react";
import { ImageIcon } from "lucide-react";
import { buildFileUrl } from "../../../../../shared/file-link-openers";
import { ImagePreviewDialog } from "./user-message-attachments";
import { ThreadActivityShell, ThreadRichActivityHeader } from "./tools/tool-primitives";

export function resolveInspectedImageSource(source: string): string {
  if (/^(?:blob:|data:image\/|file:|https?:\/\/|nodex:\/\/)/iu.test(source)) return source;
  if (source.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(source)) {
    return buildFileUrl({ path: source });
  }
  return source;
}

function InspectedImageThumbnail({
  alt,
  onOpen,
  source,
}: {
  alt: string;
  onOpen: () => void;
  source: string;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  };

  return (
    <div
      className="size-20 cursor-interaction rounded-lg border border-token-border-heavy focus:outline-none focus-visible:ring-1 focus-visible:ring-token-focus-border"
      role="button"
      tabIndex={0}
      aria-label={alt}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <img
        src={source}
        className="h-full w-full rounded-md object-cover"
        referrerPolicy="no-referrer"
        alt={alt}
      />
    </div>
  );
}

export function ImageViewSurface({ imagePaths }: { imagePaths: readonly string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const sources = imagePaths.map(resolveInspectedImageSource);
  const canExpand = sources.length > 0;
  const summary = sources.length === 1 ? "Viewed an image" : `Viewed ${sources.length} images`;
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setOpenIndex(null);
  }, []);
  const activeSource = openIndex === null ? null : sources[openIndex] ?? null;

  return (
    <>
      <ThreadActivityShell
        className="overflow-clip"
        header={(
          <ThreadRichActivityHeader
            icon={<ImageIcon aria-hidden="true" className="icon-xs shrink-0 text-token-conversation-body" />}
            summary={<span className="block truncate text-token-conversation-summary-trailing">{summary}</span>}
            disclosure={canExpand ? {
              expanded,
              onToggle: () => {
                setExpanded((current) => !current);
              },
            } : undefined}
          />
        )}
        body={expanded ? (
          <div className="min-w-0">
            <div className="hide-scrollbar flex max-w-full overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2">
                {sources.map((source, index) => (
                  <InspectedImageThumbnail
                    key={`${source}:${index}`}
                    alt="Inspected image"
                    source={source}
                    onOpen={() => {
                      setOpenIndex(index);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      />
      {activeSource ? (
        <ImagePreviewDialog
          open
          onOpenChange={handleOpenChange}
          src={activeSource}
          alt="Inspected image"
          onPreviousImage={openIndex !== null && openIndex > 0 ? () => {
            setOpenIndex(openIndex - 1);
          } : undefined}
          onNextImage={openIndex !== null && openIndex < sources.length - 1 ? () => {
            setOpenIndex(openIndex + 1);
          } : undefined}
        />
      ) : null}
    </>
  );
}
