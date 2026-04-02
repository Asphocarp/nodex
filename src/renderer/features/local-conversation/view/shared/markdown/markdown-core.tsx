import { useMemo } from "react";
import { Streamdown } from "streamdown";
import { INLINE_MARKDOWN_ROOT_CLASS_NAME } from "@/components/shared/inline-markdown-code";
import {
  StreamdownMermaidError,
  streamdownComponents,
  streamdownPlugins,
  streamdownRemarkPluginsWithBreaks,
} from "../../../../../lib/streamdown";

interface MarkdownCoreProps {
  content: string;
  parseIncompleteMarkdown?: boolean;
  preserveLineBreaks?: boolean;
  animateStreamingText?: boolean;
}

function normalizeMarkdown(content: string): string {
  const normalizedNewlines = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u2028\u2029\u0085]/g, "\n");

  return normalizedNewlines.replace(/\n{3,}/g, "\n\n");
}

export function MarkdownCore({
  content,
  parseIncompleteMarkdown = false,
  preserveLineBreaks = false,
  animateStreamingText = false,
}: MarkdownCoreProps) {
  const normalizedContent = useMemo(() => normalizeMarkdown(content), [content]);
  const shouldAnimateStreamingText = animateStreamingText && parseIncompleteMarkdown;

  return (
    <Streamdown
      components={streamdownComponents}
      plugins={streamdownPlugins}
      remarkPlugins={preserveLineBreaks ? streamdownRemarkPluginsWithBreaks : undefined}
      mermaid={{ errorComponent: StreamdownMermaidError }}
      parseIncompleteMarkdown={parseIncompleteMarkdown}
      mode={parseIncompleteMarkdown ? "streaming" : "static"}
      animated={
        shouldAnimateStreamingText
          ? {
              animation: "fadeIn",
              sep: "word",
              duration: 200,
              easing: "cubic-bezier(.37, .55, .86, .88)",
            }
          : undefined
      }
      isAnimating={shouldAnimateStreamingText}
      className={`space-y-1 ${INLINE_MARKDOWN_ROOT_CLASS_NAME}`}
      controls={{ table: false, code: true, mermaid: true }}
    >
      {normalizedContent}
    </Streamdown>
  );
}
