import { cn } from "../../../../../lib/utils";
import { MarkdownCore } from "./markdown-core";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  parseIncompleteMarkdown?: boolean;
  preserveLineBreaks?: boolean;
  animateStreamingText?: boolean;
}

export function MarkdownRenderer({
  content,
  className,
  parseIncompleteMarkdown,
  preserveLineBreaks,
  animateStreamingText,
}: MarkdownRendererProps) {
  return (
    <div className={cn("codex-markdown", className)}>
      <MarkdownCore
        content={content}
        parseIncompleteMarkdown={parseIncompleteMarkdown}
        preserveLineBreaks={preserveLineBreaks}
        animateStreamingText={animateStreamingText}
      />
    </div>
  );
}
