import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ChevronRightIcon } from "@/components/shared/icons";
import { motion } from "motion/react";
import type { Transition } from "motion/react";
import { cn } from "../../../../../lib/utils";
import {
  CODEX_THREAD_ACCORDION_TRANSITION,
  CODEX_THREAD_DIVIDER_ENTER_ANIMATE,
  CODEX_THREAD_DIVIDER_EXIT,
} from "../thread-motion";

const THREAD_ACTIVITY_SUMMARY_DEFER_MS = 1000;

/* ------------------------------------------------------------------ */
/*  ThreadActivityShell                                                */
/* ------------------------------------------------------------------ */

export interface ThreadActivityDisclosureState {
  expanded: boolean;
  onToggle: () => void;
}

export interface ThreadActivityHeaderProps {
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
  disclosure?: ThreadActivityDisclosureState;
  testId?: string;
}

export function ThreadActivityChevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className={cn(
        "icon-2xs shrink-0 text-token-input-placeholder-foreground opacity-0 transition-transform duration-300",
        "group-hover/activity-header:text-token-foreground group-hover/activity-header:opacity-100",
        "group-focus-visible/activity-header:text-token-foreground group-focus-visible/activity-header:opacity-100",
        expanded && "rotate-90 opacity-100",
      )}
    />
  );
}

export function ThreadActivityHeader({
  accessory,
  children,
  className,
  disclosure,
  testId,
}: ThreadActivityHeaderProps) {
  const content = (
    <>
      <span className="text-size-chat flex min-w-0 shrink items-center gap-1.5 truncate">
        {children}
      </span>
      {accessory}
      {disclosure ? <ThreadActivityChevron expanded={disclosure.expanded} /> : null}
    </>
  );
  const headerClassName = cn(
    "group/activity-header inline-flex min-w-0 max-w-full self-start items-center gap-1.5 p-0 text-left",
    disclosure && "cursor-interaction",
    className,
  );

  if (!disclosure) {
    return (
      <div className={headerClassName} data-testid={testId}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={headerClassName}
      data-testid={testId}
      aria-expanded={disclosure.expanded}
      onClick={disclosure.onToggle}
    >
      {content}
    </button>
  );
}

export interface ThreadActivityShellProps {
  body?: ReactNode;
  className?: string;
  header: ReactNode;
  testId?: string;
}

export function ThreadActivityShell({
  body,
  className,
  header,
  testId,
}: ThreadActivityShellProps) {
  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div data-testid={testId} className={cn("flex min-w-0 flex-col", className)}>
        {header}
        {body}
      </div>
    </div>
  );
}

export type ThreadActivitySummaryTransition = "static" | "immediate" | "deferred";

interface ThreadActivitySummaryTransitionState {
  key: string;
  node: ReactNode;
}

interface ThreadActivitySummaryTransitionProps {
  summary: ReactNode;
  summaryKey: string;
  summaryTransition: Exclude<ThreadActivitySummaryTransition, "static">;
}

function ThreadActivitySummaryTransitionNode({
  summary,
  summaryKey,
  summaryTransition,
}: ThreadActivitySummaryTransitionProps) {
  const [renderedSummary, setRenderedSummary] = useState<ThreadActivitySummaryTransitionState>(() => ({
    key: summaryKey,
    node: summary,
  }));
  const lastCommitAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    lastCommitAtRef.current ??= now;
    if (summaryKey === renderedSummary.key) return;

    const nextSummary = {
      key: summaryKey,
      node: summary,
    };
    const commit = () => {
      timeoutRef.current = null;
      lastCommitAtRef.current = Date.now();
      setRenderedSummary(nextSummary);
    };

    if (summaryTransition === "immediate") {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      commit();
      return;
    }

    const remainingMs = THREAD_ACTIVITY_SUMMARY_DEFER_MS - (now - lastCommitAtRef.current);
    if (remainingMs <= 0) {
      commit();
      return;
    }

    timeoutRef.current = window.setTimeout(commit, remainingMs);
    return () => {
      if (timeoutRef.current === null) return;
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [renderedSummary.key, summary, summaryKey, summaryTransition]);

  return (
    <span className="flex min-h-4 max-w-full min-w-0 items-center truncate">
      {summaryTransition === "immediate" || renderedSummary.key === summaryKey ? summary : renderedSummary.node}
    </span>
  );
}

export interface ThreadActivitySummaryTextProps {
  children: ReactNode;
  className?: string;
  summaryKey?: string | null;
  summaryTransition?: ThreadActivitySummaryTransition;
}

export function ThreadActivitySummaryText({
  children,
  className,
  summaryKey,
  summaryTransition = "static",
}: ThreadActivitySummaryTextProps) {
  const content = summaryKey == null || summaryTransition === "static" ? children : (
    <ThreadActivitySummaryTransitionNode
      summary={children}
      summaryKey={summaryKey}
      summaryTransition={summaryTransition}
    />
  );

  return (
    <span
      className={cn(
        "text-token-conversation-summary-trailing flex min-w-0 max-w-full items-center truncate",
        className,
      )}
    >
      {content}
    </span>
  );
}

export interface ThreadActivityDisclosureProps {
  bodyClassName?: string;
  bodyTestId?: string;
  canExpand?: boolean;
  children: ReactNode;
  className?: string;
  defaultExpanded?: boolean;
  headerClassName?: string;
  headerTestId?: string;
  onExpand?: () => void;
  shouldAnimateInitialCollapse?: boolean;
  summary: ReactNode;
  summaryClassName?: string;
  summaryKey?: string | null;
  summaryTransition?: ThreadActivitySummaryTransition;
  testId?: string;
  transition?: Transition;
}

export function ThreadActivityDisclosure({
  bodyClassName,
  bodyTestId,
  canExpand = true,
  children,
  className,
  defaultExpanded = false,
  headerClassName,
  headerTestId,
  onExpand,
  shouldAnimateInitialCollapse = false,
  summary,
  summaryClassName,
  summaryKey,
  summaryTransition,
  testId,
  transition = CODEX_THREAD_ACCORDION_TRANSITION,
}: ThreadActivityDisclosureProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [bodyMounted, setBodyMounted] = useState(
    (shouldAnimateInitialCollapse || defaultExpanded) && canExpand,
  );
  const expansionFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (expansionFrameRef.current === null) return;
      window.cancelAnimationFrame(expansionFrameRef.current);
    };
  }, []);

  const handleToggle = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    onExpand?.();

    if (bodyMounted) {
      setExpanded(true);
      return;
    }

    setBodyMounted(true);
    expansionFrameRef.current = window.requestAnimationFrame(() => {
      expansionFrameRef.current = null;
      setExpanded(true);
    });
  };

  const header = (
    <ThreadActivityHeader
      className={headerClassName}
      disclosure={canExpand ? { expanded, onToggle: handleToggle } : undefined}
      testId={headerTestId}
    >
      <ThreadActivitySummaryText
        className={summaryClassName}
        summaryKey={summaryKey}
        summaryTransition={summaryTransition}
      >
        {summary}
      </ThreadActivitySummaryText>
    </ThreadActivityHeader>
  );
  const body = canExpand && bodyMounted ? (
    <motion.div
      initial={false}
      animate={expanded ? CODEX_THREAD_DIVIDER_ENTER_ANIMATE : CODEX_THREAD_DIVIDER_EXIT}
      transition={transition}
      className={bodyClassName}
      data-testid={bodyTestId}
      data-thread-find-skip={expanded ? undefined : true}
      style={{
        overflow: "hidden",
        pointerEvents: expanded ? "auto" : "none",
      }}
      onAnimationComplete={() => {
        if (!expanded) setBodyMounted(false);
      }}
    >
      {children}
    </motion.div>
  ) : null;

  return (
    <ThreadActivityShell
      body={body}
      className={className}
      header={header}
      testId={testId}
    />
  );
}

export type ThreadActivityListViewState = "preview" | "collapsed" | "expanded";

export interface ThreadActivityListItem {
  key: string;
  node: ReactNode;
}

export type ThreadActivityListMaxHeightByState = Record<
  ThreadActivityListViewState,
  CSSProperties["maxHeight"]
>;

export const THREAD_ACTIVITY_LIST_20_REM_MAX_HEIGHT_BY_STATE = {
  preview: "20rem",
  expanded: "20rem",
  collapsed: "0px",
} satisfies ThreadActivityListMaxHeightByState;

export const THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE = {
  preview: "7rem",
  expanded: "20rem",
  collapsed: "0px",
} satisfies ThreadActivityListMaxHeightByState;

export interface ThreadActivityListProps {
  allowHorizontalScroll?: boolean;
  autoScrollToBottom?: boolean;
  className?: string;
  contentClassName?: string;
  disableMaxHeight?: boolean;
  items: readonly ThreadActivityListItem[];
  maxHeightByState: ThreadActivityListMaxHeightByState;
  testId?: string;
  viewState?: ThreadActivityListViewState;
}

export function ThreadActivityList({
  allowHorizontalScroll = false,
  autoScrollToBottom = true,
  className,
  contentClassName,
  disableMaxHeight = false,
  items,
  maxHeightByState,
  testId,
  viewState = "preview",
}: ThreadActivityListProps) {
  const maxHeight = maxHeightByState[viewState];
  const style = disableMaxHeight ? undefined : { maxHeight };
  const renderedItems = viewState === "collapsed"
    ? null
    : items.map((item) => (
      <div key={item.key}>
        {item.node}
      </div>
    ));

  return (
    <div
      className={cn(
        "vertical-scroll-fade-mask [--edge-fade-distance:1.5rem] overflow-y-auto",
        autoScrollToBottom && "flex flex-col-reverse",
        !allowHorizontalScroll && "overflow-x-hidden",
        className,
      )}
      data-testid={testId}
      style={style}
    >
      <div className={cn("flex flex-col gap-1", contentClassName, viewState === "preview" && "pb-1")}>
        {renderedItems}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared primitives (kept for expanded body sections)                */
/* ------------------------------------------------------------------ */

export function DetailLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-xs font-semibold tracking-wide text-(--foreground-tertiary) uppercase">{children}</div>;
}

export function ToolJsonDetail({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <div className="mb-2">
      <DetailLabel>{label}</DetailLabel>
      <JsonBlock value={value} />
    </div>
  );
}

export function ToolErrorDetail({
  error,
  className,
  showLabel = true,
}: {
  error: string;
  className?: string;
  showLabel?: boolean;
}) {
  return (
    <div className={className}>
      {showLabel ? <DetailLabel>Error</DetailLabel> : null}
      <div className="rounded-md border border-(--destructive)/35 bg-(--destructive)/10 px-2.5 py-2 text-xs text-(--destructive)">
        {error}
      </div>
    </div>
  );
}

export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        "codex-tool-code scrollbar-token max-h-80 overflow-auto rounded-md border border-(--border) bg-(--background) px-2.5 py-2 font-mono text-xs/normal wrap-break-word whitespace-pre-wrap",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return <CodeBlock>{text}</CodeBlock>;
}
