import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./inline-markdown-code.css";

export const INLINE_MARKDOWN_ROOT_CLASS_NAME = "markdown-content";
export const INLINE_MARKDOWN_CLASS_NAME = "inline-markdown";
export const INLINE_MARKDOWN_HEADING_CLASS_NAME = "heading-inline-code";
export const INLINE_MARKDOWN_VISUAL_CLASS_NAME =
  "text-size-chat-sm font-mono blend bg-token-text-code-block-background rounded-sm px-1.5 py-0.5 leading-none extension:bg-token-foreground/10 electron:bg-token-list-hover-background/60";

interface InlineMarkdownCodeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  node?: unknown;
}

export function InlineMarkdownCode({
  children,
  className,
  node,
  ...props
}: InlineMarkdownCodeProps) {
  void node;

  return (
    <span
      {...props}
      className={cn(
        INLINE_MARKDOWN_CLASS_NAME,
        INLINE_MARKDOWN_VISUAL_CLASS_NAME,
        className,
      )}
    >
      {children}
    </span>
  );
}
