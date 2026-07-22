import { cn } from "@/lib/utils";
import { LazyVirtualizedTextViewer } from "@/components/ui/lazy-virtualized-text-viewer";

interface PageStageRawContentProps {
  content: string;
  className?: string;
}

export function PageStageRawContent({
  content,
  className,
}: PageStageRawContentProps) {
  const hasContent = content.length > 0;

  return (
    <section
      aria-label="Raw page content"
      className={cn(
        "flex h-[70vh] max-h-[48rem] min-h-72 flex-col overflow-hidden rounded-xl border-[0.5px] border-(--border) bg-foreground-2",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-(--border) px-3 py-2">
        <div className="text-xs font-medium tracking-wide text-(--foreground-secondary) uppercase">
          Raw format
        </div>
        <div className="text-[11px] text-(--foreground-tertiary)">
          Read-only
        </div>
      </div>

      {hasContent ? (
        <LazyVirtualizedTextViewer
          value={content}
          ariaLabel="Raw page source"
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="px-3 py-4 font-mono text-[12px]/5 text-(--foreground-tertiary)">
          Description is empty.
        </div>
      )}
    </section>
  );
}
