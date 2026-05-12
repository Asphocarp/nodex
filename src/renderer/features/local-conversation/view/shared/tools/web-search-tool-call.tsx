import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { CodexShimmerText } from "../codex-shimmer-text";
import { asRecord, getString } from "./tool-call-utils";
import { ToolActivityIcon, resolveWebSearchFavicon, resolveWebSearchIcon } from "./tool-call-icons";

interface WebSearchToolCallProps {
  item: CodexTranscriptEntry;
  hideHeader?: boolean;
}

interface WebSearchActionSnapshot {
  type: string | null;
  query: string | null;
  queries: string[];
  url: string | null;
  pattern: string | null;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<string[]>((acc, entry) => {
    if (typeof entry !== "string") return acc;
    const trimmed = entry.trim();
    if (trimmed.length === 0) return acc;
    acc.push(trimmed);
    return acc;
  }, []);
}

function normalizeAction(action: unknown): WebSearchActionSnapshot | null {
  const candidate = asRecord(action);
  if (!candidate) return null;

  const query = getString(candidate, "query")?.trim() ?? null;
  const url = getString(candidate, "url")?.trim() ?? null;
  const pattern = getString(candidate, "pattern")?.trim() ?? null;

  return {
    type: getString(candidate, "type") ?? null,
    query: query && query.length > 0 ? query : null,
    queries: getStringArray(candidate.queries),
    url: url && url.length > 0 ? url : null,
    pattern: pattern && pattern.length > 0 ? pattern : null,
  };
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

export function selectPrimaryWebSearchQuery(query: string | null, queries: string[]): string {
  if (query && query.length > 0) return query;
  return queries[0] ?? "";
}

export function describeWebSearchAction(action: unknown, fallbackQuery: string): string {
  const snapshot = normalizeAction(action);
  if (!snapshot) return fallbackQuery.trim();

  if (snapshot.type === "search") {
    const selectedQuery = selectPrimaryWebSearchQuery(snapshot.query, snapshot.queries);
    if (selectedQuery.length === 0) return fallbackQuery.trim();
    return snapshot.queries.length > 1 && snapshot.query === null ? `${selectedQuery} ...` : selectedQuery;
  }

  if (snapshot.type === "openPage") {
    return snapshot.url ?? "";
  }

  if (snapshot.type === "findInPage") {
    if (snapshot.pattern && snapshot.url) return `'${snapshot.pattern}' in ${snapshot.url}`;
    if (snapshot.pattern) return `'${snapshot.pattern}'`;
    if (snapshot.url) return snapshot.url;
    return "";
  }

  return fallbackQuery.trim();
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

export function WebSearchToolCall({ item, hideHeader = false }: WebSearchToolCallProps) {
  const completed = item.status !== "inProgress";
  const summaryVerb = completed ? "Searched web" : "Searching the web";
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
