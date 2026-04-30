import { cn } from "../../../../../lib/utils";
import { MarkdownCore } from "./markdown-core";
import type { CSSProperties } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  style?: CSSProperties;
  parseIncompleteMarkdown?: boolean;
  preserveLineBreaks?: boolean;
  animateStreamingText?: boolean;
}

export function MarkdownRenderer({
  content,
  className,
  style,
  parseIncompleteMarkdown,
  preserveLineBreaks,
  animateStreamingText,
}: MarkdownRendererProps) {
  return (
    <div className={cn("codex-markdown", className)} style={style}>
      <MarkdownCore
        content={content}
        parseIncompleteMarkdown={parseIncompleteMarkdown}
        preserveLineBreaks={preserveLineBreaks}
        animateStreamingText={animateStreamingText}
      />
    </div>
  );
}
