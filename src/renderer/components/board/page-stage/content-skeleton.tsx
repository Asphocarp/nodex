import { LoadingResultsShimmer } from "@/components/ui/loading-results-shimmer";

export function PageStageContentSkeleton({
  titleSnapshot,
  announce = true,
}: {
  readonly titleSnapshot?: string;
  readonly announce?: boolean;
}) {
  const title = titleSnapshot?.trim();
  const label = title ? `Loading ${title}` : "Loading page";

  return (
    <div
      className="w-full select-none"
      {...(announce
        ? { role: "status", "aria-busy": true, "aria-label": label }
        : { "aria-hidden": true })}
    >
      <div className="h-toolbar-sm" />

      {title ? (
        <div className="min-h-8 w-full px-0.5 pt-0.75 text-xl/snug-plus font-bold text-(--foreground)">
          {title}
        </div>
      ) : null}

      <LoadingResultsShimmer
        className="max-w-3xl pt-4 pb-8"
        lineClassName="rounded-md"
        lines={3}
        maxWidth={title ? 96 : 82}
        minWidth={title ? 58 : 64}
        seed={title ? `page-stage:${title}` : "page-stage:untitled"}
        size="lg"
      />
    </div>
  );
}
