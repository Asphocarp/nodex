import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import remarkBreaks from "remark-breaks";
import {
  defaultRemarkPlugins,
  type Components,
  type MermaidErrorComponentProps,
} from "streamdown";
import type { Pluggable } from "unified";
import {
  InlineMarkdownCode,
  INLINE_MARKDOWN_HEADING_CLASS_NAME,
} from "@/components/shared/inline-markdown-code";
import { FileLinkAnchor } from "@/components/shared/file-link-anchor";
import { NFM_CODE_THEME_PAIR } from "./syntax-highlighting";
import { cn } from "./utils";

import "katex/dist/katex.min.css";

const baseStreamdownCodePlugin = createCodePlugin({
  themes: [NFM_CODE_THEME_PAIR[0], NFM_CODE_THEME_PAIR[1]],
});

type StreamdownHighlightOptions = Parameters<typeof baseStreamdownCodePlugin.highlight>[0];
type StreamdownHighlightResult = Exclude<
  ReturnType<typeof baseStreamdownCodePlugin.highlight>,
  null
>;

function createPlainTextHighlightResult(code: string): StreamdownHighlightResult {
  return {
    bg: "transparent",
    fg: "inherit",
    tokens: code.split("\n").map((line) => [
      {
        content: line,
        color: "inherit",
        bgColor: "transparent",
        htmlStyle: {},
        offset: 0,
      },
    ]),
  };
}

export const streamdownCodePlugin = {
  ...baseStreamdownCodePlugin,
  highlight(
    options: StreamdownHighlightOptions,
    callback?: Parameters<typeof baseStreamdownCodePlugin.highlight>[1],
  ) {
    if (!baseStreamdownCodePlugin.supportsLanguage(options.language)) {
      return createPlainTextHighlightResult(options.code);
    }
    return baseStreamdownCodePlugin.highlight(options, callback);
  },
};

export const streamdownPlugins = {
  code: streamdownCodePlugin,
  mermaid: createMermaidPlugin({
    config: {
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
      suppressErrorRendering: true,
    },
  }),
  math: createMathPlugin({
    errorColor: "var(--foreground-tertiary)",
  }),
  cjk,
} as const;

function createHeadingComponent(
  tagName: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
): NonNullable<Components["h1"]> {
  return function StreamdownHeading({ children, className, node, ...props }) {
    void node;
    const Tag = tagName;
    return (
      <Tag
        {...props}
        className={cn(className, INLINE_MARKDOWN_HEADING_CLASS_NAME)}
      >
        {children}
      </Tag>
    );
  };
}

export const streamdownComponents: Components = {
  a: ({ href, children, className }) => (
    <FileLinkAnchor href={href} className={className} showLocalFileTooltip>
      {children}
    </FileLinkAnchor>
  ),
  h1: createHeadingComponent("h1"),
  h2: createHeadingComponent("h2"),
  h3: createHeadingComponent("h3"),
  h4: createHeadingComponent("h4"),
  h5: createHeadingComponent("h5"),
  h6: createHeadingComponent("h6"),
  inlineCode: ({ children, className, node, ...props }) => {
    void node;

    return (
      <InlineMarkdownCode {...props} className={className}>
        {children}
      </InlineMarkdownCode>
    );
  },
};

export const streamdownRemarkPluginsWithBreaks: Pluggable[] = [
  ...Object.values(defaultRemarkPlugins),
  remarkBreaks,
];

export function StreamdownMermaidError({ error }: MermaidErrorComponentProps) {
  return (
    <div className="rounded-md border border-(--destructive)/30 bg-(--destructive)/10 px-3 py-2 text-sm text-(--destructive)">
      Mermaid Error: {error}
    </div>
  );
}
