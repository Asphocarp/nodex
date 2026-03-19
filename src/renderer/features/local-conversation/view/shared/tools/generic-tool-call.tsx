import { useEffect, useId, useMemo, useState } from "react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { MeasuredExpand } from "../measured-expand";
import { ToolErrorDetail, ToolJsonDetail } from "./tool-primitives";
import { humanizeIdentifier } from "./tool-call-utils";

interface GenericToolCallProps {
  item: CodexTranscriptEntry;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

function ChevronRightIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        "text-token-input-placeholder-foreground icon-2xs flex-shrink-0 transition-all duration-300 opacity-0 group-hover/summary:opacity-100",
        expanded && "opacity-100 rotate-90",
      )}
      aria-hidden="true"
    >
      <path
        d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatGenericSummaryDetail(item: CodexTranscriptEntry): string {
  const tool = item.toolCall;
  if (tool) {
    const toolName = humanizeIdentifier(tool.toolName);
    if (tool.server) {
      const serverName = humanizeIdentifier(tool.server);
      if (toolName.length > 0 && serverName.length > 0) return `${toolName} tool from ${serverName}`;
      if (toolName.length > 0) return `${toolName} tool`;
      if (serverName.length > 0) return `Tool from ${serverName}`;
    }

    if (toolName.length > 0) return toolName;
    if (tool.toolName.trim().length > 0) return tool.toolName.trim();
  }

  if (item.markdownText?.trim()) return item.markdownText.trim();
  return "Tool call";
}

function hasFallbackBody(item: CodexTranscriptEntry): boolean {
  return item.toolCall?.args !== undefined
    || item.toolCall?.result !== undefined
    || Boolean(item.toolCall?.error)
    || item.rawItem !== undefined;
}

export function GenericToolCall({
  item,
  expanded,
  onExpandedChange,
}: GenericToolCallProps) {
  const bodyId = useId();
  const hasBody = hasFallbackBody(item);
  const completed = item.status !== "inProgress";
  const isExpandable = completed && hasBody;
  const [isExpanded, setIsExpanded] = useState(Boolean(expanded));

  useEffect(() => {
    if (expanded === undefined) return;
    setIsExpanded(expanded);
  }, [expanded]);

  const summaryVerb = completed ? "Called" : "Calling";
  const summaryDetail = useMemo(() => formatGenericSummaryDetail(item), [item]);

  function updateExpanded(nextValue: boolean) {
    if (expanded === undefined) {
      setIsExpanded(nextValue);
    }
    onExpandedChange?.(nextValue);
  }

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="group flex flex-col">
        <button
          type="button"
          className={cn(
            "group/summary flex w-full items-center gap-1.5 text-left",
            isExpandable ? "cursor-interaction" : "cursor-default",
          )}
          aria-expanded={isExpandable ? isExpanded : false}
          aria-controls={isExpandable ? bodyId : undefined}
          onClick={() => {
            if (!isExpandable) return;
            updateExpanded(!isExpanded);
          }}
        >
          <span className={cn("text-size-chat flex min-w-0 items-center gap-1", !completed && "loading-shimmer-pure-text")}>
            <span className="text-token-description-foreground/90 group-hover:text-token-foreground flex-shrink-0">
              {summaryVerb}
            </span>
            <span className="text-token-foreground/40 group-hover:text-token-foreground truncate">
              {summaryDetail}
            </span>
          </span>
          {isExpandable ? <ChevronRightIcon expanded={isExpanded} /> : null}
        </button>
        <MeasuredExpand open={isExpandable && isExpanded} className="overflow-hidden" innerClassName="flex flex-col gap-0.5 pt-1">
          <div id={bodyId} className="flex flex-col gap-0.5">
            {item.toolCall?.error ? <ToolErrorDetail error={item.toolCall.error} className="mb-2" /> : null}
            {item.toolCall?.args !== undefined ? <ToolJsonDetail label="Arguments" value={item.toolCall.args} /> : null}
            {item.toolCall?.result !== undefined ? <ToolJsonDetail label="Result" value={item.toolCall.result} /> : null}
            {item.rawItem !== undefined ? <ToolJsonDetail label="Raw Item" value={item.rawItem} /> : null}
          </div>
        </MeasuredExpand>
      </div>
    </div>
  );
}
