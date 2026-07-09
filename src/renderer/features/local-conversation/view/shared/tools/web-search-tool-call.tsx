import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { describeWebSearchAction } from "../../../web-search-display";
import { CodexShimmerText } from "../codex-shimmer-text";
import { asRecord, getString } from "./tool-call-utils";
import {
  ToolActivityIcon,
  resolveWebSearchFavicon,
} from "./tool-call-icons";
import { ThreadActivityHeader, ThreadActivityShell } from "./tool-primitives";

interface WebSearchToolCallProps {
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

export function WebSearchToolCall({ item }: WebSearchToolCallProps) {
  const completed = item.status !== "inProgress";
  const summaryVerb = completed ? "Searched the web" : "Searching the web";
  const summaryDetail = getWebSearchSummaryDetail(item);
  const favicon = resolveWebSearchFavicon(item);
  const summary = (
    <CodexShimmerText active={!completed} className="text-size-chat min-w-0 truncate">
      <span className="text-token-conversation-summary-leading group-hover:text-token-foreground">
        {summaryVerb}
      </span>
      {summaryDetail.length > 0 ? (
        <span className="text-token-conversation-summary-trailing group-hover:text-token-foreground">
          {" "}
          for {summaryDetail}
        </span>
      ) : null}
    </CodexShimmerText>
  );

  if (favicon) {
    return (
      <ThreadActivityShell
        header={(
          <ThreadActivityHeader>
            <span className="contents text-token-conversation-body">
              <ToolActivityIcon descriptor={favicon} showFallbackWhileLoading={false} />
            </span>
            <span className="min-w-0 flex-1 truncate text-token-conversation-body [&_.loading-shimmer-pure-text]:align-top [&_*:not(button)]:!text-token-conversation-body">
              {summary}
            </span>
          </ThreadActivityHeader>
        )}
      />
    );
  }

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="group flex min-w-0 items-center gap-2" data-testid="web-search-tool-call">
        {summary}
      </div>
    </div>
  );
}
