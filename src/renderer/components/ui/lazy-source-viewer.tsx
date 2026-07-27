import { lazy, Suspense } from "react";
import type { SourceViewerProps } from "./source-viewer";

const loadSourceViewer = () => import("./source-viewer");
const SourceViewerLazy = lazy(async () => ({
  default: (await loadSourceViewer()).SourceViewer,
}));

export function preloadSourceViewer(): void {
  void loadSourceViewer();
}

export function LazySourceViewer(props: SourceViewerProps) {
  return (
    <Suspense
      fallback={(
        <div
          className="h-full min-h-24 animate-pulse bg-token-foreground/5"
          aria-label={`Loading ${props.ariaLabel}`}
        />
      )}
    >
      <SourceViewerLazy {...props} />
    </Suspense>
  );
}
