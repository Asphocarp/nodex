export type ReviewRuntimeProbeEvent =
  | { type: "connected-render" }
  | { type: "row-render"; path: string }
  | { type: "partial-parse"; path: string }
  | { type: "diff-batch"; pathCount: number; untracked: boolean }
  | { type: "cat-file-batch"; objectCount: number }
  | { type: "full-expansion"; path: string; success: boolean }
  | { type: "abort"; operation: "diff" | "summary" }
  | { type: "stale-discard"; operation: "diff" | "full-content" };

export type ReviewRuntimeProbe = (event: ReviewRuntimeProbeEvent) => void;

let activeProbe: ReviewRuntimeProbe | null = null;

export function recordReviewRuntimeEvent(event: ReviewRuntimeProbeEvent): void {
  activeProbe?.(event);
}

/** Test/development seam. Production leaves the probe unset and pays one null check. */
export function installReviewRuntimeProbe(
  probe: ReviewRuntimeProbe,
): () => void {
  activeProbe = probe;
  return () => {
    if (activeProbe === probe) activeProbe = null;
  };
}
