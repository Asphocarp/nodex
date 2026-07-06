import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { useState } from "react";
import { describeWebSearchAction } from "../../../web-search-display";
import { CodexShimmerText } from "../codex-shimmer-text";
import { asRecord, getString } from "./tool-call-utils";
import {
  ToolActivityIcon,
  resolveWebSearchFavicon,
  resolveWebSearchIcon,
  semanticToolIcon,
} from "./tool-call-icons";
import {
  THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE,
  ThreadActivityHeader,
  ThreadActivityList,
  ThreadActivityShell,
} from "./tool-primitives";

interface WebSearchToolCallProps {
  item: CodexTranscriptEntry;
  hideHeader?: boolean;
}

interface WebSearchToolCallGroupProps {
  items: readonly CodexTranscriptEntry[];
  isActive?: boolean;
  hideHeader?: boolean;
}

interface WebSearchDisplayLine {
  key: string;
  detail: string;
  completed: boolean;
  item: CodexTranscriptEntry;
}

function extractFallbackQuery(item: CodexTranscriptEntry): string {
  const args = asRecord(item.toolCall?.args);
  const explicitQuery = getString(args, "query")?.trim();
  if (explicitQuery && explicitQuery.length > 0) return explicitQuery;

  const rawItem = asRecord(item.rawItem);
  const rawQuery = getString(rawItem, "query")?.trim();
  if (rawQuery && rawQuery.length > 0) return rawQuery;

  return "";
}

function extractAction(item: CodexTranscriptEntry): unknown {
  const rawItem = asRecord(item.rawItem);
  if (Object.prototype.hasOwnProperty.call(rawItem ?? {}, "action")) {
    return rawItem?.action;
  }

  return item.toolCall?.result;
}

export function getWebSearchSummaryDetail(item: CodexTranscriptEntry): string {
  return describeWebSearchAction(extractAction(item), extractFallbackQuery(item)).trim();
}

function buildWebSearchDisplayLines(items: readonly CodexTranscriptEntry[]): WebSearchDisplayLine[] {
  return items.reduce<WebSearchDisplayLine[]>((acc, item, index) => {
    const detail = getWebSearchSummaryDetail(item);
    if (detail.length === 0) return acc;
    acc.push({
      key: `${detail}:${index}`,
      detail,
      completed: item.status !== "inProgress",
      item,
    });
    return acc;
  }, []);
}

function getActiveWebSearchDetail(lines: readonly WebSearchDisplayLine[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line && !line.completed) return line.detail;
  }
  return lines.at(-1)?.detail ?? null;
}

function WebSearchGroupLines({
  lines,
  viewState = "expanded",
}: {
  lines: readonly WebSearchDisplayLine[];
  viewState?: "collapsed" | "expanded";
}) {
  const items = lines.map((line) => {
    const favicon = resolveWebSearchFavicon(line.item);
    return {
      key: line.key,
      node: (
        <div className="text-size-chat flex items-start gap-1.5 font-sans text-token-description-foreground/80">
          {favicon ? (
            <ToolActivityIcon descriptor={favicon} className="mt-[3px] size-3.5 text-token-text-secondary" />
          ) : null}
          <span className="min-w-0 break-words">{line.detail}</span>
        </div>
      ),
    };
  });

  return (
    <div className="pt-0 text-token-conversation-body [&_*]:text-token-non-assistant-body-descendant">
      <div className="-mx-2.5 mt-1">
        <ThreadActivityList
          autoScrollToBottom={false}
          className="text-size-chat rounded-none border-0 px-2.5 font-sans text-token-description-foreground/80 [&_*]:text-token-description-foreground/80"
          items={items}
          maxHeightByState={THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE}
          testId="web-search-group-lines"
          viewState={viewState}
        />
      </div>
    </div>
  );
}

export function WebSearchToolCallGroup({
  items,
  isActive = false,
  hideHeader = false,
}: WebSearchToolCallGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const lines = buildWebSearchDisplayLines(items);
  if (lines.length === 0) return null;

  if (hideHeader) {
    return <WebSearchGroupLines lines={lines} />;
  }

  const isSearching = isActive && lines.some((line) => !line.completed);
  const activeDetail = isSearching ? getActiveWebSearchDetail(lines) : null;
  const icon = semanticToolIcon("web-search");

  return (
    <ThreadActivityShell
      className="pt-0 text-token-conversation-body"
      header={(
        <ThreadActivityHeader
          disclosure={{
            expanded: isExpanded,
            onToggle: () => {
              setIsExpanded((value) => !value);
            },
          }}
        >
          <ToolActivityIcon descriptor={icon} showFallbackWhileLoading={false} />
          <span className="min-w-0 truncate text-token-conversation-summary-trailing group-hover/activity-header:text-token-foreground">
            {isSearching ? (
              <>
                <CodexShimmerText className="shrink-0 whitespace-nowrap text-token-conversation-summary-leading group-hover/activity-header:text-token-foreground">
                  Searching the web
                </CodexShimmerText>
                {activeDetail ? <span className="min-w-0 truncate"> for {activeDetail}</span> : null}
              </>
            ) : (
              <span className="text-token-conversation-summary-leading group-hover/activity-header:text-token-foreground">
                Searched the web
              </span>
            )}
          </span>
        </ThreadActivityHeader>
      )}
      body={<WebSearchGroupLines lines={lines} viewState={isExpanded ? "expanded" : "collapsed"} />}
    />
  );
}

export function WebSearchToolCall({ item, hideHeader = false }: WebSearchToolCallProps) {
  const completed = item.status !== "inProgress";
  const summaryVerb = completed ? "Searched the web" : "Searching the web";
  const summaryDetail = getWebSearchSummaryDetail(item);

  if (hideHeader) {
    const favicon = resolveWebSearchFavicon(item);
    return (
      <div className="-mx-2.5 mt-1">
        <div className="text-size-chat rounded-none border-0 px-2.5 font-sans text-token-description-foreground/80 [&_*]:text-token-description-foreground/80">
          <div className="text-size-chat flex items-start gap-1.5 font-sans text-token-description-foreground/80">
            {favicon ? (
              <ToolActivityIcon descriptor={favicon} className="mt-[3px] size-3.5 text-token-text-secondary" />
            ) : null}
            <span className="min-w-0 break-words">{summaryDetail.length > 0 ? summaryDetail : summaryVerb}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="group flex min-w-0 items-center gap-2">
        <ToolActivityIcon descriptor={resolveWebSearchIcon(item)} showFallbackWhileLoading={false} />
        <span className="min-w-0 truncate text-size-chat">
          <CodexShimmerText
            active={!completed}
            className="text-token-description-foreground/90 group-hover:text-token-foreground"
          >
            {summaryVerb}
          </CodexShimmerText>
          {summaryDetail.length > 0 ? (
            <span className="text-token-foreground/40 group-hover:text-token-foreground">
              {" "}
              for {summaryDetail}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
