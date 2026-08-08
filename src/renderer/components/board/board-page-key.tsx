import { cn } from "@/lib/utils";

export function BoardPageKey({
  pageKey,
  showPageKey,
  className,
}: {
  readonly pageKey: string | null | undefined;
  readonly showPageKey: boolean;
  readonly className?: string;
}) {
  if (!showPageKey || !pageKey) return null;

  return (
    <span
      data-page-key={pageKey}
      className={cn(
        "block w-fit shrink-0 text-[11px]/4 font-medium tabular-nums text-token-description-foreground",
        className,
      )}
    >
      {pageKey}
    </span>
  );
}
