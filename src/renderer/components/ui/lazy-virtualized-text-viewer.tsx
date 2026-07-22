import { lazy, Suspense } from "react";
import type { VirtualizedTextViewerProps } from "./virtualized-text-viewer";

const loadVirtualizedTextViewer = () => import("./virtualized-text-viewer");
const VirtualizedTextViewerLazy = lazy(async () => ({
  default: (await loadVirtualizedTextViewer()).VirtualizedTextViewer,
}));

export function preloadVirtualizedTextViewer(): void {
  void loadVirtualizedTextViewer();
}

export function LazyVirtualizedTextViewer(props: VirtualizedTextViewerProps) {
  return (
    <Suspense fallback={(
      <div
        className="h-full min-h-24 animate-pulse bg-token-foreground/5"
        aria-label={`Loading ${props.ariaLabel}`}
      />
    )}>
      <VirtualizedTextViewerLazy {...props} />
    </Suspense>
  );
}
