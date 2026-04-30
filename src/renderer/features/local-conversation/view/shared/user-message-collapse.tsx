import type { CSSProperties } from "react";
import { ChevronDownIcon } from "@/components/shared/icons";
import { cn } from "../../../../lib/utils";
import { MarkdownRenderer } from "./markdown/markdown-renderer";
import { useMeasuredTextCollapse } from "./use-measured-text-collapse";

export const DEFAULT_USER_MESSAGE_COLLAPSED_LINES = 20;

interface UserMessageTextProps {
  text: string;
  collapsedLineCount?: number;
}

const USER_MESSAGE_COLLAPSED_STYLE: CSSProperties = {
  display: "-webkit-box",
  overflow: "hidden",
  WebkitBoxOrient: "vertical",
};

export function UserMessageText({
  text,
  collapsedLineCount = DEFAULT_USER_MESSAGE_COLLAPSED_LINES,
}: UserMessageTextProps) {
  const {
    setTextContentMeasurementRef,
    collapseState,
    handleToggleExpansion,
  } = useMeasuredTextCollapse({
    text,
    collapsedLineCount,
    fallbackFontSizePx: 13,
  });

  const expanded = collapseState === "expanded";
  const collapsedStyle = collapseState === "collapsed"
    ? {
        ...USER_MESSAGE_COLLAPSED_STYLE,
        WebkitLineClamp: collapsedLineCount,
      }
    : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        ref={setTextContentMeasurementRef}
        className="text-size-chat relative w-full min-w-0"
      >
        <MarkdownRenderer
          content={text}
          preserveLineBreaks
          className="codex-markdown-user text-size-chat"
          style={collapsedStyle}
        />
      </div>
      {collapseState === "uncollapsible" ? null : (
        <button
          type="button"
          aria-expanded={expanded}
          className="text-size-chat mt-1.5 inline-flex cursor-interaction items-center gap-1 self-start text-token-description-foreground hover:text-token-foreground"
          onClick={handleToggleExpansion}
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
