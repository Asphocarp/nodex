import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CODEX_SIDEBAR_DEFAULT_PAGER_ROW_CLASS,
  paginateCodexSidebarItems,
  type CodexSidebarPaginationResult,
} from "@/lib/codex-sidebar-pagination";
import { CodexSidebarPagerButton } from "./codex-sidebar";

export interface SidebarPaginatedItemsProps<T> {
  readonly items: T[];
  readonly getKey: (item: T) => string;
  readonly maxItems?: number | null;
  readonly expanded: boolean;
  readonly onExpandedChange?: (expanded: boolean) => void;
  readonly forcedVisibleKey?: string | null;
  readonly suppressedKeys?: ReadonlySet<string>;
  readonly pagerClassName?: string;
  readonly hasMoreAtSource?: boolean;
  readonly onLoadMore?: () => void | Promise<void>;
  readonly children: (
    pagination: CodexSidebarPaginationResult<T>,
    pager: ReactNode,
  ) => ReactNode;
}

export function SidebarPaginatedItems<T>({
  items,
  getKey,
  maxItems = null,
  expanded,
  onExpandedChange,
  forcedVisibleKey = null,
  suppressedKeys,
  pagerClassName = CODEX_SIDEBAR_DEFAULT_PAGER_ROW_CLASS,
  hasMoreAtSource = false,
  onLoadMore,
  children,
}: SidebarPaginatedItemsProps<T>) {
  const [extraPageCount, setExtraPageCount] = useState(1);
  const focusRestoreTargetRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (expanded) return;
    setExtraPageCount(1);
  }, [expanded]);

  const pagination = useMemo(() => paginateCodexSidebarItems({
    items,
    getKey,
    maxItems,
    expanded,
    extraPageCount,
    forcedVisibleKey,
    suppressedKeys,
    pagerEnabled: Boolean(onExpandedChange),
  }), [
    expanded,
    extraPageCount,
    forcedVisibleKey,
    getKey,
    items,
    maxItems,
    onExpandedChange,
    suppressedKeys,
  ]);

  const restorePagerFocus = useCallback(() => {
    queueMicrotask(() => {
      focusRestoreTargetRef.current?.focus();
    });
  }, []);

  const showMore = useCallback(() => {
    if (!expanded) {
      if (hasMoreAtSource) void onLoadMore?.();
      setExtraPageCount(1);
      onExpandedChange?.(true);
      restorePagerFocus();
      return;
    }
    if (hasMoreAtSource) void onLoadMore?.();
    setExtraPageCount((current) => current + 1);
    restorePagerFocus();
  }, [
    expanded,
    hasMoreAtSource,
    onExpandedChange,
    onLoadMore,
    restorePagerFocus,
  ]);

  const showLess = useCallback(() => {
    setExtraPageCount(1);
    onExpandedChange?.(false);
    restorePagerFocus();
  }, [onExpandedChange, restorePagerFocus]);

  const hasOverflow = pagination.hasOverflow || hasMoreAtSource;
  const pager = pagination.showPager || hasMoreAtSource ? (
    <div className={pagerClassName} role="listitem">
      {hasOverflow ? (
        <CodexSidebarPagerButton
          ref={focusRestoreTargetRef}
          onClick={showMore}
        >
          Show more
        </CodexSidebarPagerButton>
      ) : null}
      {expanded ? (
        <CodexSidebarPagerButton
          ref={hasOverflow ? undefined : focusRestoreTargetRef}
          onClick={showLess}
        >
          Show less
        </CodexSidebarPagerButton>
      ) : null}
    </div>
  ) : null;

  return <>{children(pagination, pager)}</>;
}
