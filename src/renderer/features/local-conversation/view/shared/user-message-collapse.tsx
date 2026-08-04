import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/shared/icons";
import { cn } from "../../../../lib/utils";
import { MarkdownRenderer } from "./markdown/markdown-renderer";
import { useClippedFocusSafety } from "./use-clipped-focus-safety";
import { useContentOverflow } from "./use-content-overflow";
import {
  LazySourceViewer,
  preloadSourceViewer,
} from "@/components/ui/lazy-source-viewer";
import {
  NodexDialog,
  NodexDialogBody,
  NodexDialogContent,
  NodexDialogFrame,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { buildTextPreview, INLINE_TEXT_PREVIEW_MAX_CHARS } from "@/lib/text-preview";

export const DEFAULT_USER_MESSAGE_COLLAPSED_LINES = 20;

interface UserMessageTextProps {
  text: string;
  collapsedLineCount?: number;
  cwd?: string | null;
  projectWorkspacePath?: string | null;
}

const USER_MESSAGE_COLLAPSED_STYLE: CSSProperties = {
  overflow: "hidden",
};

function LargeUserMessageText({
  text,
  collapsedLineCount,
}: {
  readonly text: string;
  readonly collapsedLineCount: number;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = buildTextPreview(text, INLINE_TEXT_PREVIEW_MAX_CHARS);

  return (
    <div className="flex w-full flex-col items-start gap-1.5">
      <div
        className="scrollbar-token text-size-chat w-full overflow-auto whitespace-pre-wrap"
        style={{ maxHeight: `${collapsedLineCount * 1.5}em` }}
      >
        {preview.text}
      </div>
      <button
        type="button"
        className="text-size-chat cursor-interaction text-token-description-foreground hover:text-token-foreground"
        onClick={() => setDialogOpen(true)}
        onPointerEnter={preloadSourceViewer}
        onFocus={preloadSourceViewer}
      >
        View full message
      </button>
      <NodexDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <NodexDialogContent
          aria-describedby={undefined}
          className="flex h-[min(80vh,48rem)] w-[min(92vw,64rem)] max-w-none flex-col gap-0"
        >
          <NodexDialogFrame className="h-full min-h-0 p-0">
            <NodexDialogHeader className="shrink-0 px-4 py-3">
              <NodexDialogTitle>Full message</NodexDialogTitle>
              <div className="text-xs tabular-nums text-token-description-foreground">
                {text.length.toLocaleString()} characters
              </div>
            </NodexDialogHeader>
            <NodexDialogBody className="min-h-0 flex-1 !pt-0">
              <LazySourceViewer
                value={text}
                ariaLabel="Full user message"
                className="min-h-0 flex-1"
              />
            </NodexDialogBody>
          </NodexDialogFrame>
        </NodexDialogContent>
      </NodexDialog>
    </div>
  );
}

function CollapsibleUserMessageText({
  text,
  collapsedLineCount,
  cwd,
  projectWorkspacePath,
}: Required<Pick<UserMessageTextProps, "text" | "collapsedLineCount">>
  & Pick<UserMessageTextProps, "cwd" | "projectWorkspacePath">) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const { collapsedHeightPx, isOverflowing } = useContentOverflow(
    contentRef,
    collapsedLineCount,
  );

  const expanded = expandedText === text;
  const collapsed = isOverflowing && !expanded;
  useClippedFocusSafety(contentRef, collapsed);
  const collapsedStyle = collapsed && collapsedHeightPx !== null
    ? {
        ...USER_MESSAGE_COLLAPSED_STYLE,
        maxHeight: collapsedHeightPx,
      }
    : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        ref={contentRef}
        className="text-size-chat relative w-full min-w-0"
        style={collapsedStyle}
      >
        <MarkdownRenderer
          content={text}
          preserveLineBreaks
          cwd={cwd}
          projectWorkspacePath={projectWorkspacePath}
          className="codex-markdown-user text-size-chat"
        />
      </div>
      {!isOverflowing ? null : (
        <button
          type="button"
          aria-expanded={expanded}
          className="text-size-chat mt-1.5 inline-flex cursor-interaction items-center gap-1 self-start text-token-description-foreground hover:text-token-foreground"
          onClick={() => setExpandedText((current) => current === text ? null : text)}
        >
          <span>{expanded ? "Show less" : "Show more"}</span>
          <ChevronDownIcon
            className={cn(
              "icon-2xs transition-transform duration-150",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </div>
  );
}

export function UserMessageText({
  text,
  collapsedLineCount = DEFAULT_USER_MESSAGE_COLLAPSED_LINES,
  cwd,
  projectWorkspacePath,
}: UserMessageTextProps) {
  if (text.length > INLINE_TEXT_PREVIEW_MAX_CHARS) {
    return (
      <LargeUserMessageText text={text} collapsedLineCount={collapsedLineCount} />
    );
  }

  return (
    <CollapsibleUserMessageText
      text={text}
      collapsedLineCount={collapsedLineCount}
      cwd={cwd}
      projectWorkspacePath={projectWorkspacePath}
    />
  );
}
