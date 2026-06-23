import type { FileContents } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ChevronDownIcon,
  CheckmarkIcon,
  CodexCloseIcon,
  CodexSidePanelFilesIcon,
  FileTreeChevronIcon,
  FileTreeFileIcon,
  FileTreeLockIcon,
  ReviewCollapseAllDiffsIcon,
  ReviewCommitOrPushIcon,
  ReviewCreatePrIcon,
  ReviewDisableRichPreviewIcon,
  ReviewDisableWordDiffsIcon,
  ReviewDisableWordWrapIcon,
  ReviewEnableWordWrapIcon,
  ReviewFileToggleChevronIcon,
  ReviewExpandAllDiffsIcon,
  ReviewFileDocumentIcon,
  ReviewFullFilesIcon,
  ReviewHideWhitespaceIcon,
  ReviewJumpToFileIcon,
  ReviewOpenInIcon,
  ReviewRefreshIcon,
  ReviewRichPreviewIcon,
  SearchIcon,
  ReviewSplitDiffIcon,
  ReviewUnifiedDiffIcon,
  ReviewWordDiffsIcon,
} from "../shared/icons";
import {
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownMessage,
  NodexDropdownScrollList,
  NodexDropdownSearchInput,
  NodexDropdownSeparator,
} from "../ui/dropdown";
import { NodexTooltip } from "../ui/tooltip";
import { toast } from "../ui/toast";
import {
  useRegisterContentSearchSource,
  type ContentSearchLocalMatch,
  type ContentSearchLocalSource,
} from "@/features/content-search/content-search-context";
import {
  CONTENT_SEARCH_ACTIVE_MARK_CLASS,
  CONTENT_SEARCH_MARK_CLASS,
  applyContentSearchDomMarks,
  clearContentSearchMarks,
} from "@/features/content-search/content-search-dom";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "@/lib/diff-presentation";
import { writeTextToClipboard } from "@/lib/clipboard";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
import {
  middleTruncateReviewJumpText,
  selectReviewJumpToFileMatches,
  splitReviewJumpToFilePath,
} from "@/lib/review-jump-to-file";
import {
  buildReviewRenderPlan,
  filterReviewFiles,
  buildReviewVisibleFiles,
  getReviewContainIntrinsicSize,
  getReviewTotalChangedBytes,
  getReviewTotalChangedLines,
  isReviewLargeDiff,
  resolveReviewSelectedPath,
  REVIEW_CAPPED_MATCH_PAGE_SIZE,
} from "@/lib/review-diff-model";
import {
  buildReviewFileTreeDefaultExpandedPaths,
  buildReviewFileTreeExpandedPathsForSelection,
  buildReviewFileTreeModel,
  buildReviewFileTreeVisibleState,
  resolveReviewFileTreeItemIdForPath,
  resolveReviewFileTreeSelectedVisibleIndex,
  type ReviewFileTreeRow,
} from "@/lib/review-file-tree-model";
import {
  REVIEW_FILE_TREE_FALLBACK_ITEM_HEIGHT_PX,
  REVIEW_FILE_TREE_VIRTUALIZE_THRESHOLD,
  REVIEW_FILE_TREE_VIRTUAL_OVERSCAN,
  areReviewFileTreeRangesEqual,
  getReviewFileTreeOffset,
  getReviewFileTreeScrollTopForIndex,
  getReviewFileTreeVirtualLayout,
  getReviewFileTreeVirtualRange,
  isReviewFileTreeVirtualizationEnabled,
  resolveReviewFileTreeItemHeight,
  type ReviewFileTreeVirtualRange,
} from "@/lib/review-file-tree-virtualization";
import {
  extractReviewCodeCommentsFromConversation,
  filterReviewCodeCommentsForPath,
  type ReviewCodeComment,
} from "@/lib/review-code-comments";
import { useFileLinkOpener } from "@/lib/use-file-link-opener";
import type {
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexTurnDiffReviewTarget,
  GitReviewBranchCommit,
  GitReviewBranchCommitsResult,
  GitReviewFileContents,
  GitReviewFileStatus,
  GitReviewSnapshot,
  GitReviewSource,
  ReviewDiffResult,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  parsePatchFiles as defaultParsePatchFiles,
  FileDiff as defaultFileDiff,
  invoke as defaultInvoke,
  MultiFileDiff as defaultMultiFileDiff,
  useTheme as defaultUseTheme,
} from "./review-diff-panel-deps";
import {
  DiffStats,
  FilenameButton,
  normalizePathSegments,
  resolveOpenPath,
  stripPatchPrefix,
  summarizeFileDiffMetadata,
} from "@/features/local-conversation/view/shared/tools/diff-file-shared";

type TranscriptReviewSource = "selected-turn" | "last-turn";
type ReviewSource = TranscriptReviewSource | GitReviewSource;
type ReviewDiffMode = "unified" | "split";
type GitReviewLoadStatus = "idle" | "loading" | "loaded" | "load-failed" | "timed-out";

interface ReviewDiffPanelProps {
  conversation: CodexConversationSnapshot | null;
  projectWorkspacePath?: string | null;
  selectedTurnDiff?: CodexTurnDiffReviewTarget | null;
  initialSource?: ReviewSource;
  initialCommitSha?: string | null;
  initialFileTreeOpen?: boolean;
  searchOpenTick?: number;
  deps?: Partial<ReviewDiffPanelDeps>;
}

interface ReviewDiffPanelDeps {
  parsePatchFiles: typeof defaultParsePatchFiles;
  invoke: typeof defaultInvoke;
  useTheme: typeof defaultUseTheme;
  FileDiff: typeof defaultFileDiff;
  MultiFileDiff: typeof defaultMultiFileDiff;
}

interface ReviewFileEntry {
  key: string;
  displayPath: string;
  previousPath: string | null;
  gitStatus: GitReviewFileStatus | null;
  patchText: string;
  openPath: string | null;
  openLine: number | undefined;
  additions: number;
  deletions: number;
  fileDiff: FileDiffMetadata;
}

interface ReviewSnapshot {
  source: ReviewSource;
  patch: string;
  files: ReviewFileEntry[];
  cwd: string | null;
  isGitRepository: boolean;
  baseRef: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  errorMessage: string | null;
  emptyReason: "noDiff" | "noLongerAvailable" | null;
}

interface ReviewEmptyStateCopy {
  title: string;
  description: string;
  showIllustration: boolean;
  showViewBranchDiffAction: boolean;
}

const REVIEW_FILE_TREE_DEFAULT_WIDTH_PX = 280;
const REVIEW_FILE_TREE_MIN_WIDTH_PX = 200;
const REVIEW_FILE_TREE_MAX_WIDTH_RATIO = 0.6;
const LARGE_DIFF_LINE_THRESHOLD = 3_000;
const REVIEW_FILE_TREE_SEARCH_INPUT_ID = "review-file-search";
const REVIEW_DIFF_BATCH_DELAY_MS = 16;
const REVIEW_DIFF_TIMEOUT_MS = 15_000;
const REVIEW_CONTENT_SEARCH_CAP = 250;
const REVIEW_OPTIONS_MENU_ICON_CLASS_NAME = "icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100";
const REVIEW_AGGREGATE_DIFF_STATS_CLASS_NAME = "text-size-chat mr-1 shrink-0 select-none";
const REVIEW_EMPTY_STATE_ACTION_BUTTON_CLASS_NAME = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-foreground bg-token-foreground/5 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10 border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px]";
const REVIEW_EMPTY_STATE_ILLUSTRATION_PATH = "M20.4622 0.247806C21.3984 -0.00979114 22.5424 -0.0833059 24.3919 0.107181C26.2731 0.300998 28.6338 0.734691 31.9925 1.35718L50.5852 4.80249C53.6017 5.36157 54.6803 5.57925 55.6038 5.99488L55.929 6.15015C56.6787 6.52555 57.3664 7.00409 57.9681 7.57202C58.6934 8.25736 59.2703 9.14603 60.8177 11.6287L62.7884 14.7898C64.336 17.2728 64.8793 18.1822 65.1751 19.1355C65.455 20.0387 65.5807 20.9906 65.5491 21.9519C65.5479 21.9883 65.5432 22.0246 65.5413 22.0613C65.5596 22.3428 65.5672 22.6264 65.5579 22.9109V22.9119C65.5243 23.9209 65.245 24.9841 64.4183 27.9392L56.0804 57.7429C55.1602 61.0318 54.5093 63.3424 53.8548 65.1169V65.1179C53.2117 66.8608 52.6407 67.8608 51.9915 68.5945L51.9905 68.5955C50.6374 70.1236 48.849 71.2391 46.8811 71.781C45.9363 72.0411 44.7864 72.1129 42.9378 71.9226C41.0562 71.7288 38.6945 71.295 35.3362 70.6726L14.0296 66.7234C10.6714 66.101 8.31217 65.6599 6.51298 65.1716C4.74539 64.6918 3.74685 64.2213 3.03348 63.6541C1.54801 62.4722 0.529247 60.8364 0.122352 58.9822V58.9812C0.00960176 58.4665 -0.0292753 57.8806 0.0227425 57.1306C-0.0250512 56.373 0.0534353 55.4382 0.303016 54.1472C0.657029 52.3165 1.29974 50.004 2.22001 46.7146L11.302 14.2527C12.2224 10.9631 12.8721 8.65292 13.5266 6.87867C14.1702 5.13425 14.7404 4.13988 15.3841 3.41285C16.7292 1.89375 18.5059 0.78636 20.4622 0.247806ZM42.9808 70.9324C43.6743 71.0038 44.2688 71.0384 44.7903 71.0398C44.2691 71.0384 43.675 71.0038 42.9817 70.9324C42.7465 70.9081 42.5034 70.88 42.2522 70.8484L42.9808 70.9324ZM9.73075 64.908C10.9652 65.1573 12.3945 65.4229 14.0735 65.7341L35.3802 69.6824C37.4793 70.0714 39.1889 70.3869 40.635 70.616L39.7347 70.4675C38.4898 70.2571 37.0602 69.9936 35.3811 69.6824L14.0745 65.7341C12.3951 65.4229 10.9652 65.1573 9.73075 64.908ZM24.3411 0.604251C22.523 0.41699 21.4475 0.494741 20.595 0.729251C18.7322 1.24208 17.039 2.29737 15.7581 3.7439C15.1719 4.40597 14.6292 5.33725 13.9964 7.05249C13.3505 8.80345 12.7059 11.0904 11.7835 14.3875L2.70145 46.8494C1.77899 50.1466 1.14345 52.4359 0.794227 54.2419C0.452241 56.0108 0.446252 57.0412 0.622352 57.8445C1.00742 59.5997 1.972 61.1476 3.37821 62.2664C4.02189 62.7782 4.95004 63.227 6.68876 63.699C8.46395 64.1808 10.799 64.618 14.1653 65.2419L35.472 69.1912C38.8383 69.8151 41.176 70.2441 43.0325 70.4353C44.8509 70.6226 45.9261 70.545 46.7786 70.3103C48.6414 69.7974 50.3347 68.7422 51.6155 67.2957C52.2015 66.6336 52.7446 65.7028 53.3772 63.988C54.0232 62.237 54.6677 59.9493 55.5901 56.6521L63.928 26.8484C64.3266 25.4238 64.5906 24.4522 64.764 23.7244L53.3714 21.4041C52.1934 21.1641 51.6039 21.0432 51.2161 20.7195C50.9667 20.5111 50.7735 20.2461 50.6507 19.949C50.3911 19.6602 50.208 19.3084 50.1243 18.9255C50.06 18.6309 50.081 18.3236 50.1536 17.9578C50.2257 17.5945 50.3541 17.1493 50.5188 16.5759L53.5852 5.90015C52.8637 5.73959 51.8946 5.55438 50.4934 5.29468L31.9007 1.84839C28.5347 1.22455 26.1975 0.795542 24.3411 0.604251ZM48.5755 70.1746C48.2997 70.3039 48.0182 70.4211 47.7317 70.5261C48.0182 70.421 48.2997 70.3039 48.5755 70.1746ZM49.0227 69.9539L49.0218 69.9548L49.0227 69.9539ZM50.5677 68.9568C50.4229 69.0691 50.2746 69.1764 50.1243 69.281C50.2746 69.1764 50.4229 69.0691 50.5677 68.9568ZM51.8548 67.7722C51.771 67.8633 51.6848 67.9519 51.5979 68.0398C51.6848 67.9519 51.771 67.8633 51.8548 67.7722ZM0.428016 58.9783C0.944949 60.4218 1.85125 61.691 3.06669 62.658C3.78719 63.2307 4.79047 63.7019 6.55692 64.1814C6.78191 64.2425 7.01573 64.303 7.25907 64.363L6.5579 64.1814C5.23267 63.8217 4.33703 63.4667 3.66825 63.0701C3.55675 63.004 3.45169 62.9366 3.35184 62.8679C3.25212 62.7993 3.15765 62.7295 3.06766 62.658C2.0389 61.8396 1.23176 60.8043 0.694618 59.6306C0.645767 59.5239 0.59834 59.4164 0.553993 59.3074C0.509667 59.1984 0.467769 59.0884 0.428016 58.9773V58.9783ZM54.3792 60.9002C54.1696 61.606 53.9696 62.2451 53.7766 62.8298C54 62.1525 54.2305 61.4017 54.4778 60.5593C54.4441 60.6743 54.4123 60.7886 54.3792 60.9002ZM55.8245 57.6638C55.4675 58.9368 55.1526 60.0532 54.8587 61.0427C55.1526 60.0532 55.4675 58.9367 55.8245 57.6638ZM0.0764534 57.6433C0.0924277 57.7492 0.111172 57.8519 0.133094 57.9519C0.184295 58.1852 0.245507 58.4153 0.315711 58.6414L0.218055 58.2996C0.187644 58.1846 0.159687 58.0687 0.134071 57.9519C0.11215 57.8519 0.0928863 57.7491 0.0764534 57.6433ZM19.6155 45.2244C19.9624 43.9875 21.2673 43.1731 22.5306 43.407L36.8714 46.0652C38.1329 46.3007 38.8774 47.4939 38.5325 48.7302C38.1864 49.9672 36.8795 50.7801 35.6165 50.5476L21.2766 47.8904C20.0128 47.6561 19.2692 46.4622 19.6155 45.2244ZM34.096 22.2293C34.4424 20.9919 35.7486 20.1784 37.012 20.4119C38.2747 20.6469 39.0191 21.8407 38.6731 23.0779L37.3362 27.8572L42.219 28.7625C43.4806 28.9978 44.226 30.1911 43.8811 31.4275C43.5351 32.6645 42.2282 33.4774 40.9651 33.2449L36.0823 32.3406L34.7444 37.1228C34.3978 38.3595 33.0914 39.1732 31.8284 38.9402C30.5656 38.7055 29.8208 37.5113 30.1663 36.2742L31.5052 31.4919L26.6253 30.5877C25.3614 30.3533 24.6169 29.1595 24.9632 27.9216C25.3101 26.6846 26.6158 25.8702 27.8792 26.1043L32.7591 27.0085L34.096 22.2293ZM50.9993 16.7146C50.8323 17.296 50.7099 17.7177 50.6429 18.0554C50.5765 18.39 50.5694 18.6196 50.6126 18.8181C50.6955 19.1975 50.9025 19.5398 51.2005 19.7888C51.3566 19.919 51.5644 20.0181 51.8919 20.114C52.2222 20.2107 52.652 20.299 53.2444 20.4197L64.9554 22.8044C65.0101 22.4792 65.0411 22.2051 65.0501 21.9353C65.0799 21.0284 64.9606 20.1319 64.6975 19.283C64.4254 18.406 63.9256 17.5606 62.3636 15.0544L60.3938 11.8933C58.8317 9.38706 58.2918 8.56584 57.6243 7.93531C56.9781 7.32527 56.226 6.82357 55.3987 6.45093C55.0334 6.28652 54.6399 6.15562 54.0725 6.01441L50.9993 16.7146Z";

type ReviewFileTreeHostStyle = CSSProperties & Record<`--${string}`, string>;

const REVIEW_FILE_TREE_HOST_STYLE = {
  "--trees-row-height": "28px",
  "--trees-font-size": "13px",
  "--trees-item-padding-x": "6px",
  "--trees-item-margin-x": "0px",
  "--trees-item-row-gap": "10px",
  "--trees-icon-width": "16px",
  "--trees-level-gap": "0px",
  "--trees-border-radius": "6px",
  "--trees-fg": "var(--color-token-foreground)",
  "--trees-file-fg": "var(--color-token-description-foreground)",
  "--trees-fg-muted": "light-dark(#84848a, #84848a)",
  "--trees-bg": "var(--color-token-main-surface-primary)",
  "--trees-bg-muted": "var(--color-token-list-hover-background)",
  "--trees-border-color": "var(--color-token-border)",
  "--trees-indent-guide-bg": "color-mix(in lab, var(--trees-fg-muted) 25%, transparent)",
  "--trees-selected-fg": "var(--color-token-list-active-selection-foreground)",
  "--trees-selected-bg": "var(--color-token-list-active-selection-background)",
  "--trees-focus-ring-color": "var(--color-token-list-focus-outline)",
  "--trees-search-bg": "var(--color-token-bg-fog)",
  "--trees-search-fg": "var(--color-token-foreground)",
} satisfies ReviewFileTreeHostStyle;

const DEFAULT_REVIEW_DIFF_PANEL_DEPS: ReviewDiffPanelDeps = {
  parsePatchFiles: defaultParsePatchFiles,
  invoke: defaultInvoke,
  useTheme: defaultUseTheme,
  FileDiff: defaultFileDiff,
  MultiFileDiff: defaultMultiFileDiff,
};

function countReviewOccurrences(entry: ReviewFileEntry, query: string, fullContents: GitReviewFileContents | null): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const haystacks = [
    entry.displayPath,
    entry.patchText,
    fullContents?.oldText ?? "",
    fullContents?.newText ?? "",
  ];
  let total = 0;
  for (const value of haystacks) {
    const haystack = value.toLowerCase();
    let cursor = 0;
    while (cursor < haystack.length) {
      const index = haystack.indexOf(normalizedQuery, cursor);
      if (index === -1) break;
      total += 1;
      cursor = index + normalizedQuery.length;
    }
  }
  return total;
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isReviewSearchMatchMeta(value: unknown): value is { path: string; occurrenceIndex: number } {
  if (!value || typeof value !== "object") return false;
  const meta = value as { path?: unknown; occurrenceIndex?: unknown };
  return typeof meta.path === "string" && typeof meta.occurrenceIndex === "number";
}

const SOURCE_LABELS: Record<ReviewSource, string> = {
  "selected-turn": "Last turn",
  "last-turn": "Last turn",
  branch: "Branch",
  commit: "Commit",
  staged: "Staged",
  unstaged: "Unstaged",
};

type BranchCommitsLoadStatus = "idle" | "loading" | "loaded" | "error";

function formatReviewCommitRelativeTime(committedAt: string): string {
  const committedAtMs = Date.parse(committedAt);
  if (!Number.isFinite(committedAtMs)) return "";

  const elapsedMs = Math.max(0, Date.now() - committedAtMs);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `${elapsedDays}d`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths}mo`;

  return `${Math.floor(elapsedMonths / 12)}y`;
}

function ReviewSourceCountBadge({ count }: { count: number }) {
  return (
    <span className="disambiguated-digits rounded bg-token-foreground/10 px-1.5 py-0.5 text-xs font-medium text-token-description-foreground">
      {count}
    </span>
  );
}

function buildReviewJumpCanvasFont(style: CSSStyleDeclaration): string {
  return [
    style.fontStyle || "normal",
    style.fontVariant || "normal",
    style.fontWeight || "400",
    style.fontSize || "14px",
    style.fontFamily || "sans-serif",
  ].join(" ");
}

function createReviewJumpTextMeasurer(font: string): ((value: string) => number | null) | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.font = font;
  return (value: string) => {
    const width = context.measureText(value).width;
    return Number.isFinite(width) ? width : null;
  };
}

function ReviewJumpMiddleTruncatedText({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [measurement, setMeasurement] = useState<{
    font: string;
    maxWidthPx: number;
  } | null>(null);

  const updateMeasurement = useCallback(() => {
    if (!element || element.clientWidth <= 0) {
      setMeasurement(null);
      return;
    }

    const ownerWindow = element.ownerDocument.defaultView ?? window;
    const style = ownerWindow.getComputedStyle(element);
    const nextMeasurement = {
      font: buildReviewJumpCanvasFont(style),
      maxWidthPx: element.clientWidth,
    };
    setMeasurement((current) => (
      current?.font === nextMeasurement.font && current.maxWidthPx === nextMeasurement.maxWidthPx
        ? current
        : nextMeasurement
    ));
  }, [element]);

  useLayoutEffect(() => {
    updateMeasurement();
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => updateMeasurement());
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, updateMeasurement]);

  const renderedText = useMemo(() => {
    if (!measurement) return text;
    const measureTextWidth = createReviewJumpTextMeasurer(measurement.font);
    if (!measureTextWidth) return text;
    return middleTruncateReviewJumpText(text, measurement.maxWidthPx, measureTextWidth);
  }, [measurement, text]);

  const body = (
    <span
      ref={setElement}
      className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}
    >
      {renderedText}
    </span>
  );

  return (
    <NodexTooltip tooltipContent={text} disabled={renderedText === text}>
      {body}
    </NodexTooltip>
  );
}

function ReviewJumpFilePathLabel({ displayPath }: { displayPath: string }) {
  const { fileName, parentPath } = useMemo(() => splitReviewJumpToFilePath(displayPath), [displayPath]);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-token-foreground">{fileName}</span>
      {parentPath.length > 0 ? (
        <ReviewJumpMiddleTruncatedText
          className="min-w-0 flex-1 text-token-description-foreground"
          text={parentPath}
        />
      ) : null}
    </span>
  );
}

function buildReviewGitApplyCommand(diff: string): string {
  return ` (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' \n${diff.trimEnd()} \nEOF\n)`;
}

function isTranscriptReviewSource(source: ReviewSource): source is TranscriptReviewSource {
  return source === "selected-turn" || source === "last-turn";
}

function isGitReviewSource(source: ReviewSource): source is GitReviewSource {
  return source === "branch" || source === "commit" || source === "staged" || source === "unstaged";
}

function resolveReviewNoFilesEmptyStateCopy(
  source: ReviewSource,
  emptyReason: ReviewSnapshot["emptyReason"],
): ReviewEmptyStateCopy {
  if (source === "staged") {
    return {
      title: "No staged changes",
      description: "Accept edits to stage them",
      showIllustration: false,
      showViewBranchDiffAction: true,
    };
  }

  if (source === "unstaged") {
    return {
      title: "No unstaged changes",
      description: "Code changes will appear here",
      showIllustration: false,
      showViewBranchDiffAction: true,
    };
  }

  if (emptyReason === "noLongerAvailable") {
    return {
      title: "No file changes yet",
      description: source === "selected-turn"
        ? "The selected turn diff is no longer available."
        : "The latest diffs are no longer available.",
      showIllustration: true,
      showViewBranchDiffAction: source !== "branch",
    };
  }

  if (source === "last-turn") {
    return {
      title: "No file changes yet",
      description: "The last turn was committed or reverted.",
      showIllustration: true,
      showViewBranchDiffAction: true,
    };
  }

  return {
    title: "No file changes yet",
    description: "Changes in this project will appear here.",
    showIllustration: true,
    showViewBranchDiffAction: source !== "branch",
  };
}

function ReviewPanelIcon({ className }: { className?: string }) {
  return (
    <svg
      width="66"
      height="73"
      viewBox="0 0 66 73"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("h-18 w-auto text-token-input-placeholder-foreground", className)}
    >
      <path d={REVIEW_EMPTY_STATE_ILLUSTRATION_PATH} fill="currentColor" />
    </svg>
  );
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("icon-xs text-token-description-foreground", className)}>
      <path d="M15.6981 9.04712C16.5255 9.04712 17.1959 9.71781 17.1961 10.5452C17.1961 11.3727 16.5256 12.0442 15.6981 12.0442C14.8706 12.0442 14.2 11.3727 14.2 10.5452C14.2002 9.71781 14.8707 9.04712 15.6981 9.04712Z" fill="currentColor" />
      <path d="M4.69806 9.04712C5.52546 9.04712 6.19691 9.71781 6.19708 10.5452C6.19708 11.3727 5.52557 12.0442 4.69806 12.0442C3.8707 12.044 3.20001 11.3726 3.20001 10.5452C3.20019 9.71792 3.87081 9.04729 4.69806 9.04712Z" fill="currentColor" />
      <path d="M10.2003 9.04712C11.0276 9.0473 11.6982 9.71792 11.6984 10.5452C11.6984 11.3726 11.0277 12.044 10.2003 12.0442C9.37284 12.0442 8.70132 11.3727 8.70132 10.5452C8.7015 9.71781 9.37295 9.04712 10.2003 9.04712Z" fill="currentColor" />
    </svg>
  );
}

function normalizeReviewBasePath(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const normalizedPath = normalizePathSegments(cwd);
  return normalizedPath.length > 0 ? normalizedPath : null;
}

function resolveOpenLine(fileDiff: FileDiffMetadata): number | undefined {
  const firstHunk = fileDiff.hunks[0];
  if (!firstHunk) return undefined;

  const line = firstHunk.additionStart > 0 ? firstHunk.additionStart : firstHunk.deletionStart;
  return line > 0 ? line : 1;
}

function splitPatchByFiles(patch: string): string[] {
  const trimmedPatch = patch.trim();
  if (trimmedPatch.length === 0) return [];

  const lines = patch.split("\n");
  const patches: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && currentLines.length > 0) {
      patches.push(currentLines.join("\n").trimEnd());
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    const nextPatch = currentLines.join("\n").trimEnd();
    if (nextPatch.length > 0) {
      patches.push(nextPatch);
    }
  }

  return patches;
}

function buildReviewFileEntries(
  patch: string,
  basePath: string | null,
  parsePatchFiles: ReviewDiffPanelDeps["parsePatchFiles"],
): ReviewFileEntry[] {
  if (!patch.trim()) return [];

  try {
    const filePatches = splitPatchByFiles(patch);
    let flatFileIndex = 0;
    return parsePatchFiles(patch).flatMap((parsedPatch, patchIndex) =>
      parsedPatch.files.map((fileDiff, fileIndex) => {
        const additionsDeletions = summarizeFileDiffMetadata(fileDiff);
        const displayPath = stripPatchPrefix(fileDiff.name ?? fileDiff.prevName ?? `file-${patchIndex}-${fileIndex}`);
        const patchText = filePatches[flatFileIndex] ?? patch;
        flatFileIndex += 1;

        return {
          key: `${displayPath}:${patchIndex}:${fileIndex}`,
          displayPath,
          previousPath: fileDiff.prevName ?? null,
          gitStatus: null,
          patchText,
          openPath: resolveOpenPath(displayPath, basePath),
          openLine: resolveOpenLine(fileDiff),
          additions: additionsDeletions.additions,
          deletions: additionsDeletions.deletions,
          fileDiff,
        } satisfies ReviewFileEntry;
      }),
    );
  } catch {
    return [];
  }
}

function buildFullFileContents(
  pathName: string,
  contents: string,
): FileContents {
  return {
    name: pathName,
    contents,
    cacheKey: `${pathName}:${contents.length}`,
  };
}

function isTextualFullDiffCandidate(entry: ReviewFileEntry): boolean {
  return entry.additions + entry.deletions <= LARGE_DIFF_LINE_THRESHOLD;
}


function extractLastTurnPatchItem(items: CodexConversationItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    const rawItem = item.rawItem;
    if (typeof rawItem === "object" && rawItem !== null) {
      const unifiedDiff = (rawItem as { unifiedDiff?: unknown }).unifiedDiff;
      if (typeof unifiedDiff === "string" && unifiedDiff.trim().length > 0) {
        return unifiedDiff;
      }
    }
  }

  return null;
}

function buildLastTurnSnapshot(
  conversation: CodexConversationSnapshot | null,
  projectWorkspacePath: string | null | undefined,
  parsePatchFiles: ReviewDiffPanelDeps["parsePatchFiles"],
): ReviewSnapshot {
  const turn = conversation?.turns.at(-1) ?? null;
  const patch = typeof turn?.diff === "string" && turn.diff.trim().length > 0
    ? turn.diff
    : turn
      ? (extractLastTurnPatchItem(turn.items) ?? "")
      : "";
  const cwd = conversation?.cwd ?? projectWorkspacePath ?? null;
  const basePath = normalizeReviewBasePath(cwd);
  const files = buildReviewFileEntries(patch, basePath, parsePatchFiles);

  return {
    source: "last-turn",
    patch,
    files,
    cwd,
    isGitRepository: true,
    baseRef: null,
    currentBranch: null,
    defaultBranch: null,
    errorMessage: null,
    emptyReason: patch.trim().length === 0 ? "noLongerAvailable" : null,
  };
}

function buildSelectedTurnSnapshot(
  selectedTurnDiff: CodexTurnDiffReviewTarget | null | undefined,
  conversation: CodexConversationSnapshot | null,
  projectWorkspacePath: string | null | undefined,
  parsePatchFiles: ReviewDiffPanelDeps["parsePatchFiles"],
): ReviewSnapshot {
  const patch = selectedTurnDiff?.patch ?? "";
  const cwd = selectedTurnDiff?.cwd ?? conversation?.cwd ?? projectWorkspacePath ?? null;
  const basePath = normalizeReviewBasePath(cwd);
  const files = buildReviewFileEntries(patch, basePath, parsePatchFiles);

  return {
    source: "selected-turn",
    patch,
    files,
    cwd,
    isGitRepository: true,
    baseRef: null,
    currentBranch: null,
    defaultBranch: null,
    errorMessage: null,
    emptyReason: patch.trim().length === 0 ? "noLongerAvailable" : null,
  };
}

function buildGitSnapshot(
  gitSnapshot: GitReviewSnapshot | ReviewDiffResult | null,
  parsePatchFiles: ReviewDiffPanelDeps["parsePatchFiles"],
): ReviewSnapshot {
  const cwd = gitSnapshot?.cwd ?? null;
  const basePath = normalizeReviewBasePath(cwd);
  const patch = gitSnapshot?.patch ?? "";
  const statusByPath = new Map<string, GitReviewFileStatus | null>(
    (gitSnapshot?.files ?? []).map((file) => [stripPatchPrefix(file.path), file.status]),
  );
  const files = buildReviewFileEntries(patch, basePath, parsePatchFiles).map((file) => ({
    ...file,
    gitStatus: statusByPath.get(file.displayPath) ?? null,
  }));

  return {
    source: gitSnapshot?.source ?? "unstaged",
    patch,
    files,
    cwd,
    isGitRepository: gitSnapshot?.isGitRepository ?? false,
    baseRef: gitSnapshot?.baseRef ?? null,
    currentBranch: gitSnapshot?.currentBranch ?? null,
    defaultBranch: gitSnapshot?.defaultBranch ?? null,
    errorMessage: gitSnapshot?.errorMessage ?? null,
    emptyReason: patch.trim().length === 0 ? "noDiff" : null,
  };
}

const REVIEW_TOOLBAR_ICON_BUTTON_BASE_CLASS_NAME = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square items-center justify-center !px-0";
const REVIEW_TOOLBAR_ICON_BUTTON_IDLE_CLASS_NAME = "text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background";
const REVIEW_TOOLBAR_ICON_BUTTON_ACTIVE_CLASS_NAME = "text-token-foreground bg-token-foreground/5 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10";
const REVIEW_HEADER_ACTION_BUTTON_CLASS_NAME = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border-token-border text-token-button-tertiary-foreground bg-token-bg-fog enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border h-token-button-composer px-2 py-0 text-base leading-[18px] min-w-0 px-2 enabled:text-token-foreground gap-0 [@container_review-header_(max-width:624px)]:aspect-square [@container_review-header_(max-width:624px)]:justify-center [@container_review-header_(max-width:624px)]:!px-0";
const REVIEW_HEADER_ACTION_LABEL_CLASS_NAME = "hidden [@container_review-header_(min-width:625px)]:inline min-w-0 shrink-0 whitespace-nowrap";
const REVIEW_FILE_ROW_SURFACE_STYLE = {
  "--codex-diffs-surface": "var(--codex-diffs-surface-override, var(--color-token-main-surface-primary))",
  backgroundColor: "var(--codex-diffs-surface)",
} satisfies CSSProperties & Record<`--${string}`, string>;
const REVIEW_FILE_ROW_HEADER_STYLE = {
  backgroundColor: "color-mix(in srgb, var(--codex-diffs-surface) 88%, transparent)",
} satisfies CSSProperties;

function toolbarIconButtonClassName(options?: { active?: boolean; extraClassName?: string }): string {
  return cn(
    REVIEW_TOOLBAR_ICON_BUTTON_BASE_CLASS_NAME,
    options?.active ? REVIEW_TOOLBAR_ICON_BUTTON_ACTIVE_CLASS_NAME : REVIEW_TOOLBAR_ICON_BUTTON_IDLE_CLASS_NAME,
    options?.extraClassName,
  );
}

function toolbarSourceButtonClassName(): string {
  return "border-token-border user-select-none no-drag cursor-interaction flex h-7 w-fit max-w-[320px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-1.5 text-base leading-[18px] text-token-foreground outline-hidden enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background disabled:cursor-not-allowed disabled:opacity-40 electron:rounded-md";
}

function ReviewPanelEmptyState({
  title,
  description,
  illustration,
  action,
  className,
}: {
  title: string;
  description: string;
  illustration?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col items-center justify-center px-3 py-6 h-full", className)}>
      <div className="flex w-full max-w-xl flex-col items-center justify-center text-center gap-6">
        {illustration ? (
          <div className="pointer-events-none text-token-input-placeholder-foreground">
            <div className="flex justify-center">
              {illustration}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col items-center gap-2">
          <div className="font-medium text-base text-token-foreground">{title}</div>
          <div className="text-base text-token-description-foreground">{description}</div>
        </div>
        {action ? (
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReviewFileRow({
  entry,
  diffMode,
  wrap,
  wordDiffsEnabled,
  richPreviewEnabled,
  loadFullFilesEnabled,
  expanded,
  openerId,
  fullContents,
  fullContentsLoading,
  comments,
  deps,
  onToggleExpanded,
}: {
  entry: ReviewFileEntry;
  diffMode: ReviewDiffMode;
  wrap: boolean;
  wordDiffsEnabled: boolean;
  richPreviewEnabled: boolean;
  loadFullFilesEnabled: boolean;
  expanded: boolean;
  openerId: string;
  fullContents: GitReviewFileContents | null;
  fullContentsLoading: boolean;
  comments: ReviewCodeComment[];
  deps: ReviewDiffPanelDeps;
  onToggleExpanded: () => void;
}) {
  const {
    invoke,
    useTheme,
    FileDiff,
    MultiFileDiff,
  } = deps;
  const { resolved } = useTheme();
  const diffHostStyle = getNodexDiffHostStyle(resolved === "dark" ? "dark" : "light");
  const lineDiffType = wordDiffsEnabled && entry.additions + entry.deletions <= LARGE_DIFF_LINE_THRESHOLD
    ? "word-alt"
    : "none";
  const diffOptions = getNodexDiffOptions(resolved === "dark" ? "dark" : "light", true, {
    diffStyle: diffMode,
    wrap,
    lineDiffType,
  });
  const fullDiffRenderable = loadFullFilesEnabled
    && richPreviewEnabled
    && expanded
    && fullContents
    && fullContents.errorMessage === null
    && (fullContents.oldExists || fullContents.newExists);
  const oldFile = fullDiffRenderable
    ? buildFullFileContents(entry.previousPath ?? entry.displayPath, fullContents.oldText ?? "")
    : null;
  const newFile = fullDiffRenderable
    ? buildFullFileContents(entry.displayPath, fullContents.newText ?? "")
    : null;

  const openFile = () => {
    if (!entry.openPath) return;
    void invoke(
      "shell:open-file-link",
      {
        path: entry.openPath,
        ...(entry.openLine ? { line: entry.openLine } : {}),
      },
      openerId,
    );
  };

  return (
    <section
      data-review-path={entry.displayPath}
      className="group/file-diff flex flex-col overflow-clip pb-0.5 codex-review-diff-card extension:rounded-lg"
      style={REVIEW_FILE_ROW_SURFACE_STYLE}
    >
      <div
        className="cursor-interaction select-none focus-visible:outline-none z-10 sticky top-0 backdrop-blur-sm"
        style={REVIEW_FILE_ROW_HEADER_STYLE}
        onClick={onToggleExpanded}
      >
        <div>
          <div className="group/diff-header text-size-chat @container/diff-header relative flex items-center gap-2 py-0.5 ps-3 pe-2 hover:bg-token-list-hover-background bg-[color-mix(in_srgb,var(--color-token-main-surface-primary)_88%,transparent)] [.dark_&]:bg-[color-mix(in_srgb,var(--color-token-list-active-selection-background)_88%,transparent)] [.electron-dark_&]:bg-[color-mix(in_srgb,var(--color-token-list-active-selection-background)_88%,transparent)] mb-0.5">
            <div className="text-size-chat flex min-w-0 flex-1 items-center text-token-text-primary gap-0.5">
              <div className="flex min-w-0 items-center gap-2 pl-1">
                <FileTreeFileIcon className="size-4 shrink-0 text-token-description-foreground" />
                <span className="min-w-0" onClick={(event) => event.stopPropagation()}>
                  <FilenameButton
                    displayPath={entry.displayPath}
                    onOpen={entry.openPath ? openFile : null}
                    className="min-w-0 cursor-interaction truncate text-start text-token-text-primary select-text [direction:rtl]"
                  />
                </span>
              </div>
              <span className="shrink-0 opacity-0 group-focus-within/diff-header:opacity-100 group-hover/diff-header:opacity-100">
                <button
                  type="button"
                  data-app-action-review-file-expanded={String(expanded)}
                  data-app-action-review-file-toggle=""
                  className="border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-muted-foreground enabled:hover:bg-transparent data-[state=open]:bg-transparent hover:text-token-foreground border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square items-center justify-center !px-0 bg-transparent text-token-foreground"
                  aria-label="Toggle file diff"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleExpanded();
                  }}
                >
                  <ReviewFileToggleChevronIcon className={cn("icon-2xs transition-transform duration-200", expanded ? "rotate-90" : "rotate-0")} />
                </button>
              </span>
            </div>
            <div className="ms-auto flex items-center gap-0">
              <span className="flex shrink-0 items-center me-1">
                <DiffStats additions={entry.additions} deletions={entry.deletions} />
              </span>
              {entry.openPath ? (
                <button
                  type="button"
                  className="border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-muted-foreground enabled:hover:bg-transparent data-[state=open]:bg-transparent hover:text-token-foreground border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square items-center justify-center !px-0 text-token-text-tertiary hover:text-token-text-primary"
                  aria-label="Open in"
                  onClick={(event) => {
                    event.stopPropagation();
                    openFile();
                  }}
                >
                  <ReviewOpenInIcon className="icon-2xs" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {expanded ? (
        <div
          className="bg-token-main-surface-primary"
          data-code="true"
          data-unified={diffMode === "unified" ? "true" : "false"}
          data-container-size="regular"
        >
          {comments.length > 0 ? (
            <div className="border-b border-token-border bg-token-list-hover-background/40 px-3 py-2" data-review-code-comments="true">
              <div className="flex flex-col gap-2">
                {comments.map((comment) => (
                  <div
                    key={`${comment.file}:${comment.start ?? "file"}:${comment.title}:${comment.body}`}
                    className="grid grid-cols-[auto_1fr] gap-2 rounded-md border border-token-border/70 bg-token-main-surface-primary px-2.5 py-2 text-xs"
                  >
                    <div className="text-token-description-foreground">
                      {comment.start ? `L${comment.start}${comment.end && comment.end !== comment.start ? `-L${comment.end}` : ""}` : "File"}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-token-foreground">{comment.title}</div>
                      <div className="text-token-description-foreground">{comment.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {fullContentsLoading ? (
            <div className="px-3 py-3 text-sm text-token-description-foreground">Loading full file…</div>
          ) : fullContents?.errorMessage ? (
            <div className="px-3 py-3 text-sm text-token-charts-red">{fullContents.errorMessage}</div>
          ) : oldFile && newFile ? (
            <MultiFileDiff
              oldFile={oldFile}
              newFile={newFile}
              className={NODEX_DIFF_HOST_CLASS}
              style={diffHostStyle}
              options={diffOptions}
            />
          ) : (
            <FileDiff
              fileDiff={entry.fileDiff}
              className={NODEX_DIFF_HOST_CLASS}
              style={diffHostStyle}
              options={diffOptions}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

interface ReviewFileTreePaneProps {
  rows: ReviewFileTreeRow<ReviewFileEntry>[];
  fileFilter: string;
  onFileFilterChange: (value: string) => void;
  selectedTreeItemId: string | null;
  focusedTreeItemId: string | null;
  onSelectTreeItemId: (itemId: string) => void;
  onFocusTreeItemId: (itemId: string) => void;
  onSelectPath: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}

function ReviewFileTreeFlattenedLabel({ row }: { row: ReviewFileTreeRow<ReviewFileEntry> }) {
  if (row.flattenedParts.length === 0) {
    return row.label;
  }

  return (
    <span data-item-flattened-subitems="true">
      {row.hasLeadingSlash ? (
        <>
          <span data-item-flattened-subitem={row.flattenedParts[0]?.id ?? "root"} />
          {" / "}
        </>
      ) : null}
      {row.flattenedParts.map((part, index) => (
        <span key={part.id}>
          <span data-item-flattened-subitem={part.id}>{part.label}</span>
          {index === row.flattenedParts.length - 1 ? null : " / "}
        </span>
      ))}
    </span>
  );
}

function ReviewFileTreePane({
  rows,
  fileFilter,
  onFileFilterChange,
  selectedTreeItemId,
  focusedTreeItemId,
  onSelectTreeItemId,
  onFocusTreeItemId,
  onSelectPath,
  onToggleDirectory,
}: ReviewFileTreePaneProps) {
  const treeDomId = "review-file-tree";
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [range, setRange] = useState<ReviewFileTreeVirtualRange>({ start: 0, end: -1 });
  const [itemHeight, setItemHeight] = useState(REVIEW_FILE_TREE_FALLBACK_ITEM_HEIGHT_PX);
  const [viewportHeight, setViewportHeight] = useState(0);
  const isVirtualized = isReviewFileTreeVirtualizationEnabled(rows.length, REVIEW_FILE_TREE_VIRTUALIZE_THRESHOLD);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const selectedIndex = useMemo(
    () => resolveReviewFileTreeSelectedVisibleIndex(rows, focusedTreeItemId ?? selectedTreeItemId),
    [focusedTreeItemId, rows, selectedTreeItemId],
  );
  const layout = useMemo(
    () => getReviewFileTreeVirtualLayout({
      range,
      itemCount: rows.length,
      itemHeight,
      viewportHeight,
    }),
    [itemHeight, range, rows.length, viewportHeight],
  );
  const visibleRows = useMemo(() => {
    if (!isVirtualized) return rows.map((row, index) => ({ row, index }));
    if (range.end < range.start) return [];
    return rows.slice(range.start, range.end + 1).map((row, offset) => ({
      row,
      index: range.start + offset,
    }));
  }, [isVirtualized, range.end, range.start, rows]);

  useEffect(() => {
    if (!isVirtualized) return;

    const scrollNode = scrollRef.current;
    const listNode = listRef.current;
    if (!scrollNode || !listNode) return;

    const syncMeasurements = () => {
      const nextItemHeight = resolveReviewFileTreeItemHeight(listNode);
      const nextViewportHeight = scrollNode.clientHeight;
      const nextOffset = getReviewFileTreeOffset(listNode, scrollNode);

      setItemHeight((current) => current === nextItemHeight ? current : nextItemHeight);
      setViewportHeight((current) => current === nextViewportHeight ? current : nextViewportHeight);
      setRange((current) => {
        const nextRange = getReviewFileTreeVirtualRange({
          scrollTop: scrollNode.scrollTop,
          viewportHeight: nextViewportHeight,
          offset: nextOffset,
          itemCount: rows.length,
          itemHeight: nextItemHeight,
          overscan: REVIEW_FILE_TREE_VIRTUAL_OVERSCAN,
        }, current);
        return areReviewFileTreeRangesEqual(current, nextRange) ? current : nextRange;
      });
    };

    const handleScroll = () => {
      syncMeasurements();
      if (!("isScrolling" in listNode.dataset)) {
        listNode.dataset.isScrolling = "";
      }
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
      scrollTimerRef.current = setTimeout(() => {
        delete listNode.dataset.isScrolling;
        scrollTimerRef.current = null;
      }, 50);
    };

    syncMeasurements();
    scrollNode.addEventListener("scroll", handleScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(syncMeasurements);
    observer?.observe(scrollNode);

    return () => {
      scrollNode.removeEventListener("scroll", handleScroll);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
      delete listRef.current?.dataset.isScrolling;
      observer?.disconnect();
    };
  }, [isVirtualized, rows.length]);

  useEffect(() => {
    if (!isVirtualized) return;
    if (selectedIndex < 0) return;

    const scrollNode = scrollRef.current;
    const listNode = listRef.current;
    if (!scrollNode || !listNode) return;

    const offset = getReviewFileTreeOffset(listNode, scrollNode);

    const nextScrollTop = getReviewFileTreeScrollTopForIndex({
      scrollTop: scrollNode.scrollTop,
      viewportHeight: scrollNode.clientHeight,
      offset,
      itemHeight,
      index: selectedIndex,
    });
    if (nextScrollTop === scrollNode.scrollTop) return;

    scrollNode.scrollTop = nextScrollTop;
    setRange((current) => getReviewFileTreeVirtualRange({
      scrollTop: nextScrollTop,
      viewportHeight: scrollNode.clientHeight,
      offset,
      itemCount: rows.length,
      itemHeight,
      overscan: REVIEW_FILE_TREE_VIRTUAL_OVERSCAN,
    }, current));
  }, [isVirtualized, itemHeight, rows.length, selectedIndex]);

  const highlightedAncestorIds = useMemo(() => {
    const activeRow = rowById.get(focusedTreeItemId ?? selectedTreeItemId ?? "");
    return new Set(activeRow?.ancestorIds ?? []);
  }, [focusedTreeItemId, rowById, selectedTreeItemId]);

  const focusOrSelectTreeRow = (row: ReviewFileTreeRow<ReviewFileEntry>) => {
    onFocusTreeItemId(row.id);
    onSelectTreeItemId(row.id);
    if (row.type === "file") {
      onSelectPath(row.path);
      return;
    }
    onToggleDirectory(row.path);
  };

  const moveTreeSelection = (direction: -1 | 1) => {
    const currentIndex = rows.findIndex((row) => row.id === (focusedTreeItemId ?? selectedTreeItemId));
    const fallbackIndex = direction > 0 ? 0 : rows.length - 1;
    const nextIndex = currentIndex === -1
      ? fallbackIndex
      : Math.min(Math.max(currentIndex + direction, 0), rows.length - 1);
    const nextRow = rows[nextIndex];
    if (!nextRow) return;
    onFocusTreeItemId(nextRow.id);
    onSelectTreeItemId(nextRow.id);
    if (nextRow.type === "file") {
      onSelectPath(nextRow.path);
    }
  };

  const handleTreeRowKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    row: ReviewFileTreeRow<ReviewFileEntry>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTreeSelection(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTreeSelection(-1);
      return;
    }
    if (event.key === "ArrowRight" && row.type === "folder" && !row.isExpanded) {
      event.preventDefault();
      onFocusTreeItemId(row.id);
      onSelectTreeItemId(row.id);
      onToggleDirectory(row.path);
      return;
    }
    if (event.key === "ArrowLeft" && row.type === "folder" && row.isExpanded) {
      event.preventDefault();
      onFocusTreeItemId(row.id);
      onSelectTreeItemId(row.id);
      onToggleDirectory(row.path);
      return;
    }
    if (event.key === "ArrowLeft") {
      const parentId = row.ancestorIds.at(-1);
      if (!parentId) return;
      event.preventDefault();
      onFocusTreeItemId(parentId);
      onSelectTreeItemId(parentId);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      const nextRow = rows[0];
      if (!nextRow) return;
      onFocusTreeItemId(nextRow.id);
      onSelectTreeItemId(nextRow.id);
      if (nextRow.type === "file") {
        onSelectPath(nextRow.path);
      }
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const nextRow = rows.at(-1);
      if (!nextRow) return;
      onFocusTreeItemId(nextRow.id);
      onSelectTreeItemId(nextRow.id);
      if (nextRow.type === "file") {
        onSelectPath(nextRow.path);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusOrSelectTreeRow(row);
    }
  };

  const getTreeStatusSlot = (row: ReviewFileTreeRow<ReviewFileEntry>) => {
    if (row.gitStatus === "added") return "A";
    if (row.gitStatus === "deleted") return "D";
    return null;
  };

  const treeRows = visibleRows.map(({ row }) => {
    const indentationDepth = Math.max(0, row.level - 1);
    const statusSlot = getTreeStatusSlot(row);
    const buttonDomId = `${treeDomId}-${row.id}`;
    return (
      <button
        key={row.id}
        type="button"
        role="treeitem"
        aria-setsize={row.siblingCount}
        aria-posinset={row.siblingIndex}
        aria-selected={row.isSelected ? "true" : "false"}
        aria-label={row.path}
        aria-level={row.level}
        aria-expanded={row.type === "folder" ? row.isExpanded : undefined}
        tabIndex={row.isFocused ? 0 : -1}
        data-type="item"
        data-item-type={row.type}
        data-item-id={row.id}
        id={buttonDomId}
        data-review-tree-item="true"
        data-review-tree-path={row.path}
        data-item-selected={row.isSelected ? "true" : undefined}
        data-item-focused={row.isFocused ? "true" : undefined}
        data-item-search-match={row.isSearchMatch ? "true" : undefined}
        data-item-git-status={row.gitStatus ?? undefined}
        data-item-contains-git-change={row.containsGitChange ? "true" : undefined}
        data-item-locked={row.isLocked ? "true" : undefined}
        className={cn(
          "border-none relative mx-[var(--trees-item-margin-x)] flex w-full items-center gap-[var(--trees-item-row-gap)] rounded-[var(--trees-border-radius)] bg-token-main-surface-primary text-left outline-none",
          row.type === "file" && !row.isSelected ? "text-[var(--trees-file-fg)]" : "text-[var(--trees-fg)]",
          row.isSelected ? "bg-token-list-active-selection-background text-[var(--trees-selected-fg)] z-[3]" : "hover:bg-token-list-hover-background",
          row.isFocused ? "outline outline-1 -outline-offset-1 outline-token-list-focus-outline z-[2]" : undefined,
          row.isFocused && row.isSelected ? "outline-token-list-focus-outline" : undefined,
        )}
        style={{
          height: "var(--trees-row-height)",
          lineHeight: "var(--trees-row-height)",
          fontSize: "var(--trees-font-size)",
          paddingInline: "var(--trees-item-padding-x)",
        }}
        onFocus={() => onFocusTreeItemId(row.id)}
        onClick={() => focusOrSelectTreeRow(row)}
        onKeyDown={(event) => handleTreeRowKeyDown(event, row)}
      >
        {indentationDepth > 0 ? (
          <div
            data-item-section="spacing"
            className="flex items-center justify-center empty:pl-0"
            style={{
              height: "var(--trees-row-height)",
              paddingLeft: "calc(calc(var(--trees-icon-width) / 2) - 0.5px)",
            }}
          >
            {Array.from({ length: indentationDepth }).map((_, spacingIndex) => (
              <div
                key={`${row.id}:spacing:${spacingIndex + 1}`}
                data-item-section="spacing-item"
                data-ancestor-id={row.ancestorIds[spacingIndex] ?? `${row.id}:ancestor:${spacingIndex + 1}`}
                data-ancestor-active={highlightedAncestorIds.has(row.ancestorIds[spacingIndex] ?? "") ? "true" : undefined}
                className={cn(
                  "inline-block h-full shrink-0 translate-x-[-0.25px] border-l opacity-0 transition-opacity duration-150 ease-in group-hover/review-file-tree:opacity-75",
                  highlightedAncestorIds.has(row.ancestorIds[spacingIndex] ?? "") ? "opacity-100" : undefined,
                )}
                style={{
                  borderLeftColor: "var(--trees-indent-guide-bg)",
                  width: "0px",
                  marginRight: "calc(var(--trees-level-gap) - 1px)",
                  marginLeft: spacingIndex === 0
                    ? undefined
                    : "calc(var(--trees-item-row-gap) + calc(var(--trees-icon-width) / 2) - 0.5px)",
                }}
              />
            ))}
          </div>
        ) : null}
        <div
          data-item-section="icon"
          className={cn(
            "flex shrink-0 items-center justify-center text-[var(--trees-fg-muted)]",
            row.isSelected ? "text-[var(--trees-selected-fg)]" : undefined,
          )}
          style={{ width: "var(--trees-icon-width)" }}
        >
          {row.type === "folder" ? (
            <FileTreeChevronIcon className={cn("size-4 transition-transform", row.isExpanded ? undefined : "-rotate-90")} />
          ) : (
            <FileTreeFileIcon className="size-4" />
          )}
        </div>
        <div
          data-item-section="content"
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            row.type === "folder"
              ? "text-[var(--trees-fg)]"
              : row.isSelected
                ? "text-[var(--trees-selected-fg)]"
                : "text-[var(--trees-file-fg)]",
          )}
        >
          {row.type === "folder"
            ? <ReviewFileTreeFlattenedLabel row={row} />
            : row.label}
        </div>
        {statusSlot ? (
          <div
            data-item-section="git"
            className={cn(
              "flex w-3 shrink-0 items-center justify-center text-center",
              row.gitStatus === "added" ? "text-token-charts-green" : undefined,
              row.gitStatus === "deleted" ? "text-token-charts-red" : undefined,
              row.gitStatus ? "text-[11px] font-semibold leading-none" : undefined,
            )}
          >
            {statusSlot}
          </div>
        ) : null}
        {row.isLocked ? (
          <div data-item-section="lock" className="ml-auto flex shrink-0 items-center text-token-description-foreground">
            <FileTreeLockIcon />
          </div>
        ) : null}
      </button>
    );
  });

  return (
    <div
      className="group/review-file-tree flex h-full min-h-0 flex-col bg-token-main-surface-primary"
      data-file-tree-virtualized-wrapper={isVirtualized ? "true" : undefined}
      style={{
        ...(REVIEW_FILE_TREE_HOST_STYLE as CSSProperties),
        ...RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE,
      }}
    >
      <div data-file-tree-search-container="true" className="shrink-0 px-2 pt-2 pb-px">
        <label className="sr-only" htmlFor={REVIEW_FILE_TREE_SEARCH_INPUT_ID}>
          Filter files
        </label>
        <div className="relative flex h-token-button-composer w-full items-center gap-1.5 rounded-lg border border-token-border bg-token-bg-fog text-base leading-[18px]">
          <SearchIcon className="icon-xs ms-2 shrink-0 text-token-input-placeholder-foreground" />
          <input
            id={REVIEW_FILE_TREE_SEARCH_INPUT_ID}
            value={fileFilter}
            onChange={(event) => onFileFilterChange(event.target.value)}
            placeholder="Filter files…"
            data-file-tree-search-input="true"
            aria-controls={treeDomId}
            aria-activedescendant={focusedTreeItemId ? `${treeDomId}-${focusedTreeItemId}` : undefined}
            className="w-full appearance-none border-none bg-transparent py-0 ps-0 pe-1.5 text-token-foreground ring-0 outline-none select-text placeholder:text-token-input-placeholder-foreground focus:border-none focus:ring-0 focus:outline-none [&::placeholder]:select-none"
          />
          {fileFilter.length > 0 ? (
            <button
              type="button"
              aria-label="Clear file filter"
              className="flex size-7 shrink-0 cursor-interaction items-center justify-center rounded-md text-token-input-placeholder-foreground hover:text-token-foreground"
              onClick={() => onFileFilterChange("")}
            >
              <CodexCloseIcon className="icon-2xs" />
            </button>
          ) : null}
        </div>
      </div>
      <div
        className={cn("bg-token-main-surface-primary min-h-0 flex-1 overflow-x-hidden overflow-y-auto", isVirtualized ? "flex flex-col overflow-hidden" : undefined)}
        data-file-tree-virtualized-root={isVirtualized ? "true" : undefined}
      >
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-token-main-surface-primary px-2"
          data-file-tree-virtualized-scroll={isVirtualized ? "true" : undefined}
          style={RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE}
        >
          {rows.length === 0 ? (
            <div className="py-2 text-sm text-token-description-foreground">No matching files</div>
          ) : isVirtualized ? (
            <div
              ref={listRef}
              role="tree"
              id={treeDomId}
              className="relative min-h-full w-full [overflow-anchor:none]"
              data-file-tree-virtualized-list="true"
            >
              <div
                data-file-tree-virtualized-sticky-offset="true"
                aria-hidden="true"
                style={{ height: layout.offsetHeight }}
              />
              <div
                className="sticky flex flex-col"
                data-file-tree-virtualized-sticky="true"
                style={{
                  height: layout.windowHeight,
                  top: layout.stickyInset,
                  bottom: layout.stickyInset,
                }}
              >
                {treeRows}
              </div>
            </div>
          ) : (
            <div role="tree" id={treeDomId} className="flex flex-col">
              {treeRows}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ReviewDeferredRenderProps {
  defer: boolean;
  delayMs?: number;
  fallback: ReactNode;
  children: ReactNode;
}

function ReviewDeferredRender({
  defer,
  delayMs = 0,
  fallback,
  children,
}: ReviewDeferredRenderProps) {
  const [ready, setReady] = useState(() => !defer);

  useEffect(() => {
    if (!defer) {
      setReady(true);
      return;
    }

    setReady(false);
    const timerId = window.setTimeout(() => {
      setReady(true);
    }, delayMs);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [defer, delayMs]);

  if (!defer || ready) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

export function ReviewDiffPanel({
  conversation,
  projectWorkspacePath,
  selectedTurnDiff = null,
  initialSource = "last-turn",
  initialCommitSha = null,
  initialFileTreeOpen = false,
  deps,
}: ReviewDiffPanelProps) {
  const resolvedDeps = {
    ...DEFAULT_REVIEW_DIFF_PANEL_DEPS,
    ...deps,
  };
  const { invoke, parsePatchFiles } = resolvedDeps;
  const { opener } = useFileLinkOpener();
  const reviewContentRootRef = useRef<HTMLDivElement | null>(null);
  const reviewSplitRootRef = useRef<HTMLDivElement | null>(null);
  const [source, setSource] = useState<ReviewSource>(initialSource);
  const [commitSha, setCommitSha] = useState<string | null>(initialCommitSha?.trim() || null);
  const [diffMode, setDiffMode] = useState<ReviewDiffMode>("unified");
  const [hideWhitespace, setHideWhitespace] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [wordDiffsEnabled, setWordDiffsEnabled] = useState(false);
  const [richPreviewEnabled, setRichPreviewEnabled] = useState(false);
  const [loadFullFilesEnabled, setLoadFullFilesEnabled] = useState(false);
  const [fileTreeOpen, setFileTreeOpen] = useState(initialFileTreeOpen);
  const [fileTreeWidth, setFileTreeWidth] = useState(REVIEW_FILE_TREE_DEFAULT_WIDTH_PX);
  const [fileFilter, setFileFilter] = useState("");
  const [jumpToFileQuery, setJumpToFileQuery] = useState("");
  const deferredFileFilter = useDeferredValue(fileFilter);
  const deferredJumpToFileQuery = useDeferredValue(jumpToFileQuery);
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedTreeItemId, setSelectedTreeItemId] = useState<string | null>(null);
  const [focusedTreeItemId, setFocusedTreeItemId] = useState<string | null>(null);
  const [gitSnapshot, setGitSnapshot] = useState<GitReviewSnapshot | ReviewDiffResult | null>(null);
  const [gitLoadStatus, setGitLoadStatus] = useState<GitReviewLoadStatus>("idle");
  const [branchCommits, setBranchCommits] = useState<GitReviewBranchCommit[]>([]);
  const [branchCommitsLoadStatus, setBranchCommitsLoadStatus] = useState<BranchCommitsLoadStatus>("idle");
  const [branchCommitsError, setBranchCommitsError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [fullContentsByPath, setFullContentsByPath] = useState<Record<string, GitReviewFileContents>>({});
  const [fullContentsLoadingPaths, setFullContentsLoadingPaths] = useState<Record<string, boolean>>({});
  const gitLoadRequestIdRef = useRef(0);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const gitLoading = gitLoadStatus === "loading";

  const reviewCwd = isTranscriptReviewSource(source)
    ? (source === "selected-turn"
      ? (selectedTurnDiff?.cwd ?? conversation?.cwd ?? projectWorkspacePath ?? null)
      : (conversation?.cwd ?? projectWorkspacePath ?? null))
    : (projectWorkspacePath ?? conversation?.cwd ?? null);

  useEffect(() => {
    clearContentSearchMarks(reviewContentRootRef.current);
  }, [conversation?.threadId]);

  useEffect(() => {
    if (!selectedTurnDiff) {
      setSource((current) => current === "selected-turn" ? "last-turn" : current);
      return;
    }

    setSource("selected-turn");
  }, [selectedTurnDiff?.entryId, selectedTurnDiff?.patch]);

  useEffect(() => {
    if (source !== "commit" || commitSha) return;
    setSource("branch");
  }, [commitSha, source]);

  const selectReviewSource = (nextSource: ReviewSource) => {
    startTransition(() => {
      setSelectedPath(null);
      setSelectedTreeItemId(null);
      setFocusedTreeItemId(null);
      setSource(nextSource);
    });
  };

  const selectReviewCommit = (commit: GitReviewBranchCommit) => {
    startTransition(() => {
      setCommitSha(commit.sha);
      setSelectedPath(null);
      setSelectedTreeItemId(null);
      setFocusedTreeItemId(null);
      setSource("commit");
    });
  };

  const lastTurnSnapshot = useMemo(
    () => buildLastTurnSnapshot(conversation, projectWorkspacePath, parsePatchFiles),
    [conversation, parsePatchFiles, projectWorkspacePath],
  );
  const selectedTurnSnapshot = useMemo(
    () => buildSelectedTurnSnapshot(selectedTurnDiff, conversation, projectWorkspacePath, parsePatchFiles),
    [conversation, parsePatchFiles, projectWorkspacePath, selectedTurnDiff],
  );

  const loadGitSnapshot = async (
    nextSource: GitReviewSource,
    nextCwd: string,
  ): Promise<ReviewDiffResult> => {
    return invoke("git:review:diff", {
      cwd: nextCwd,
      source: nextSource,
      commitSha: nextSource === "commit" ? commitSha : null,
      hideWhitespace,
      operationSource: "review_model",
      requestId: `review:${nextCwd}:${nextSource}:${commitSha ?? ""}`,
    }) as Promise<ReviewDiffResult>;
  };

  const loadReviewFileContents = async (
    entry: ReviewFileEntry,
  ): Promise<GitReviewFileContents> => {
    if (isTranscriptReviewSource(source)) {
      throw new Error("Full-file review is only available for Git-backed review sources.");
    }

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) {
      throw new Error("Working directory is required to load full review files.");
    }

    return invoke("git:review:file-contents", {
      cwd: normalizedCwd,
      source,
      path: entry.displayPath,
      previousPath: entry.previousPath,
      baseRef: gitSnapshot?.baseRef ?? null,
      commitSha: source === "commit" ? commitSha : null,
    }) as Promise<GitReviewFileContents>;
  };

  useEffect(() => {
    if (isTranscriptReviewSource(source)) {
      setGitSnapshot(null);
      return;
    }

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) {
      setGitSnapshot(null);
      return;
    }

    let cancelled = false;
    const requestId = gitLoadRequestIdRef.current + 1;
    gitLoadRequestIdRef.current = requestId;
    setGitLoadStatus("loading");

    let timeoutTimerId: number | null = null;
    let loadTimerId: number | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimerId = window.setTimeout(() => {
        reject(new Error("timed-out"));
      }, REVIEW_DIFF_TIMEOUT_MS);
    });
    const loadPromise = new Promise<ReviewDiffResult>((resolve, reject) => {
      loadTimerId = window.setTimeout(() => {
        if (cancelled || gitLoadRequestIdRef.current !== requestId) return;
        void loadGitSnapshot(source, normalizedCwd).then(resolve, reject);
      }, REVIEW_DIFF_BATCH_DELAY_MS);
    });

    void Promise.race([loadPromise, timeoutPromise])
      .then((result) => {
        if (cancelled || gitLoadRequestIdRef.current !== requestId) return;
        setGitSnapshot(result as GitReviewSnapshot);
        setGitLoadStatus("loaded");
      })
      .catch((error) => {
        if (cancelled || gitLoadRequestIdRef.current !== requestId) return;
        const timedOut = error instanceof Error && error.message === "timed-out";
        setGitSnapshot({
          cwd: normalizedCwd,
          source,
          patch: "",
          files: [],
          isGitRepository: true,
          baseRef: null,
          currentBranch: null,
          defaultBranch: null,
          errorMessage: timedOut
            ? null
            : error instanceof Error
              ? error.message
              : "Could not load Git review snapshot.",
        });
        setGitLoadStatus(timedOut ? "timed-out" : "load-failed");
      });

    return () => {
      cancelled = true;
      if (timeoutTimerId !== null) {
        window.clearTimeout(timeoutTimerId);
      }
      if (loadTimerId !== null) {
        window.clearTimeout(loadTimerId);
      }
    };
  }, [commitSha, hideWhitespace, reviewCwd, source]);

  const snapshot = useMemo(() => {
    if (source === "selected-turn") return selectedTurnSnapshot;
    if (source === "last-turn") return lastTurnSnapshot;
    return buildGitSnapshot(gitSnapshot, parsePatchFiles);
  }, [gitSnapshot, lastTurnSnapshot, parsePatchFiles, selectedTurnSnapshot, source]);
  const selectedCommitSubject = useMemo(
    () => branchCommits.find((commit) => commit.sha === commitSha)?.subject ?? null,
    [branchCommits, commitSha],
  );
  const loadBranchCommits = async () => {
    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) return;

    setBranchCommitsLoadStatus("loading");
    setBranchCommitsError(null);
    try {
      const result = await invoke("git:review:branch-commits", {
        cwd: normalizedCwd,
        baseBranch: snapshot.baseRef ?? snapshot.defaultBranch,
        operationSource: "review_model",
        requestId: `review:${normalizedCwd}:branch-commits:${snapshot.baseRef ?? snapshot.defaultBranch ?? ""}`,
      }) as GitReviewBranchCommitsResult;
      setBranchCommits(result.commits);
      setBranchCommitsError(result.errorMessage);
      setBranchCommitsLoadStatus(result.errorMessage ? "error" : "loaded");
    } catch (error) {
      setBranchCommits([]);
      setBranchCommitsError(error instanceof Error ? error.message : "Unable to load commits");
      setBranchCommitsLoadStatus("error");
    }
  };
  const reviewCodeComments = useMemo(
    () => extractReviewCodeCommentsFromConversation(conversation),
    [conversation],
  );
  const totalChangedLines = useMemo(
    () => getReviewTotalChangedLines(snapshot.files),
    [snapshot.files],
  );
  const totalChangedBytes = useMemo(
    () => getReviewTotalChangedBytes(snapshot.patch),
    [snapshot.patch],
  );
  const isCappedMode = useMemo(
    () => isReviewLargeDiff({
      fileCount: snapshot.files.length,
      largestFileChangedLines: snapshot.files.reduce((largest, file) => Math.max(largest, file.additions + file.deletions), 0),
      totalChangedBytes,
      totalChangedLines,
    }),
    [snapshot.files, snapshot.files.length, totalChangedBytes, totalChangedLines],
  );

  useEffect(() => {
    setFullContentsByPath({});
    setFullContentsLoadingPaths({});
    clearContentSearchMarks(reviewContentRootRef.current);
  }, [snapshot.patch, source]);

  const filteredFiles = useMemo(
    () => filterReviewFiles(snapshot.files, deferredFileFilter),
    [deferredFileFilter, snapshot.files],
  );

  const fullFileTreeModel = useMemo(
    () => buildReviewFileTreeModel(snapshot.files),
    [snapshot.files],
  );
  const fileTreeGitStatusByPath = useMemo(() => {
    return new Map(snapshot.files.map((file) => [file.displayPath, file.gitStatus]));
  }, [snapshot.files]);
  const lockedTreePaths = useMemo(() => {
    return new Set(
      snapshot.files
        .filter((file) => file.openPath === null)
        .map((file) => file.displayPath),
    );
  }, [snapshot.files]);
  const fileTreeState = useMemo(
    () => buildReviewFileTreeVisibleState(snapshot.files, {
      fileFilterQuery: deferredFileFilter,
      expandedPaths: expandedDirectoryPaths,
      selectedTreeItemId,
      focusedTreeItemId,
      gitStatusByPath: fileTreeGitStatusByPath,
      lockedPaths: lockedTreePaths,
    }),
    [
      deferredFileFilter,
      expandedDirectoryPaths,
      fileTreeGitStatusByPath,
      focusedTreeItemId,
      lockedTreePaths,
      selectedTreeItemId,
      snapshot.files,
    ],
  );

  useEffect(() => {
    const nextExpandedKeys = snapshot.files.reduce<Set<string>>((acc, file) => {
      acc.add(file.key);
      return acc;
    }, new Set());
    setExpandedKeys(nextExpandedKeys);
  }, [source, snapshot.files]);

  useEffect(() => {
    const nextSelectedPath = resolveReviewSelectedPath(
      filteredFiles,
      selectedPath,
      isCappedMode,
    );
    if (nextSelectedPath === selectedPath) return;
    setSelectedPath(nextSelectedPath);
  }, [filteredFiles, isCappedMode, selectedPath]);

  useEffect(() => {
    setExpandedDirectoryPaths(new Set(buildReviewFileTreeDefaultExpandedPaths(snapshot.files)));
  }, [snapshot.files, source]);

  const selectedAncestorPaths = useMemo(
    () => buildReviewFileTreeExpandedPathsForSelection(fullFileTreeModel, selectedPath),
    [fullFileTreeModel, selectedPath],
  );

  useEffect(() => {
    if (selectedAncestorPaths.length === 0) return;
    setExpandedDirectoryPaths((current) => {
      let changed = false;
      const next = new Set(current);
      for (const ancestorPath of selectedAncestorPaths) {
        if (next.has(ancestorPath)) continue;
        next.add(ancestorPath);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [selectedAncestorPaths]);

  useEffect(() => {
    const currentSelectedNode = selectedTreeItemId
      ? fullFileTreeModel.nodesById.get(selectedTreeItemId) ?? null
      : null;
    if (currentSelectedNode?.type === "folder") {
      return;
    }

    const nextSelectedTreeItemId = resolveReviewFileTreeItemIdForPath(fullFileTreeModel, selectedPath);
    if (!nextSelectedTreeItemId) return;

    if (nextSelectedTreeItemId !== selectedTreeItemId) {
      setSelectedTreeItemId(nextSelectedTreeItemId);
    }
    if (nextSelectedTreeItemId !== focusedTreeItemId) {
      setFocusedTreeItemId(nextSelectedTreeItemId);
    }
  }, [focusedTreeItemId, fullFileTreeModel, selectedPath, selectedTreeItemId]);

  useEffect(() => {
    const visibleRowIds = new Set(fileTreeState.rows.map((row) => row.id));
    if (visibleRowIds.size === 0) {
      if (selectedTreeItemId !== null) setSelectedTreeItemId(null);
      if (focusedTreeItemId !== null) setFocusedTreeItemId(null);
      return;
    }

    const fallbackTreeItemId = resolveReviewFileTreeItemIdForPath(fileTreeState.model, selectedPath)
      ?? fileTreeState.rows[0]?.id
      ?? null;

    if (!selectedTreeItemId || !visibleRowIds.has(selectedTreeItemId)) {
      if (fallbackTreeItemId !== selectedTreeItemId) {
        setSelectedTreeItemId(fallbackTreeItemId);
      }
    }

    if (!focusedTreeItemId || !visibleRowIds.has(focusedTreeItemId)) {
      if (fallbackTreeItemId !== focusedTreeItemId) {
        setFocusedTreeItemId(fallbackTreeItemId);
      }
    }
  }, [fileTreeState.model, fileTreeState.rows, focusedTreeItemId, selectedPath, selectedTreeItemId]);

  const visibleFiles = useMemo(() => {
    return buildReviewVisibleFiles(
      filteredFiles,
      selectedPath,
      isCappedMode,
      false,
      REVIEW_CAPPED_MATCH_PAGE_SIZE,
    );
  }, [
    filteredFiles,
    isCappedMode,
    selectedPath,
  ]);
  const reviewRenderPlan = useMemo(
    () => buildReviewRenderPlan(visibleFiles, isCappedMode),
    [isCappedMode, visibleFiles],
  );
  const contentSearchSource = useMemo<ContentSearchLocalSource>(() => ({
    domain: "diff",
    contextId: `diff:${reviewCwd ?? "workspace"}:${source}`,
    search(query, limit) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return { query, matches: [], totalMatches: 0, capped: false };
      }

      const matches: ContentSearchLocalMatch[] = [];
      let capped = false;
      const cappedLimit = Math.min(limit, REVIEW_CONTENT_SEARCH_CAP);
      for (const entry of snapshot.files) {
        const occurrenceCount = countReviewOccurrences(
          entry,
          normalizedQuery,
          fullContentsByPath[entry.displayPath] ?? null,
        );
        for (let occurrenceIndex = 0; occurrenceIndex < occurrenceCount; occurrenceIndex += 1) {
          if (matches.length >= cappedLimit) {
            capped = true;
            break;
          }
          matches.push({
            id: `diff:${entry.displayPath}:0:${entry.openLine ?? 1}:${occurrenceIndex}`,
            domain: "diff",
            contextId: `diff:${reviewCwd ?? "workspace"}:${source}`,
            ordinal: matches.length,
            label: entry.displayPath,
            meta: {
              path: entry.displayPath,
              occurrenceIndex,
            },
          });
        }
        if (capped) break;
      }

      return {
        query,
        matches,
        totalMatches: matches.length,
        capped,
      };
    },
    async activate(match, query) {
      if (!isReviewSearchMatchMeta(match.meta)) return;
      const meta = match.meta;
      const entry = snapshot.files.find((file) => file.displayPath === meta.path);
      if (!entry) return;

      setSelectedPath(entry.displayPath);
      setExpandedKeys((current) => {
        if (current.has(entry.key)) return current;
        const next = new Set(current);
        next.add(entry.key);
        return next;
      });

      await nextAnimationFrame();
      const row = rowRefs.current.get(entry.displayPath);
      row?.scrollIntoView({ block: "start", inline: "nearest" });
      await nextAnimationFrame();

      const root = reviewContentRootRef.current;
      if (!root) return;
      const result = applyContentSearchDomMarks({
        root,
        query,
        idPrefix: "content-search:diff",
      });
      const rowSelector = `[data-review-path="${escapeAttributeSelectorValue(entry.displayPath)}"]`;
      const rowElement = root.querySelector<HTMLElement>(rowSelector);
      const rowMarks = Array.from(rowElement?.querySelectorAll<HTMLElement>(`mark.${CONTENT_SEARCH_MARK_CLASS}`) ?? []);
      const activeElement = rowMarks[meta.occurrenceIndex] ?? rowMarks[0] ?? result.matches[0]?.element ?? null;
      if (!activeElement) return;
      activeElement.classList.add(CONTENT_SEARCH_ACTIVE_MARK_CLASS);
      activeElement.scrollIntoView({ block: "center", inline: "nearest" });
    },
    clear() {
      clearContentSearchMarks(reviewContentRootRef.current);
    },
  }), [fullContentsByPath, reviewCwd, snapshot.files, source]);
  useRegisterContentSearchSource(contentSearchSource);
  const areAllDiffsExpanded = useMemo(() => {
    if (snapshot.files.length === 0) return false;
    return snapshot.files.every((entry) => expandedKeys.has(entry.key));
  }, [expandedKeys, snapshot.files]);
  const jumpToFileMatches = useMemo(() => {
    return selectReviewJumpToFileMatches(snapshot.files, deferredJumpToFileQuery);
  }, [deferredJumpToFileQuery, snapshot.files]);

  useEffect(() => {
    if (!selectedPath) return;
    const node = rowRefs.current.get(selectedPath);
    if (!node) return;
    node.scrollIntoView({ block: "start" });
  }, [selectedPath, visibleFiles]);

  const renderReviewRow = (entry: ReviewFileEntry, keyPrefix = "") => (
    <div
      key={`${keyPrefix}${entry.key}`}
      className="review-diff-virtualized [content-visibility:auto]"
      data-review-path={entry.displayPath}
      ref={(node) => {
        if (!node) {
          rowRefs.current.delete(entry.displayPath);
          return;
        }
        rowRefs.current.set(entry.displayPath, node);
      }}
      style={{ containIntrinsicSize: getReviewContainIntrinsicSize(entry.additions, entry.deletions, diffMode) }}
    >
      <ReviewFileRow
        entry={entry}
        diffMode={diffMode}
        wrap={wrap}
        wordDiffsEnabled={wordDiffsEnabled}
        richPreviewEnabled={richPreviewEnabled}
        loadFullFilesEnabled={loadFullFilesEnabled}
        expanded={expandedKeys.has(entry.key)}
        openerId={opener}
        fullContents={fullContentsByPath[entry.displayPath] ?? null}
        fullContentsLoading={Boolean(fullContentsLoadingPaths[entry.displayPath])}
        comments={filterReviewCodeCommentsForPath(reviewCodeComments, entry.displayPath)}
        deps={resolvedDeps}
        onToggleExpanded={() => {
          setExpandedKeys((current) => {
            const next = new Set(current);
            if (next.has(entry.key)) {
              next.delete(entry.key);
            } else {
              next.add(entry.key);
            }
            return next;
          });
        }}
      />
    </div>
  );
  const reviewRows = reviewRenderPlan.visibleFiles.map((entry) => renderReviewRow(entry));
  const reviewFallbackRows = reviewRenderPlan.fallbackFiles.map((entry) => renderReviewRow(entry, "fallback:"));

  const refreshGitSnapshot = async (): Promise<void> => {
    if (!isGitReviewSource(source)) return;

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) return;

    setGitLoadStatus("loading");
    try {
      const result = await loadGitSnapshot(source, normalizedCwd);
      startTransition(() => {
        setGitSnapshot(result);
      });
      setGitLoadStatus("loaded");
    } catch (error) {
      setGitLoadStatus("load-failed");
      toast.danger(error instanceof Error ? error.message : "Could not refresh review.", {
        id: "review-diff-notice",
      });
    }
  };

  useEffect(() => {
    if (!loadFullFilesEnabled || isTranscriptReviewSource(source)) return;

    const nextEntries = visibleFiles.filter((entry) => {
      if (!isTextualFullDiffCandidate(entry)) return false;
      if (fullContentsByPath[entry.displayPath]) return false;
      return !fullContentsLoadingPaths[entry.displayPath];
    });
    if (nextEntries.length === 0) return;

    let cancelled = false;
    startTransition(() => {
      setFullContentsLoadingPaths((current) => {
        const next = { ...current };
        for (const entry of nextEntries) {
          next[entry.displayPath] = true;
        }
        return next;
      });
    });

    void Promise.all(
      nextEntries.map(async (entry) => {
        const result = await loadReviewFileContents(entry).catch((error) => ({
          path: entry.displayPath,
          previousPath: entry.previousPath,
          oldText: null,
          newText: null,
          oldExists: false,
          newExists: false,
          errorMessage: error instanceof Error ? error.message : "Could not load full review file.",
        }));
        return { entry, result };
      }),
    ).then((results) => {
      if (cancelled) return;
      startTransition(() => {
        setFullContentsByPath((current) => {
          const next = { ...current };
          for (const { entry, result } of results) {
            next[entry.displayPath] = result;
          }
          return next;
        });
        setFullContentsLoadingPaths((current) => {
          const next = { ...current };
          for (const { entry } of results) {
            delete next[entry.displayPath];
          }
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    fullContentsByPath,
    fullContentsLoadingPaths,
    loadFullFilesEnabled,
    source,
    visibleFiles,
  ]);

  const handleCreateGitRepository = async () => {
    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) return;

    setGitLoadStatus("loading");
    try {
      const result = await invoke("git:init", normalizedCwd) as GitReviewSnapshot;
      startTransition(() => {
        setGitSnapshot(result);
      });
      setGitLoadStatus("loaded");
      toast.success("Created a Git repository for this workspace.", {
        id: "review-diff-notice",
      });
    } finally {
      setGitLoadStatus("idle");
    }
  };

  const startThreadPrompt = async (prompt: string) => {
    const threadId = conversation?.threadId ?? null;
    if (!threadId) return;

    try {
      await invoke("codex:turn:start", threadId, prompt);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not start Codex turn.", {
        id: "review-diff-notice",
      });
    }
  };

  const commitOrPushPrompt = "Commit or push the reviewed workspace changes. Inspect the current Git state first, then choose the smallest appropriate commit or push action.";
  const createPrPrompt = "Create a pull request for the reviewed branch changes. Inspect the branch, remote, and merge base first, then open a PR with an accurate title and summary.";
  const canUseThreadGitActions = Boolean(conversation?.threadId && snapshot.isGitRepository && reviewCwd);
  const reviewOptionsWordWrapLabel = wrap ? "Disable word wrap" : "Enable word wrap";
  const reviewOptionsExpandLabel = areAllDiffsExpanded ? "Collapse all diffs" : "Expand all diffs";
  const reviewOptionsFullFilesLabel = loadFullFilesEnabled ? "Don't load full files" : "Load full files";
  const reviewOptionsRichPreviewLabel = richPreviewEnabled ? "Disable rich preview" : "Enable rich preview";
  const reviewOptionsWordDiffsLabel = wordDiffsEnabled ? "Disable word diffs" : "Enable word diffs";
  const reviewOptionsWhitespaceLabel = hideWhitespace ? "Show white space" : "Hide white space";
  const canCopyGitApplyCommand = isGitReviewSource(source) && snapshot.patch.trim().length > 0;

  const handleCopyGitApplyCommand = async () => {
    if (!canCopyGitApplyCommand) return;

    const copied = await writeTextToClipboard(buildReviewGitApplyCommand(snapshot.patch));
    if (copied) {
      toast.success("Copied git apply command to the clipboard", {
        id: "review-diff-notice",
      });
      return;
    }

    toast.danger("Could not copy git apply command.", {
      id: "review-diff-notice",
    });
  };

  const sourceTrigger = (
    <button type="button" className={toolbarSourceButtonClassName()} aria-label="Review source">
      <span className="flex max-w-full min-w-0 items-center gap-1.5 truncate">{SOURCE_LABELS[source]}</span>
      <ChevronDownIcon className="icon-2xs text-token-description-foreground" />
    </button>
  );

  const optionsTrigger = (
    <button type="button" className={toolbarIconButtonClassName()} aria-label="Review options">
      <MoreHorizontalIcon />
    </button>
  );

  const jumpToFileTrigger = (
    <button type="button" className={toolbarIconButtonClassName()} aria-label="Jump to file">
      <ReviewJumpToFileIcon className="icon-xs text-token-description-foreground" />
    </button>
  );
  const diffModeLabel = diffMode === "unified" ? "Switch to split diff" : "Switch to unified diff";
  const toggleFileTreeLabel = fileTreeOpen ? "Hide files" : "Show files";
  const handleToggleDirectory = (path: string) => {
    setExpandedDirectoryPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  const handleFileTreeResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const ownerDocument = event.currentTarget.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const splitRoot = reviewSplitRootRef.current;
    if (!ownerWindow || !splitRoot) return;

    const startX = event.clientX;
    const startWidth = fileTreeWidth;
    const maxWidth = Math.max(
      REVIEW_FILE_TREE_MIN_WIDTH_PX,
      splitRoot.getBoundingClientRect().width * REVIEW_FILE_TREE_MAX_WIDTH_RATIO,
    );
    const clampWidth = (width: number) =>
      Math.min(maxWidth, Math.max(REVIEW_FILE_TREE_MIN_WIDTH_PX, Math.round(width)));

    const previousCursor = ownerDocument.body.style.cursor;
    const previousUserSelect = ownerDocument.body.style.userSelect;
    ownerDocument.body.style.cursor = "col-resize";
    ownerDocument.body.style.userSelect = "none";

    const cleanup = () => {
      ownerWindow.removeEventListener("pointermove", handlePointerMove);
      ownerWindow.removeEventListener("pointerup", handlePointerUp);
      ownerWindow.removeEventListener("pointercancel", handlePointerCancel);
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.body.style.userSelect = previousUserSelect;
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setFileTreeWidth(clampWidth(startWidth - (moveEvent.clientX - startX)));
    };
    const handlePointerUp = () => {
      cleanup();
    };
    const handlePointerCancel = () => {
      cleanup();
    };

    ownerWindow.addEventListener("pointermove", handlePointerMove);
    ownerWindow.addEventListener("pointerup", handlePointerUp);
    ownerWindow.addEventListener("pointercancel", handlePointerCancel);
  };

  if (!reviewCwd) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
        <ReviewPanelEmptyState
          title="No review workspace available"
          description="Start or open a local thread with a project workspace to review file changes here."
          illustration={<ReviewPanelIcon />}
        />
      </div>
    );
  }

  const canViewBranchDiffFromEmptyState = snapshot.isGitRepository
    && reviewCwd.trim().length > 0
    && source !== "branch";
  const noFilesEmptyStateCopy = resolveReviewNoFilesEmptyStateCopy(source, snapshot.emptyReason);
  const viewBranchDiffAction = noFilesEmptyStateCopy.showViewBranchDiffAction && canViewBranchDiffFromEmptyState ? (
    <button
      type="button"
      className={REVIEW_EMPTY_STATE_ACTION_BUTTON_CLASS_NAME}
      onClick={() => selectReviewSource("branch")}
    >
      View branch diff
    </button>
  ) : null;
  const emptyStateIllustration = noFilesEmptyStateCopy.showIllustration
    ? <ReviewPanelIcon />
    : undefined;
  const fileTreePane = fileTreeOpen ? (
    <div
      className="relative flex h-full shrink-0 border-l border-token-border-default"
      style={{
        maxWidth: `${REVIEW_FILE_TREE_MAX_WIDTH_RATIO * 100}%`,
        opacity: 1,
        width: fileTreeWidth,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        className="group absolute flex touch-none select-none z-40 top-0 bottom-0 left-0 w-4 -translate-x-2 cursor-col-resize active:cursor-col-resize"
        onPointerDown={handleFileTreeResizePointerDown}
        onDoubleClick={() => setFileTreeWidth(REVIEW_FILE_TREE_DEFAULT_WIDTH_PX)}
      >
        <div className="sidebar-resize-handle-line pointer-events-none m-auto opacity-0 h-full w-px bg-gradient-to-b from-transparent via-token-foreground/25 to-transparent group-hover:opacity-100 group-active:opacity-100" />
      </div>
      <div
        className="flex h-full min-h-0 w-full flex-col"
        data-file-tree-virtualized={isReviewFileTreeVirtualizationEnabled(fileTreeState.rows.length, REVIEW_FILE_TREE_VIRTUALIZE_THRESHOLD) ? "true" : undefined}
      >
        <ReviewFileTreePane
          rows={fileTreeState.rows}
          fileFilter={fileFilter}
          onFileFilterChange={setFileFilter}
          selectedTreeItemId={selectedTreeItemId}
          focusedTreeItemId={focusedTreeItemId}
          onSelectTreeItemId={setSelectedTreeItemId}
          onFocusTreeItemId={setFocusedTreeItemId}
          onSelectPath={setSelectedPath}
          onToggleDirectory={handleToggleDirectory}
        />
      </div>
    </div>
  ) : null;
  const reviewMainContent = gitLoadStatus === "loading" && isGitReviewSource(source) ? (
    <div className="flex h-full w-full items-center justify-center text-sm text-token-description-foreground">Loading review…</div>
  ) : gitLoadStatus === "timed-out" && isGitReviewSource(source) ? (
    <ReviewPanelEmptyState
      title="Review timed out"
      description="The diff request took longer than 15 seconds. Try again or narrow the review target."
      illustration={<ReviewPanelIcon />}
      action={(
        <button
          type="button"
          className={REVIEW_EMPTY_STATE_ACTION_BUTTON_CLASS_NAME}
          onClick={() => void refreshGitSnapshot()}
        >
          Retry
        </button>
      )}
    />
  ) : snapshot.errorMessage ? (
    <ReviewPanelEmptyState
      title="Could not load review"
      description={snapshot.errorMessage}
      illustration={<ReviewPanelIcon />}
    />
  ) : !snapshot.isGitRepository && isGitReviewSource(source) ? (
    <ReviewPanelEmptyState
      title="Create a Git repository"
      description="Track, review, and undo changes in this project."
      illustration={<ReviewPanelIcon />}
      action={(
        <button
          type="button"
          className={REVIEW_EMPTY_STATE_ACTION_BUTTON_CLASS_NAME}
          onClick={handleCreateGitRepository}
        >
          Create repository
        </button>
      )}
    />
  ) : snapshot.files.length === 0 ? (
    <ReviewPanelEmptyState
      title={noFilesEmptyStateCopy.title}
      description={noFilesEmptyStateCopy.description}
      illustration={emptyStateIllustration}
      action={viewBranchDiffAction}
    />
  ) : visibleFiles.length === 0 ? (
    <ReviewPanelEmptyState
      title="No review matches"
      description="Try a different file filter or review search query."
    />
  ) : (
    <div
      ref={reviewContentRootRef}
      className="electron:bg-token-main-surface-primary flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-3"
      style={RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE}
    >
      {isCappedMode ? (
        <div className="bg-token-surface-muted text-token-foreground-muted mb-3 rounded-md px-3 py-2 text-xs">
          Large diff detected — showing one file at a time.
        </div>
      ) : null}
      <div className="flex w-full flex-col extension:pl-4 extension:pr-1">
        <div className="flex flex-col extension:gap-2">
          <ReviewDeferredRender
            defer={reviewRenderPlan.shouldDefer}
            fallback={reviewFallbackRows}
          >
            {reviewRows}
          </ReviewDeferredRender>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative h-full min-h-0 bg-token-main-surface-primary">
      <div className="relative grid h-full min-h-0 w-full grid-rows-[auto_1fr]">
        <div className="h-toolbar-pane border-b bg-token-main-surface-primary [container-name:review-header] [container-type:inline-size] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-token-border px-2 py-1 text-token-description-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 font-medium text-token-foreground">
              <NodexDropdownMenu triggerButton={sourceTrigger} align="start" sideOffset={8} contentWidth="menuBounded">
                <NodexDropdownItem
                  onSelect={() => selectReviewSource("unstaged")}
                  rightSlot={source === "unstaged" ? <CheckmarkIcon className="size-4" /> : null}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">Unstaged</span>
                    {source === "unstaged" && snapshot.files.length > 0 ? <ReviewSourceCountBadge count={snapshot.files.length} /> : null}
                  </span>
                </NodexDropdownItem>
                <NodexDropdownItem
                  onSelect={() => selectReviewSource("staged")}
                  rightSlot={source === "staged" ? <CheckmarkIcon className="size-4" /> : null}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">Staged</span>
                    {source === "staged" && snapshot.files.length > 0 ? <ReviewSourceCountBadge count={snapshot.files.length} /> : null}
                  </span>
                </NodexDropdownItem>
                <NodexDropdownFlyoutSubmenuItem
                  label="Commit"
                  onOpenChange={(open) => {
                    if (!open) return;
                    void loadBranchCommits();
                  }}
                  contentClassName="min-w-[320px]"
                >
                  {branchCommitsLoadStatus === "loading" ? (
                    <NodexDropdownMessage compact>Loading commits...</NodexDropdownMessage>
                  ) : branchCommitsLoadStatus === "error" ? (
                    <>
                      <NodexDropdownMessage compact tone="error">
                        {branchCommitsError ?? "Unable to load commits"}
                      </NodexDropdownMessage>
                      <NodexDropdownItem onSelect={() => void loadBranchCommits()}>
                        Retry
                      </NodexDropdownItem>
                    </>
                  ) : branchCommits.length === 0 ? (
                    <NodexDropdownMessage compact>No commits on branch</NodexDropdownMessage>
                  ) : (
                    <NodexDropdownScrollList className="max-h-80">
                      {branchCommits.map((commit) => {
                        const relativeTime = formatReviewCommitRelativeTime(commit.committedAt);
                        return (
                          <NodexDropdownItem
                            key={commit.sha}
                            onSelect={() => selectReviewCommit(commit)}
                            tooltipText={commit.subject}
                            rightSlot={source === "commit" && commitSha === commit.sha ? <CheckmarkIcon className="size-4" /> : null}
                          >
                            <span className="flex min-w-0 items-center justify-between gap-3">
                              <span className="min-w-0 truncate">{commit.subject}</span>
                              {relativeTime ? (
                                <span className="shrink-0 text-xs text-token-description-foreground">
                                  {relativeTime} ago
                                </span>
                              ) : null}
                            </span>
                          </NodexDropdownItem>
                        );
                      })}
                    </NodexDropdownScrollList>
                  )}
                </NodexDropdownFlyoutSubmenuItem>
                <NodexDropdownItem
                  onSelect={() => selectReviewSource("branch")}
                  rightSlot={source === "branch" ? <CheckmarkIcon className="size-4" /> : null}
                >
                  Branch
                </NodexDropdownItem>
                <NodexDropdownItem
                  onSelect={() => selectReviewSource("last-turn")}
                  rightSlot={source === "last-turn" || source === "selected-turn" ? <CheckmarkIcon className="size-4" /> : null}
                >
                  Last turn
                </NodexDropdownItem>
              </NodexDropdownMenu>
            </div>
            {source === "commit" && selectedCommitSubject ? (
              <span className="max-w-[320px] truncate text-token-description-foreground">
                {selectedCommitSubject}
              </span>
            ) : null}
            <DiffStats additions={snapshot.files.reduce((total, file) => total + file.additions, 0)} deletions={snapshot.files.reduce((total, file) => total + file.deletions, 0)} className={REVIEW_AGGREGATE_DIFF_STATS_CLASS_NAME} />
          </div>
          <div className="flex min-w-0 flex-shrink-0 items-center gap-1">
            <NodexDropdownMenu triggerButton={optionsTrigger} align="end" sideOffset={8} contentWidth="menu">
              {isGitReviewSource(source) ? (
                <NodexDropdownItem
                  onSelect={() => void refreshGitSnapshot()}
                  disabled={gitLoading}
                  leftSlot={<ReviewRefreshIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
                >
                  Refresh
                </NodexDropdownItem>
              ) : null}
              <NodexDropdownItem
                onSelect={() => setWrap((current) => !current)}
                leftSlot={wrap
                  ? <ReviewDisableWordWrapIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />
                  : <ReviewEnableWordWrapIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
              >
                {reviewOptionsWordWrapLabel}
              </NodexDropdownItem>
              <NodexDropdownItem
                onSelect={() => setExpandedKeys(areAllDiffsExpanded ? new Set() : new Set(snapshot.files.map((file) => file.key)))}
                leftSlot={areAllDiffsExpanded
                  ? <ReviewCollapseAllDiffsIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />
                  : <ReviewExpandAllDiffsIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
              >
                {reviewOptionsExpandLabel}
              </NodexDropdownItem>
              <NodexDropdownSeparator />
              <NodexDropdownItem
                onSelect={() => setLoadFullFilesEnabled((current) => !current)}
                disabled={isTranscriptReviewSource(source)}
                leftSlot={<ReviewFullFilesIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
              >
                {reviewOptionsFullFilesLabel}
              </NodexDropdownItem>
              <NodexDropdownItem
                onSelect={() => setRichPreviewEnabled((current) => !current)}
                leftSlot={richPreviewEnabled
                  ? <ReviewDisableRichPreviewIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />
                  : <ReviewRichPreviewIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
              >
                {reviewOptionsRichPreviewLabel}
              </NodexDropdownItem>
              <NodexDropdownItem
                onSelect={() => setWordDiffsEnabled((current) => !current)}
                leftSlot={wordDiffsEnabled
                  ? <ReviewDisableWordDiffsIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />
                  : <ReviewWordDiffsIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
              >
                {reviewOptionsWordDiffsLabel}
              </NodexDropdownItem>
              <NodexDropdownItem
                onSelect={() => setHideWhitespace((current) => !current)}
                disabled={!isGitReviewSource(source)}
                leftSlot={<ReviewHideWhitespaceIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
              >
                {reviewOptionsWhitespaceLabel}
              </NodexDropdownItem>
              <NodexDropdownItem
                onSelect={() => void handleCopyGitApplyCommand()}
                disabled={!canCopyGitApplyCommand}
                leftSlot={<ReviewFileDocumentIcon className={REVIEW_OPTIONS_MENU_ICON_CLASS_NAME} />}
              >
                Copy git apply command
              </NodexDropdownItem>
            </NodexDropdownMenu>
            <NodexDropdownMenu
              triggerButton={jumpToFileTrigger}
              align="end"
              sideOffset={8}
              contentWidth="panelWide"
              contentMaxHeight="list"
            >
              <NodexDropdownSearchInput
                value={jumpToFileQuery}
                onChange={(event) => setJumpToFileQuery(event.target.value)}
                placeholder="Jump to file"
                aria-label="Jump to file"
              />
              {jumpToFileMatches.length === 0 ? (
                <NodexDropdownMessage compact>No matching files</NodexDropdownMessage>
              ) : (
                jumpToFileMatches.map((file) => (
                  <NodexDropdownItem
                    key={file.key}
                    allowWrap
                    onSelect={() => {
                      setSelectedPath(file.displayPath);
                      setJumpToFileQuery("");
                    }}
                    rightSlot={selectedPath === file.displayPath ? <CheckmarkIcon className="size-4" /> : null}
                  >
                    <ReviewJumpFilePathLabel displayPath={file.displayPath} />
                  </NodexDropdownItem>
                ))
              )}
            </NodexDropdownMenu>
            <button
              type="button"
              className={toolbarIconButtonClassName()}
              aria-label={diffModeLabel}
              onClick={() => setDiffMode((current) => current === "unified" ? "split" : "unified")}
            >
              {diffMode === "unified" ? <ReviewSplitDiffIcon className="icon-xs" /> : <ReviewUnifiedDiffIcon className="icon-xs" />}
            </button>
            <button
              type="button"
              className={toolbarIconButtonClassName({ active: fileTreeOpen })}
              aria-label={toggleFileTreeLabel}
              onClick={() => setFileTreeOpen((current) => !current)}
            >
              <CodexSidePanelFilesIcon className="icon-sm" />
            </button>
            <button
              type="button"
              className={REVIEW_HEADER_ACTION_BUTTON_CLASS_NAME}
              aria-label="Commit or push"
              disabled={!canUseThreadGitActions}
              onClick={() => void startThreadPrompt(commitOrPushPrompt)}
            >
              <ReviewCommitOrPushIcon className="icon-xs shrink-0" />
              <span className={REVIEW_HEADER_ACTION_LABEL_CLASS_NAME}>Commit or push</span>
            </button>
            <button
              type="button"
              className={REVIEW_HEADER_ACTION_BUTTON_CLASS_NAME}
              aria-label="Create PR"
              disabled={!canUseThreadGitActions}
              onClick={() => void startThreadPrompt(createPrPrompt)}
            >
              <ReviewCreatePrIcon className="icon-xs shrink-0" />
              <span className={REVIEW_HEADER_ACTION_LABEL_CLASS_NAME}>Create PR</span>
            </button>
          </div>
        </div>

        <div ref={reviewSplitRootRef} className="flex min-h-0 max-w-full min-w-0">
          {reviewMainContent}
          {fileTreePane}
        </div>
      </div>
    </div>
  );
}
