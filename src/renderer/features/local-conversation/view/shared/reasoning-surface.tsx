import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../../lib/utils";
import type { CodexTranscriptEntry } from "../../../../lib/types";
import { MarkdownRenderer } from "./markdown/markdown-renderer";
import { MeasuredExpand } from "./measured-expand";

interface ReasoningSurfaceProps {
  item: Pick<CodexTranscriptEntry, "markdownText"> & { status?: CodexTranscriptEntry["status"] };
  parseIncompleteMarkdown?: boolean;
}

interface ReasoningSections {
  heading: string | null;
  body: string;
}

function normalizeMarkdownNewlines(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u2028\u2029\u0085]/g, "\n");
}

export function extractReasoningSections(content: string): ReasoningSections {
  const normalized = normalizeMarkdownNewlines(content);
  const trimmedStart = normalized.trimStart();

  const boldHeadingMatch = trimmedStart.match(/^\*\*([^\n]*?)\*\*\s*/);
  if (boldHeadingMatch) {
    const heading = boldHeadingMatch[1]?.trim() ?? "";
    return {
      heading: heading.length > 0 ? heading : null,
      body: trimmedStart.slice(boldHeadingMatch[0].length).trim(),
    };
  }

  const lines = trimmedStart.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const rest = lines.slice(1).join("\n").trim();

  const markdownHeadingMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
  if (markdownHeadingMatch) {
    const heading = markdownHeadingMatch[1]?.trim() ?? "";
    return {
      heading: heading.length > 0 ? heading : null,
      body: rest,
    };
  }

  const standaloneStrongMatch = firstLine.match(/^\*\*(.+?)\*\*$/);
  if (standaloneStrongMatch) {
    const heading = standaloneStrongMatch[1]?.trim() ?? "";
    return {
      heading: heading.length > 0 ? heading : null,
      body: rest,
    };
  }

  return {
    heading: null,
    body: normalized.trim(),
  };
}

export function stripReasoningPreviewHeading(content: string): string {
  const normalized = normalizeMarkdownNewlines(content).trimStart();
  const boldHeadingMatch = normalized.match(/^\*\*([^\n]*?)\*\*/);
  if (boldHeadingMatch) return normalized.slice(boldHeadingMatch[0].length);
  if (normalized.startsWith("**")) return "";
  return normalized;
}

function formatElapsedDuration(elapsedMs: number): string | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1_000) return null;

  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

function useReasoningElapsedLabel(isInProgress: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(() => (isInProgress ? Date.now() : null));
  const [settledElapsedMs, setSettledElapsedMs] = useState<number | null>(null);
  const previousInProgressRef = useRef(isInProgress);

  useEffect(() => {
    const previousInProgress = previousInProgressRef.current;
    previousInProgressRef.current = isInProgress;

    if (!previousInProgress && isInProgress) {
      const nextStartedAt = Date.now();
      setStartedAt(nextStartedAt);
      setSettledElapsedMs(null);
      setNow(nextStartedAt);
      return;
    }

    if (previousInProgress && !isInProgress && startedAt !== null && settledElapsedMs === null) {
      const settledAt = Date.now();
      setSettledElapsedMs(settledAt - startedAt);
      setStartedAt(null);
      setNow(settledAt);
    }
  }, [isInProgress, settledElapsedMs, startedAt]);

  useEffect(() => {
    if (!isInProgress) return;

    const tick = () => setNow(Date.now());
    tick();
    const intervalId = window.setInterval(tick, 1_000);
    return () => window.clearInterval(intervalId);
  }, [isInProgress]);

  if (settledElapsedMs !== null) return formatElapsedDuration(settledElapsedMs);
  if (startedAt === null) return null;
  return formatElapsedDuration(Math.max(now - startedAt, 0));
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
        "text-token-input-placeholder-foreground icon-2xs flex-shrink-0 transition-all duration-300 opacity-0 group-hover:opacity-100",
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

function resolveReasoningHeaderLabel(isInProgress: boolean, elapsedLabel: string | null): string {
  if (isInProgress) return "Thinking";
  if (elapsedLabel) return `Thought for ${elapsedLabel}`;
  return "Thought";
}

export function ReasoningSurface({
  item,
  parseIncompleteMarkdown = false,
}: ReasoningSurfaceProps) {
  const content = item.markdownText ?? "";
  const isInProgress = item.status === "inProgress";
  const elapsedLabel = useReasoningElapsedLabel(isInProgress);
  const summaryLabel = resolveReasoningHeaderLabel(isInProgress, elapsedLabel);
  const sections = useMemo(() => extractReasoningSections(content), [content]);
  const previewBody = useMemo(() => stripReasoningPreviewHeading(content).trimStart(), [content]);
  const hasCompletedBody = !isInProgress && sections.body.trim().length > 0;
  const [expanded, setExpanded] = useState(isInProgress);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isInProgress) {
      setExpanded(previewBody.trim().length > 0);
      return;
    }
    setExpanded(false);
  }, [isInProgress, previewBody]);

  useEffect(() => {
    if (!isInProgress) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [isInProgress, previewBody]);

  const renderedBody = isInProgress ? previewBody : sections.body;
  const shouldRenderBody = isInProgress ? previewBody.trim().length > 0 : expanded && hasCompletedBody;
  const canToggle = hasCompletedBody;

  const header = (
    <div
      className={cn(
        "group flex items-center gap-1.5",
        canToggle ? "cursor-interaction" : "cursor-default",
      )}
    >
      <span className={cn(
        "group-hover:text-token-foreground text-size-chat truncate text-token-foreground/30",
        isInProgress && "loading-shimmer-pure-text",
      )}
      >
        {summaryLabel}
      </span>
      {canToggle ? <ChevronRightIcon expanded={expanded} /> : null}
    </div>
  );

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="flex flex-col">
        {canToggle ? (
          <button
            type="button"
            className="text-left"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((current) => !current);
            }}
          >
            {header}
          </button>
        ) : (
          header
        )}
        <MeasuredExpand open={shouldRenderBody} className="overflow-hidden" innerClassName="pb-0">
          <div
            ref={scrollContainerRef}
            className="vertical-scroll-fade-mask max-h-[8.75rem] overflow-y-auto [--edge-fade-distance:1rem]"
          >
            <MarkdownRenderer
              content={renderedBody}
              parseIncompleteMarkdown={parseIncompleteMarkdown}
              className={cn(
                "break-words text-size-chat text-token-foreground/60 [&_*]:text-size-chat [&_*]:text-token-foreground/50 [&_h1]:m-0 [&_h1]:mt-2 [&_h1]:font-semibold [&_h1+*]:mt-1 [&_h2]:m-0 [&_h2]:mt-2 [&_h2]:font-semibold [&_h2+*]:mt-1 [&_h3]:m-0 [&_h3]:mt-2 [&_h3]:font-semibold [&_h3+*]:mt-1 [&_li]:m-0 [&_ol]:my-0 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:m-0 [&_p]:has-[.inline-markdown]:py-0.5 [&_p+p]:mt-1 [&_ul]:my-0 [&_ul]:list-disc [&_ul]:pl-4",
              )}
            />
          </div>
        </MeasuredExpand>
      </div>
    </div>
  );
}
