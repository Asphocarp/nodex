import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import "./loading-motion.css";

export interface LoadingPlaceholderProps extends ComponentPropsWithoutRef<"div"> {
  animate?: boolean;
}

export function LoadingPlaceholder({
  animate = true,
  className,
  ...props
}: LoadingPlaceholderProps) {
  return (
    <div
      className={cn("nodex-loading-placeholder", className)}
      data-animate={animate ? "true" : undefined}
      {...props}
    />
  );
}
