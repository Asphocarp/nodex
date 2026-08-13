import type { CSSProperties, ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { buildLoadingResultsWidths } from "./loading-results-shimmer-model";
import "./loading-motion.css";

const LOADING_RESULTS_STAGGER_MS = 120;

export interface LoadingResultsShimmerProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  lineClassName?: string;
  lines?: number;
  maxWidth?: number;
  minWidth?: number;
  seed?: string;
  size?: "sm" | "md" | "lg";
}

interface LoadingResultsStyle extends CSSProperties {
  "--loading-results-shimmer-delay": string;
}

export function LoadingResultsShimmer({
  className,
  lineClassName,
  lines = 3,
  maxWidth = 100,
  minWidth = 55,
  seed = "shimmer-lines",
  size = "md",
  ...props
}: LoadingResultsShimmerProps) {
  const widths = buildLoadingResultsWidths({
    count: lines,
    maxWidth,
    minWidth,
    seed,
  });

  return (
    <div className={cn("flex w-full flex-col items-start gap-2", className)} {...props}>
      {widths.map((width, index) => (
        <div
          aria-hidden="true"
          className={cn("nodex-loading-results-shimmer", lineClassName)}
          data-loading-results-line={index}
          data-size={size}
          key={index}
          style={{
            width: `${Math.max(1, Math.min(100, width))}%`,
            "--loading-results-shimmer-delay": `${-index * LOADING_RESULTS_STAGGER_MS}ms`,
          } as LoadingResultsStyle}
        />
      ))}
    </div>
  );
}
