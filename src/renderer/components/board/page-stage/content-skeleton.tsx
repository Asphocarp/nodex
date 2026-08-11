import { cn } from "@/lib/utils";

function PageStageSkeletonBlock({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-token-foreground/5", className)}
      aria-hidden="true"
    />
  );
}

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
      ) : (
        <PageStageSkeletonBlock className="h-8 w-3/4 max-w-xl" />
      )}

      <div className="h-2" />

      <div className="mb-3">
        <div className="grid w-fit grid-cols-[auto_auto_auto_auto] gap-x-4 gap-y-1">
          {["Priority", "Status", "Estimates", "Due date"].map(
            (property) => (
              <div key={property} className="flex h-6 items-center">
                <div className="flex items-center gap-0.5 rounded-sm px-1.5">
                  <PageStageSkeletonBlock className="h-3.5 w-3.5 rounded-sm" />
                  <span className="text-sm/4.5 font-medium text-(--foreground-secondary)">
                    {property}
                  </span>
                </div>
              </div>
            ),
          )}
          <div className="flex h-7.5 items-center px-1.5">
            <PageStageSkeletonBlock className="h-5 w-14 rounded-sm" />
          </div>
          <div className="flex h-7.5 items-center px-1.5">
            <PageStageSkeletonBlock className="h-5 w-24 rounded-sm" />
          </div>
          <div className="flex h-7.5 items-center px-1.5">
            <PageStageSkeletonBlock className="h-5 w-14 rounded-sm" />
          </div>
          <div className="flex h-7.5 items-center px-1.5">
            <PageStageSkeletonBlock className="h-5 w-18 rounded-sm" />
          </div>
        </div>
      </div>

      <div className="pt-2 pb-8">
        <div className="space-y-2.5">
          <PageStageSkeletonBlock className="h-4 w-full" />
          <PageStageSkeletonBlock className="h-4 w-11/12" />
          <PageStageSkeletonBlock className="h-4 w-4/5" />
          <div className="h-2" />
          <PageStageSkeletonBlock className="h-4 w-10/12" />
          <PageStageSkeletonBlock className="h-4 w-7/12" />
        </div>
      </div>
    </div>
  );
}
