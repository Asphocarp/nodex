import { useMemo } from "react";
import { Streamdown } from "streamdown";
import { MARKDOWN_CONTENT_CLASS_NAME } from "@/components/shared/inline-markdown-code";
import { FileLinkWorkspaceProvider } from "@/components/shared/file-link-anchor";
import { useDocumentTheme } from "@/lib/use-document-theme";
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
  cwd?: string | null;
  projectWorkspacePath?: string | null;
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
  cwd,
  projectWorkspacePath,
}: MarkdownCoreProps) {
  const theme = useDocumentTheme();
  const normalizedContent = useMemo(() => normalizeMarkdown(content), [content]);
  const shouldAnimateStreamingText = animateStreamingText && parseIncompleteMarkdown;

  return (
    <FileLinkWorkspaceProvider cwd={cwd} workspacePath={projectWorkspacePath}>
      <Streamdown
        components={streamdownComponents}
        plugins={streamdownPlugins}
        remarkPlugins={preserveLineBreaks ? streamdownRemarkPluginsWithBreaks : undefined}
        mermaid={{
          config: { theme: theme === "dark" ? "dark" : "neutral" },
          errorComponent: StreamdownMermaidError,
        }}
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
        lineNumbers={false}
        className={`
          [&>*:first-child]:mt-0
          [&>*:last-child]:mb-0
          ${MARKDOWN_CONTENT_CLASS_NAME}
        `}
        controls={{
          table: false,
          code: {
            copy: true,
            download: false,
          },
          mermaid: true,
        }}
      >
        {normalizedContent}
      </Streamdown>
    </FileLinkWorkspaceProvider>
  );
}
