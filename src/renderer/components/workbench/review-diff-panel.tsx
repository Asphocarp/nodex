import { parsePatchFiles } from "@pierre/diffs";
import type { FileContents } from "@pierre/diffs";
import { FileDiff, MultiFileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ChevronDownIcon,
  CheckmarkIcon,
  FileTreeChevronIcon,
  FileTreeDotIcon,
  FileTreeFileIcon,
  FileTreeLockIcon,
  RefreshIcon,
  ReviewCollapseAllDiffsIcon,
  ReviewDisableWordWrapIcon,
  ReviewEnableWordWrapIcon,
  ReviewExpandAllDiffsIcon,
  ReviewFileDocumentIcon,
  ReviewRichPreviewIcon,
  ReviewSplitDiffIcon,
  ReviewUnifiedDiffIcon,
  ReviewWordDiffsIcon,
  SearchIcon,
} from "../shared/icons";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSeparator,
} from "../ui/dropdown";
import { writeTextToClipboard } from "@/lib/clipboard";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "@/lib/diff-presentation";
import {
  buildReviewRenderPlan,
  buildReviewSearchMatches,
  filterReviewFiles,
  buildReviewVisibleFiles,
  getReviewContainIntrinsicSize,
  getReviewTotalChangedBytes,
  getReviewTotalChangedLines,
  isReviewLargeDiff,
  resolveReviewSelectedPath,
  REVIEW_CAPPED_MATCH_PAGE_SIZE,
  type ReviewSearchMatch,
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
import { invoke } from "@/lib/api";
import { useFileLinkOpener } from "@/lib/use-file-link-opener";
import { useTheme } from "@/lib/use-theme";
import type {
  CodexConversationItem,
  CodexConversationSnapshot,
  GitApplyPatchResult,
  GitReviewFileContents,
  GitReviewFileStatus,
  GitReviewSearchResult,
  GitReviewSnapshot,
  GitReviewSource,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DiffStats,
  FilenameButton,
  basename,
  normalizePathSegments,
  resolveOpenPath,
  stripPatchPrefix,
  summarizeFileDiffMetadata,
} from "@/features/local-conversation/view/shared/tools/diff-file-shared";

type ReviewSource = "last-turn" | GitReviewSource;
type ReviewDiffMode = "unified" | "split";

interface ReviewDiffPanelProps {
  conversation: CodexConversationSnapshot | null;
  projectWorkspacePath?: string | null;
  initialSource?: ReviewSource;
  initialFileTreeOpen?: boolean;
  searchOpenTick?: number;
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

type ReviewGitFileAction = "stage" | "unstage" | "revert";
type ReviewGitPatchScope = "file" | "hunk";

interface ReviewNotice {
  tone: "success" | "error";
  text: string;
}

const REVIEW_FILE_TREE_DEFAULT_WIDTH_PX = 280;
const REVIEW_FILE_TREE_MIN_WIDTH_PX = 220;
const REVIEW_FILE_TREE_MAX_WIDTH_PX = 520;
const REVIEW_SPLIT_HANDLE_WIDTH_PX = 12;
const LARGE_DIFF_LINE_THRESHOLD = 3_000;
const REVIEW_FILE_TREE_SEARCH_INPUT_ID = "review-file-search";

type ReviewFileTreeHostStyle = CSSProperties & Record<`--${string}`, string>;

const REVIEW_FILE_TREE_HOST_STYLE = {
  "--trees-row-height": "28px",
  "--trees-font-size": "13px",
  "--trees-item-padding-x": "8px",
  "--trees-item-margin-x": "2px",
  "--trees-item-row-gap": "6px",
  "--trees-icon-width": "16px",
  "--trees-level-gap": "8px",
  "--trees-border-radius": "6px",
  "--trees-fg": "var(--color-token-foreground)",
  "--trees-fg-muted": "var(--color-token-description-foreground)",
  "--trees-bg": "var(--color-token-main-surface-primary)",
  "--trees-bg-muted": "var(--color-token-list-hover-background)",
  "--trees-border-color": "var(--color-token-panel-border)",
  "--trees-selected-fg": "var(--color-token-list-active-selection-foreground)",
  "--trees-selected-bg": "var(--color-token-list-active-selection-background)",
  "--trees-focus-ring-color": "var(--color-token-list-focus-outline)",
  "--trees-search-bg": "var(--color-token-input-background)",
  "--trees-search-fg": "var(--color-token-foreground)",
} satisfies ReviewFileTreeHostStyle;

function clampReviewFileTreeWidth(value: number): number {
  return Math.min(REVIEW_FILE_TREE_MAX_WIDTH_PX, Math.max(REVIEW_FILE_TREE_MIN_WIDTH_PX, Math.round(value)));
}

const SOURCE_LABELS: Record<ReviewSource, string> = {
  "last-turn": "Last turn",
  branch: "Branch",
  staged: "Staged",
  unstaged: "Unstaged",
};

function ReviewTreeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20" className={cn("icon-xs", className)}>
      <path d="M1.418 13.667V9.25c0-.514 0-.94.028-1.285.029-.354.092-.683.25-.993l.097-.175a2.54 2.54 0 0 1 1.012-.935l.117-.055c.276-.118.566-.169.875-.194.346-.028.772-.028 1.286-.028h.988c.396 0 .696-.004.986.061l.18.047c.178.054.35.127.512.219l.189.12c.185.13.364.295.585.494l.14.126.357.314c.08.066.129.102.18.13l.16.076c.055.02.112.037.17.05l.092.016c.105.012.262.014.603.014h.941c.514 0 .94-.001 1.287.027.353.029.682.092.992.25l.175.098c.397.244.722.593.935 1.011l.055.118c.118.275.169.565.194.875.028.346.027.772.027 1.286v2.75c0 .514.001.94-.027 1.286-.025.31-.076.6-.194.875l-.055.117a2.54 2.54 0 0 1-.935 1.012l-.175.097c-.31.158-.639.221-.992.25-.346.029-.772.028-1.287.028H5.083c-.514 0-.94 0-1.286-.028a2.74 2.74 0 0 1-.875-.194l-.117-.056a2.54 2.54 0 0 1-1.012-.934l-.097-.175c-.158-.31-.221-.639-.25-.992-.029-.346-.028-.772-.028-1.286Zm1.33 0c0 .536.001.898.024 1.177.022.272.062.406.108.498l.047.082c.116.19.283.344.482.446l.078.033c.089.032.215.058.419.075.279.023.641.024 1.177.024h6.083c.536 0 .899-.001 1.178-.024.272-.022.406-.062.497-.108l.083-.047a1.21 1.21 0 0 0 .446-.482l.034-.078c.031-.089.057-.215.074-.419.023-.279.023-.641.023-1.177v-2.75c0-.536 0-.899-.023-1.178a1.668 1.668 0 0 0-.074-.419l-.034-.078a1.21 1.21 0 0 0-.446-.482l-.083-.046c-.091-.047-.225-.087-.497-.109-.28-.023-.642-.023-1.178-.023h-.941c-.297 0-.54.002-.765-.025l-.22-.037a2.54 2.54 0 0 1-.528-.18l-.165-.085a2.56 2.56 0 0 1-.374-.262l-.4-.352-.14-.127a6.455 6.455 0 0 0-.457-.392l-.079-.051a1.217 1.217 0 0 0-.161-.075l-.169-.052c-.114-.025-.241-.03-.696-.03h-.988c-.536 0-.898.001-1.177.024-.204.017-.33.043-.42.075l-.077.034a1.21 1.21 0 0 0-.482.445l-.047.084c-.046.091-.086.226-.108.497-.023.28-.024.641-.024 1.177v4.417Z" />
    </svg>
  );
}

function ReviewPanelIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("icon-xs", className)}>
      <path d="M4.33496 11C4.33496 10.6327 4.63273 10.335 5 10.335C5.36727 10.335 5.66504 10.6327 5.66504 11V14.335H9L9.13379 14.3486C9.43692 14.4106 9.66504 14.6786 9.66504 15C9.66504 15.3214 9.43692 15.5894 9.13379 15.6514L9 15.665H5C4.63273 15.665 4.33496 15.3673 4.33496 15V11ZM14.335 9V5.66504H11C10.6327 5.66504 10.335 5.36727 10.335 5C10.335 4.63273 10.6327 4.33496 11 4.33496H15L15.1338 4.34863C15.4369 4.41057 15.665 4.67857 15.665 5V9C15.665 9.36727 15.3673 9.66504 15 9.66504C14.6327 9.66504 14.335 9.36727 14.335 9Z" fill="currentColor" />
      <path d="M4.80469 4.33496C4.43742 4.33496 4.13965 4.63273 4.13965 5C4.13965 5.36727 4.43742 5.66504 4.80469 5.66504H8.13867L8.27246 5.65137C8.57559 5.58943 8.80371 5.32143 8.80371 5C8.80371 4.67857 8.57559 4.41057 8.27246 4.34863L8.13867 4.33496H4.80469ZM11.8613 14.335L11.7275 14.3486C11.4244 14.4106 11.1963 14.6786 11.1963 15C11.1963 15.3214 11.4244 15.5894 11.7275 15.6514L11.8613 15.665H15.1953C15.5626 15.665 15.8604 15.3673 15.8604 15C15.8604 14.6327 15.5626 14.335 15.1953 14.335H11.8613Z" fill="currentColor" />
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

function splitFilePatchByHunks(filePatch: string): string[] {
  if (!filePatch.trim()) return [];

  const lines = filePatch.split("\n");
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunkIndex === -1) return [];

  const headerLines = lines.slice(0, firstHunkIndex);
  const hunkPatches: string[] = [];
  let currentHunkLines: string[] = [];

  for (const line of lines.slice(firstHunkIndex)) {
    if (line.startsWith("@@ ") && currentHunkLines.length > 0) {
      hunkPatches.push([...headerLines, ...currentHunkLines].join("\n").trimEnd());
      currentHunkLines = [line];
      continue;
    }

    currentHunkLines.push(line);
  }

  if (currentHunkLines.length > 0) {
    hunkPatches.push([...headerLines, ...currentHunkLines].join("\n").trimEnd());
  }

  return hunkPatches;
}

function buildReviewFileEntries(
  patch: string,
  basePath: string | null,
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
): ReviewSnapshot {
  const turn = conversation?.turns.at(-1) ?? null;
  const patch = typeof turn?.diff === "string" && turn.diff.trim().length > 0
    ? turn.diff
    : turn
      ? (extractLastTurnPatchItem(turn.items) ?? "")
      : "";
  const cwd = conversation?.cwd ?? projectWorkspacePath ?? null;
  const basePath = normalizeReviewBasePath(cwd);
  const files = buildReviewFileEntries(patch, basePath);

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

function buildGitSnapshot(
  gitSnapshot: GitReviewSnapshot | null,
): ReviewSnapshot {
  const cwd = gitSnapshot?.cwd ?? null;
  const basePath = normalizeReviewBasePath(cwd);
  const patch = gitSnapshot?.patch ?? "";
  const statusByPath = new Map<string, GitReviewFileStatus | null>(
    (gitSnapshot?.files ?? []).map((file) => [stripPatchPrefix(file.path), file.status]),
  );
  const files = buildReviewFileEntries(patch, basePath).map((file) => ({
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

function buildGitApplyCommand(diffText: string): string {
  return ` (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF'\n${diffText}\nEOF\n)`;
}

function actionResultMessage(
  action: ReviewGitFileAction,
  displayPath: string,
  status: GitApplyPatchResult["status"],
  scope: ReviewGitPatchScope = "file",
): ReviewNotice {
  const actionTarget = scope === "hunk" ? `a hunk in ${displayPath}` : displayPath;
  if (status === "success") {
    return {
      tone: "success",
      text: action === "stage"
        ? `Staged ${actionTarget}.`
        : action === "unstage"
          ? `Unstaged ${actionTarget}.`
          : `Reverted ${actionTarget}.`,
    };
  }

  if (status === "partial-success") {
    return {
      tone: "error",
      text: `Partially reverted ${actionTarget}. Refresh review state before continuing.`,
    };
  }

  return {
    tone: "error",
    text: action === "revert"
      ? `Could not revert ${actionTarget}.`
      : `Could not update ${actionTarget}.`,
  };
}

function toolbarIconButtonClassName(extraClassName?: string): string {
  return cn(
    "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-description-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent electron:p-1 electron:[&>svg]:icon-sm flex items-center justify-center p-0.5",
    extraClassName,
  );
}

function toolbarSourceButtonClassName(): string {
  return "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full text-token-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent px-2 py-0.5 text-sm leading-[18px] outline-hidden cursor-interaction flex w-full max-w-[320px] min-w-0 items-center gap-1 px-2 py-1 text-base";
}

function ReviewPanelEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6 py-10">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="text-token-input-placeholder-foreground">
          <ReviewPanelIcon className="h-14 w-14" />
        </div>
        <div className="space-y-1">
          <div className="text-base font-medium text-token-foreground">{title}</div>
          <div className="text-sm text-token-description-foreground">{description}</div>
        </div>
        {action}
      </div>
    </div>
  );
}

function ReviewFileRow({
  entry,
  source,
  diffMode,
  wrap,
  wordDiffsEnabled,
  richPreviewEnabled,
  loadFullFilesEnabled,
  expanded,
  openerId,
  actionPending,
  fullContents,
  fullContentsLoading,
  onRunGitAction,
  onRunGitHunkAction,
  onToggleExpanded,
}: {
  entry: ReviewFileEntry;
  source: ReviewSource;
  diffMode: ReviewDiffMode;
  wrap: boolean;
  wordDiffsEnabled: boolean;
  richPreviewEnabled: boolean;
  loadFullFilesEnabled: boolean;
  expanded: boolean;
  openerId: string;
  actionPending: boolean;
  fullContents: GitReviewFileContents | null;
  fullContentsLoading: boolean;
  onRunGitAction: (action: ReviewGitFileAction, entry: ReviewFileEntry) => void;
  onRunGitHunkAction: (action: ReviewGitFileAction, entry: ReviewFileEntry, hunkIndex: number) => void;
  onToggleExpanded: () => void;
}) {
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

  const actionLabel = source === "staged" ? "File actions" : "Review file actions";
  const showGitActions = source === "staged" || source === "unstaged";
  const hunkPatches = splitFilePatchByHunks(entry.patchText);
  const actionsTrigger = (
    <button
      type="button"
      className={toolbarIconButtonClassName("size-6 shrink-0")}
      aria-label={actionLabel}
      disabled={actionPending}
    >
      <MoreHorizontalIcon />
    </button>
  );

  return (
    <section
      data-review-path={entry.displayPath}
      className="border-token-border overflow-hidden rounded-xl border bg-token-main-surface-primary"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-token-border bg-token-main-surface-primary/96 px-3 py-2 backdrop-blur-sm">
        <div
          role="button"
          tabIndex={0}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onToggleExpanded}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onToggleExpanded();
          }}
          aria-expanded={expanded}
        >
          <span className={cn("text-token-description-foreground transition-transform duration-150", expanded && "rotate-90")}>
            <ChevronDownIcon className="h-3.5 w-3.5 -rotate-90" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FilenameButton
              displayPath={entry.displayPath}
              onOpen={entry.openPath ? openFile : null}
              className="cursor-interaction max-w-full truncate text-left text-sm text-token-foreground hover:underline"
            />
            <DiffStats additions={entry.additions} deletions={entry.deletions} className="text-xs" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          {showGitActions ? (
            <NodexDropdownMenu
              triggerButton={actionsTrigger}
              align="end"
              sideOffset={8}
            >
              {source === "unstaged" ? (
                <NodexDropdownItem onSelect={() => onRunGitAction("stage", entry)} disabled={actionPending}>
                  Stage file
                </NodexDropdownItem>
              ) : null}
              {source === "staged" ? (
                <NodexDropdownItem onSelect={() => onRunGitAction("unstage", entry)} disabled={actionPending}>
                  Unstage file
                </NodexDropdownItem>
              ) : null}
              <NodexDropdownItem onSelect={() => onRunGitAction("revert", entry)} disabled={actionPending}>
                Revert file
              </NodexDropdownItem>
            </NodexDropdownMenu>
          ) : null}
          <span className="truncate text-xs text-token-description-foreground">{basename(entry.displayPath)}</span>
        </div>
      </div>
      {expanded ? (
        <div className="bg-token-main-surface-primary">
          {showGitActions && entry.fileDiff.hunks.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-b border-token-border px-3 py-2">
              {entry.fileDiff.hunks.map((_, hunkIndex) => (
                <div key={`${entry.key}:hunk:${hunkIndex}`} className="flex items-center gap-1 rounded-full bg-token-list-hover-background px-2 py-1 text-xs text-token-description-foreground">
                  <span>{`Hunk ${hunkIndex + 1}`}</span>
                  {source === "unstaged" ? (
                    <button
                      type="button"
                      className="cursor-interaction rounded-full px-1.5 py-0.5 text-token-foreground hover:bg-token-main-surface-primary"
                      onClick={() => onRunGitHunkAction("stage", entry, hunkIndex)}
                    >
                      Stage
                    </button>
                  ) : null}
                  {source === "staged" ? (
                    <button
                      type="button"
                      className="cursor-interaction rounded-full px-1.5 py-0.5 text-token-foreground hover:bg-token-main-surface-primary"
                      onClick={() => onRunGitHunkAction("unstage", entry, hunkIndex)}
                    >
                      Unstage
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="cursor-interaction rounded-full px-1.5 py-0.5 text-token-foreground hover:bg-token-main-surface-primary"
                    onClick={() => onRunGitHunkAction("revert", entry, hunkIndex)}
                    disabled={!hunkPatches[hunkIndex]}
                  >
                    Revert
                  </button>
                </div>
              ))}
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
    if (row.gitStatus === "modified") return "M";
    if (row.containsGitChange) {
      return <FileTreeDotIcon className="text-current" />;
    }
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
          "border-none relative mx-[2px] flex w-full items-center gap-[6px] rounded-[6px] bg-transparent text-left text-token-foreground outline-none",
          row.isSelected ? "bg-token-list-hover-background text-token-list-active-selection-foreground z-[3]" : "text-token-foreground hover:bg-token-list-hover-background",
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
                  "inline-block h-full shrink-0 translate-x-[-0.25px] border-l border-token-panel-border opacity-55",
                  highlightedAncestorIds.has(row.ancestorIds[spacingIndex] ?? "") ? "opacity-100" : undefined,
                  row.isSelected || row.isFocused ? "h-[calc(100%-2px)]" : undefined,
                )}
                style={{
                  width: "calc(var(--trees-level-gap))",
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
          className="flex shrink-0 items-center justify-center text-token-description-foreground"
          style={{ width: "var(--trees-icon-width)" }}
        >
          {row.type === "folder" ? (
            <FileTreeChevronIcon className={cn("transition-transform", row.isExpanded ? undefined : "-rotate-90")} />
          ) : (
            <FileTreeFileIcon />
          )}
        </div>
        <div data-item-section="content" className="min-w-0 flex-1 truncate text-left">
          {row.type === "folder"
            ? <ReviewFileTreeFlattenedLabel row={row} />
            : row.label}
        </div>
        {statusSlot ? (
          <div
            data-item-section="status"
            className={cn(
              "flex w-3 shrink-0 items-center justify-center text-center",
              row.gitStatus === "added" ? "text-token-charts-green" : undefined,
              row.gitStatus === "deleted" ? "text-token-charts-red" : undefined,
              row.gitStatus === "modified" ? "text-token-charts-blue" : undefined,
              row.containsGitChange && !row.gitStatus ? "text-token-charts-blue" : undefined,
              row.containsGitChange && !row.gitStatus ? "opacity-50" : undefined,
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
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary pr-2"
      data-file-tree-virtualized-wrapper={isVirtualized ? "true" : undefined}
      style={REVIEW_FILE_TREE_HOST_STYLE as CSSProperties}
    >
      <div data-file-tree-search-container="true" className="shrink-0 pr-2 pb-1">
        <label className="sr-only" htmlFor={REVIEW_FILE_TREE_SEARCH_INPUT_ID}>
          Filter files
        </label>
        <div className="relative flex w-full items-center gap-1.5 rounded-md border-[0.5px] border-token-border bg-token-input-background">
          <input
            id={REVIEW_FILE_TREE_SEARCH_INPUT_ID}
            value={fileFilter}
            onChange={(event) => onFileFilterChange(event.target.value)}
            placeholder="Filter files…"
            data-file-tree-search-input="true"
            aria-controls={treeDomId}
            aria-activedescendant={focusedTreeItemId ? `${treeDomId}-${focusedTreeItemId}` : undefined}
            className="w-full appearance-none border-none bg-transparent p-1.5 text-token-foreground ring-0 outline-none placeholder:text-token-input-placeholder-foreground focus:border-none focus:ring-0 focus:outline-none"
            style={{
              height: "var(--trees-row-height)",
              lineHeight: "var(--trees-row-height)",
              fontSize: "var(--trees-font-size)",
            }}
          />
        </div>
      </div>
      <div
        className={cn("bg-token-main-surface-primary min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1", isVirtualized ? "flex flex-col overflow-hidden" : undefined)}
        data-file-tree-virtualized-root={isVirtualized ? "true" : undefined}
      >
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-token-main-surface-primary"
          data-file-tree-virtualized-scroll={isVirtualized ? "true" : undefined}
        >
          {rows.length === 0 ? (
            <div className="px-2 py-2 text-sm text-token-description-foreground">No matching files</div>
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
  initialSource = "last-turn",
  initialFileTreeOpen = false,
  searchOpenTick = 0,
}: ReviewDiffPanelProps) {
  const { opener } = useFileLinkOpener();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastHandledSearchOpenTickRef = useRef(searchOpenTick);
  const [source, setSource] = useState<ReviewSource>(initialSource);
  const [diffMode, setDiffMode] = useState<ReviewDiffMode>("unified");
  const [wrap, setWrap] = useState(false);
  const [wordDiffsEnabled, setWordDiffsEnabled] = useState(false);
  const [richPreviewEnabled, setRichPreviewEnabled] = useState(false);
  const [loadFullFilesEnabled, setLoadFullFilesEnabled] = useState(initialSource !== "last-turn");
  const [fileTreeOpen, setFileTreeOpen] = useState(initialFileTreeOpen);
  const [fileTreeWidth, setFileTreeWidth] = useState(REVIEW_FILE_TREE_DEFAULT_WIDTH_PX);
  const [fileFilter, setFileFilter] = useState("");
  const deferredFileFilter = useDeferredValue(fileFilter);
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState<Set<string>>(new Set());
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedTreeItemId, setSelectedTreeItemId] = useState<string | null>(null);
  const [focusedTreeItemId, setFocusedTreeItemId] = useState<string | null>(null);
  const [gitSnapshot, setGitSnapshot] = useState<GitReviewSnapshot | null>(null);
  const [reviewSearchResult, setReviewSearchResult] = useState<GitReviewSearchResult | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitActionKey, setGitActionKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReviewNotice | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [fullContentsByPath, setFullContentsByPath] = useState<Record<string, GitReviewFileContents>>({});
  const [fullContentsLoadingPaths, setFullContentsLoadingPaths] = useState<Record<string, boolean>>({});
  const fileTreeResizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [visibleSearchMatchCount, setVisibleSearchMatchCount] = useState(REVIEW_CAPPED_MATCH_PAGE_SIZE);

  const reviewCwd = source === "last-turn"
    ? (conversation?.cwd ?? projectWorkspacePath ?? null)
    : (projectWorkspacePath ?? conversation?.cwd ?? null);

  useEffect(() => {
    setIsSearchVisible(false);
    setSearchQuery("");
    lastHandledSearchOpenTickRef.current = searchOpenTick;
  }, [conversation?.threadId]);

  useEffect(() => {
    if (searchOpenTick <= 0 || searchOpenTick === lastHandledSearchOpenTickRef.current) {
      return;
    }

    lastHandledSearchOpenTickRef.current = searchOpenTick;
    setIsSearchVisible(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [searchOpenTick]);

  const lastTurnSnapshot = useMemo(
    () => buildLastTurnSnapshot(conversation, projectWorkspacePath),
    [conversation, projectWorkspacePath],
  );

  const loadGitSnapshot = async (
    nextSource: GitReviewSource,
    nextCwd: string,
  ): Promise<GitReviewSnapshot> => {
    return invoke("git:review:snapshot", {
      cwd: nextCwd,
      source: nextSource,
    }) as Promise<GitReviewSnapshot>;
  };

  const loadReviewFileContents = async (
    entry: ReviewFileEntry,
  ): Promise<GitReviewFileContents> => {
    if (source === "last-turn") {
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
    }) as Promise<GitReviewFileContents>;
  };

  const runReviewSearch = async (query: string): Promise<GitReviewSearchResult> => {
    if (source === "last-turn") {
      return {
        query,
        matchingPaths: [],
      };
    }

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) {
      return {
        query,
        matchingPaths: [],
      };
    }

    return invoke("git:review:search", {
      cwd: normalizedCwd,
      source,
      query,
      baseRef: gitSnapshot?.baseRef ?? null,
    }) as Promise<GitReviewSearchResult>;
  };

  useEffect(() => {
    if (source === "last-turn") {
      setGitSnapshot(null);
      return;
    }

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) {
      setGitSnapshot(null);
      return;
    }

    let cancelled = false;
    setGitLoading(true);
    void loadGitSnapshot(source, normalizedCwd)
      .then((result) => {
        if (cancelled) return;
        setGitSnapshot(result as GitReviewSnapshot);
      })
      .catch((error) => {
        if (cancelled) return;
        setGitSnapshot({
          cwd: normalizedCwd,
          source,
          patch: "",
          files: [],
          isGitRepository: true,
          baseRef: null,
          currentBranch: null,
          defaultBranch: null,
          errorMessage: error instanceof Error ? error.message : "Could not load Git review snapshot.",
        });
      })
      .finally(() => {
        if (cancelled) return;
        setGitLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reviewCwd, source]);

  const snapshot = useMemo(
    () => source === "last-turn" ? lastTurnSnapshot : buildGitSnapshot(gitSnapshot),
    [gitSnapshot, lastTurnSnapshot, source],
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
      totalChangedBytes,
      totalChangedLines,
    }),
    [snapshot.files.length, totalChangedBytes, totalChangedLines],
  );

  useEffect(() => {
    setFullContentsByPath({});
    setFullContentsLoadingPaths({});
    setReviewSearchResult(null);
  }, [snapshot.patch, source]);

  const effectiveSearchQuery = isSearchVisible ? searchQuery : "";

  useEffect(() => {
    setVisibleSearchMatchCount(REVIEW_CAPPED_MATCH_PAGE_SIZE);
  }, [deferredFileFilter, effectiveSearchQuery, snapshot.patch, source]);

  useEffect(() => {
    if (source === "last-turn") {
      setReviewSearchResult(null);
      return;
    }

    const normalizedQuery = effectiveSearchQuery.trim();
    if (normalizedQuery.length === 0) {
      setReviewSearchResult(null);
      return;
    }

    let cancelled = false;
    void runReviewSearch(normalizedQuery)
      .then((result) => {
        if (cancelled) return;
        setReviewSearchResult(result);
      })
      .catch(() => {
        if (cancelled) return;
        setReviewSearchResult({
          query: normalizedQuery,
          matchingPaths: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveSearchQuery, gitSnapshot?.baseRef, reviewCwd, source]);

  const filteredFiles = useMemo(
    () => filterReviewFiles(snapshot.files, deferredFileFilter),
    [deferredFileFilter, snapshot.files],
  );

  const reviewSearchMatches = useMemo<ReviewSearchMatch[]>(() => {
    return buildReviewSearchMatches(snapshot.files, effectiveSearchQuery, fullContentsByPath);
  }, [effectiveSearchQuery, fullContentsByPath, snapshot.files]);
  const reviewSearchMatchCount = effectiveSearchQuery.trim().length === 0
    ? 0
    : source === "last-turn"
      ? reviewSearchMatches.length
      : (reviewSearchResult?.matchingPaths.length ?? 0);

  const searchMatchPaths = useMemo(() => {
    const normalizedQuery = effectiveSearchQuery.trim();
    if (normalizedQuery.length === 0) return null;

    if (source === "last-turn") {
      return new Set(reviewSearchMatches.map((match) => match.path));
    }

    if (!reviewSearchResult) return new Set<string>();
    return new Set(reviewSearchResult.matchingPaths);
  }, [effectiveSearchQuery, reviewSearchMatches, reviewSearchResult, source]);

  const searchFilteredFiles = useMemo(() => {
    if (!searchMatchPaths) return filteredFiles;
    return filteredFiles.filter((file) => searchMatchPaths.has(file.displayPath));
  }, [filteredFiles, searchMatchPaths]);

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
      searchFilteredFiles,
      selectedPath,
      isCappedMode,
    );
    if (nextSelectedPath === selectedPath) return;
    setSelectedPath(nextSelectedPath);
  }, [isCappedMode, searchFilteredFiles, selectedPath]);

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
      searchFilteredFiles,
      selectedPath,
      isCappedMode,
      searchMatchPaths !== null,
      visibleSearchMatchCount,
    );
  }, [
    isCappedMode,
    searchFilteredFiles,
    searchMatchPaths,
    selectedPath,
    visibleSearchMatchCount,
  ]);
  const reviewRenderPlan = useMemo(
    () => buildReviewRenderPlan(visibleFiles, isCappedMode),
    [isCappedMode, visibleFiles],
  );
  const areAllDiffsExpanded = useMemo(() => {
    if (snapshot.files.length === 0) return false;
    return snapshot.files.every((entry) => expandedKeys.has(entry.key));
  }, [expandedKeys, snapshot.files]);

  useEffect(() => {
    if (!selectedPath) return;
    const node = rowRefs.current.get(selectedPath);
    if (!node) return;
    node.scrollIntoView({ block: "start" });
  }, [selectedPath, visibleFiles]);

  const canLoadMoreMatches = isCappedMode
    && searchMatchPaths !== null
    && visibleFiles.length < searchFilteredFiles.length;

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
        source={source}
        diffMode={diffMode}
        wrap={wrap}
        wordDiffsEnabled={wordDiffsEnabled}
        richPreviewEnabled={richPreviewEnabled}
        loadFullFilesEnabled={loadFullFilesEnabled}
        expanded={expandedKeys.has(entry.key)}
        openerId={opener}
        actionPending={gitActionKey === entry.key}
        fullContents={fullContentsByPath[entry.displayPath] ?? null}
        fullContentsLoading={Boolean(fullContentsLoadingPaths[entry.displayPath])}
        onRunGitAction={(action, targetEntry) => {
          void handleRunGitFileAction(action, targetEntry);
        }}
        onRunGitHunkAction={(action, targetEntry, hunkIndex) => {
          void handleRunGitHunkAction(action, targetEntry, hunkIndex);
        }}
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
    if (source === "last-turn") return;

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) return;

    setGitLoading(true);
    try {
      const result = await loadGitSnapshot(source, normalizedCwd);
      startTransition(() => {
        setGitSnapshot(result);
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not refresh review.",
      });
    } finally {
      setGitLoading(false);
    }
  };

  useEffect(() => {
    if (!loadFullFilesEnabled || source === "last-turn") return;

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

    setGitLoading(true);
    try {
      const result = await invoke("git:init", normalizedCwd) as GitReviewSnapshot;
      startTransition(() => {
        setGitSnapshot(result);
      });
      setNotice({
        tone: "success",
        text: "Created a Git repository for this workspace.",
      });
    } finally {
      setGitLoading(false);
    }
  };

  const handleCopyGitApplyCommand = async () => {
    if (!snapshot.patch.trim()) return;
    const copied = await writeTextToClipboard(buildGitApplyCommand(snapshot.patch));
    setNotice({
      tone: copied ? "success" : "error",
      text: copied
        ? "Copied git apply command to the clipboard."
        : "Could not copy the git apply command.",
    });
  };

  const handleRunGitFileAction = async (action: ReviewGitFileAction, entry: ReviewFileEntry) => {
    if (source !== "staged" && source !== "unstaged") return;

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) return;

    setGitActionKey(entry.key);

    const applyPatch = async (
      target: "staged" | "unstaged",
      revert: boolean,
    ): Promise<GitApplyPatchResult> => {
      return invoke("git:apply-patch", {
        cwd: normalizedCwd,
        diff: entry.patchText,
        target,
        revert,
      }) as Promise<GitApplyPatchResult>;
    };

    try {
      let result: GitApplyPatchResult;
      if (source === "unstaged" && action === "stage") {
        result = await applyPatch("staged", false);
      } else if (source === "unstaged" && action === "revert") {
        result = await applyPatch("unstaged", true);
      } else if (source === "staged" && action === "unstage") {
        result = await applyPatch("staged", true);
      } else if (source === "staged" && action === "revert") {
        const unstagedRemoval = await applyPatch("staged", true);
        if (unstagedRemoval.status !== "success") {
          result = unstagedRemoval;
        } else {
          const worktreeRemoval = await applyPatch("unstaged", true);
          result = worktreeRemoval.status === "success"
            ? worktreeRemoval
            : {
                ...worktreeRemoval,
                status: "partial-success",
              };
        }
      } else {
        result = {
          status: "error",
          appliedPaths: [],
          skippedPaths: [],
          conflictedPaths: [],
          errorCode: "unsupportedAction",
          errorMessage: "Unsupported review file action.",
        };
      }

      setNotice(actionResultMessage(action, entry.displayPath, result.status));
      if (result.status !== "error") {
        await refreshGitSnapshot();
      }
    } finally {
      setGitActionKey(null);
    }
  };

  const handleRunGitHunkAction = async (
    action: ReviewGitFileAction,
    entry: ReviewFileEntry,
    hunkIndex: number,
  ) => {
    if (source !== "staged" && source !== "unstaged") return;

    const normalizedCwd = reviewCwd?.trim() ?? "";
    if (!normalizedCwd) return;

    const hunkPatch = splitFilePatchByHunks(entry.patchText)[hunkIndex];
    if (!hunkPatch) return;

    setGitActionKey(`${entry.key}:hunk:${hunkIndex}`);

    const applyPatch = async (
      target: "staged" | "unstaged",
      revert: boolean,
    ): Promise<GitApplyPatchResult> => {
      return invoke("git:apply-patch", {
        cwd: normalizedCwd,
        diff: hunkPatch,
        target,
        revert,
      }) as Promise<GitApplyPatchResult>;
    };

    try {
      let result: GitApplyPatchResult;
      if (source === "unstaged" && action === "stage") {
        result = await applyPatch("staged", false);
      } else if (source === "unstaged" && action === "revert") {
        result = await applyPatch("unstaged", true);
      } else if (source === "staged" && action === "unstage") {
        result = await applyPatch("staged", true);
      } else if (source === "staged" && action === "revert") {
        const unstagedRemoval = await applyPatch("staged", true);
        if (unstagedRemoval.status !== "success") {
          result = unstagedRemoval;
        } else {
          const worktreeRemoval = await applyPatch("unstaged", true);
          result = worktreeRemoval.status === "success"
            ? worktreeRemoval
            : {
                ...worktreeRemoval,
                status: "partial-success",
              };
        }
      } else {
        result = {
          status: "error",
          appliedPaths: [],
          skippedPaths: [],
          conflictedPaths: [],
          errorCode: "unsupportedAction",
          errorMessage: "Unsupported review hunk action.",
        };
      }

      setNotice(actionResultMessage(action, entry.displayPath, result.status, "hunk"));
      if (result.status !== "error") {
        await refreshGitSnapshot();
      }
    } finally {
      setGitActionKey(null);
    }
  };

  const sourceTrigger = (
    <button type="button" className={toolbarSourceButtonClassName()}>
      <span className="flex max-w-full min-w-0 items-center gap-1.5 truncate">{SOURCE_LABELS[source]}</span>
      <ChevronDownIcon className="icon-2xs text-token-description-foreground" />
    </button>
  );

  const optionsTrigger = (
    <button type="button" className={toolbarIconButtonClassName()} aria-label="Review options">
      <MoreHorizontalIcon />
    </button>
  );

  const toggleFileTreeLabel = fileTreeOpen ? "Hide file tree" : "Show file tree";
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
  const clearFileTreeResizeState = () => {
    fileTreeResizeStateRef.current = null;
  };
  const handleFileTreeResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    fileTreeResizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: fileTreeWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleFileTreeResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizeState = fileTreeResizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const nextWidth = clampReviewFileTreeWidth(resizeState.startWidth + (resizeState.startX - event.clientX));
    setFileTreeWidth(nextWidth);
  };
  const handleFileTreeResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 16 : -16;
    setFileTreeWidth((current) => clampReviewFileTreeWidth(current + delta));
  };

  if (!reviewCwd) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
        <ReviewPanelEmptyState
          title="No review workspace available"
          description="Start or open a local thread with a project workspace to review file changes here."
        />
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 bg-token-main-surface-primary">
      <div className="relative grid h-full min-h-0 w-full grid-rows-[auto_1fr]">
        <div className="flex flex-col px-2 py-1 text-token-description-foreground">
          <div className="flex h-9 items-center justify-between">
            <div className="flex min-w-0 items-center text-base">
              <div className="min-w-0 font-medium text-token-foreground">
                <NodexDropdownMenu triggerButton={sourceTrigger} align="start" sideOffset={8}>
                  <NodexDropdownItem onSelect={() => setSource("last-turn")} rightSlot={source === "last-turn" ? <CheckmarkIcon className="size-4" /> : null}>
                    Last turn
                  </NodexDropdownItem>
                  <NodexDropdownItem onSelect={() => setSource("branch")} rightSlot={source === "branch" ? <CheckmarkIcon className="size-4" /> : null}>
                    Branch
                  </NodexDropdownItem>
                  <NodexDropdownItem onSelect={() => setSource("staged")} rightSlot={source === "staged" ? <CheckmarkIcon className="size-4" /> : null}>
                    Staged
                  </NodexDropdownItem>
                  <NodexDropdownItem onSelect={() => setSource("unstaged")} rightSlot={source === "unstaged" ? <CheckmarkIcon className="size-4" /> : null}>
                    Unstaged
                  </NodexDropdownItem>
                </NodexDropdownMenu>
              </div>
            </div>
            <div className="mr-1 flex h-9 flex-shrink-0 items-center">
              <div className="flex items-center gap-1.5">
                <NodexDropdownMenu triggerButton={optionsTrigger} align="end" sideOffset={8}>
                  {source !== "last-turn" ? (
                    <NodexDropdownItem
                      onSelect={() => void refreshGitSnapshot()}
                      leftSlot={<RefreshIcon className="icon-xs" />}
                      disabled={gitLoading || gitActionKey !== null}
                    >
                      Refresh
                    </NodexDropdownItem>
                  ) : null}
                  <NodexDropdownItem
                    onSelect={() => setDiffMode((current) => current === "unified" ? "split" : "unified")}
                    leftSlot={diffMode === "unified"
                      ? <ReviewSplitDiffIcon className="icon-xs" />
                      : <ReviewUnifiedDiffIcon className="icon-xs" />}
                  >
                    {diffMode === "unified" ? "Switch to split diff" : "Switch to unified diff"}
                  </NodexDropdownItem>
                  <NodexDropdownItem
                    onSelect={() => setWrap((current) => !current)}
                    leftSlot={wrap
                      ? <ReviewDisableWordWrapIcon className="icon-xs" />
                      : <ReviewEnableWordWrapIcon className="icon-xs" />}
                  >
                    {wrap ? "Disable word wrap" : "Enable word wrap"}
                  </NodexDropdownItem>
                  <NodexDropdownItem
                    onSelect={() => setExpandedKeys(areAllDiffsExpanded ? new Set() : new Set(snapshot.files.map((file) => file.key)))}
                    leftSlot={areAllDiffsExpanded
                      ? <ReviewCollapseAllDiffsIcon className="icon-xs" />
                      : <ReviewExpandAllDiffsIcon className="icon-xs" />}
                  >
                    {areAllDiffsExpanded ? "Collapse all diffs" : "Expand all diffs"}
                  </NodexDropdownItem>
                  <NodexDropdownSeparator />
                  <NodexDropdownItem
                    onSelect={() => setLoadFullFilesEnabled((current) => !current)}
                    leftSlot={<ReviewFileDocumentIcon className="icon-xs" />}
                    disabled={source === "last-turn"}
                  >
                    {loadFullFilesEnabled ? "Don't load full files" : "Load full files"}
                  </NodexDropdownItem>
                  <NodexDropdownItem
                    onSelect={() => setRichPreviewEnabled((current) => !current)}
                    leftSlot={<ReviewRichPreviewIcon className="icon-xs" />}
                    disabled={!loadFullFilesEnabled || source === "last-turn"}
                  >
                    {richPreviewEnabled ? "Disable rich preview" : "Enable rich preview"}
                  </NodexDropdownItem>
                  <NodexDropdownItem
                    onSelect={() => setWordDiffsEnabled((current) => !current)}
                    leftSlot={<ReviewWordDiffsIcon className="icon-xs" />}
                  >
                    {wordDiffsEnabled ? "Disable word diffs" : "Enable word diffs"}
                  </NodexDropdownItem>
                  {source !== "last-turn" ? (
                    <NodexDropdownItem
                      onSelect={() => void handleCopyGitApplyCommand()}
                      leftSlot={<ReviewFileDocumentIcon className="icon-xs" />}
                    >
                      Copy git apply command
                    </NodexDropdownItem>
                  ) : null}
                </NodexDropdownMenu>
                <button
                  type="button"
                  className={toolbarIconButtonClassName()}
                  aria-label={toggleFileTreeLabel}
                  onClick={() => setFileTreeOpen((current) => !current)}
                >
                  <ReviewTreeIcon />
                </button>
                <button type="button" className={toolbarIconButtonClassName()} aria-label="Review">
                  <ReviewPanelIcon />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="relative min-h-0">
          {isSearchVisible ? (
            <div className="px-3 pb-2">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-token-description-foreground" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    setIsSearchVisible(false);
                    setSearchQuery("");
                  }}
                  placeholder="Find in review"
                  aria-label="Find in review"
                  className="border-token-border/80 bg-token-main-surface-primary h-8 w-full rounded-lg border pl-8 pr-18 text-sm text-token-foreground outline-none placeholder:text-token-description-foreground"
                />
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-token-description-foreground">
                  {searchQuery.trim().length > 0 ? `${reviewSearchMatchCount} matches` : null}
                </div>
              </div>
            </div>
          ) : null}
          {notice ? (
            <div className="px-3 pb-2">
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  notice.tone === "success"
                    ? "bg-token-charts-green/10 text-token-charts-green"
                    : "bg-token-charts-red/10 text-token-charts-red",
                )}
              >
                {notice.text}
              </div>
            </div>
          ) : null}
          {gitLoading && source !== "last-turn" ? (
            <div className="flex h-full items-center justify-center text-sm text-token-description-foreground">Loading review…</div>
          ) : snapshot.errorMessage ? (
            <ReviewPanelEmptyState
              title="Could not load review"
              description={snapshot.errorMessage}
            />
          ) : !snapshot.isGitRepository && source !== "last-turn" ? (
            <ReviewPanelEmptyState
              title="Create a Git repository"
              description="Track, review, and undo changes in this project."
              action={(
                <button
                  type="button"
                  className="rounded-full bg-token-foreground px-3 py-1.5 text-sm text-token-background hover:brightness-[1.05]"
                  onClick={handleCreateGitRepository}
                >
                  Create repository
                </button>
              )}
            />
          ) : snapshot.files.length === 0 ? (
            <ReviewPanelEmptyState
              title={snapshot.emptyReason === "noLongerAvailable" ? "No file changes yet" : "No file changes yet"}
              description={snapshot.emptyReason === "noLongerAvailable"
                ? "The latest diffs are no longer available."
                : "Review file changes here once the workspace has modifications."}
            />
          ) : visibleFiles.length === 0 ? (
            <ReviewPanelEmptyState
              title="No review matches"
              description="Try a different file filter or review search query."
            />
          ) : (
            <div className="absolute inset-0 flex min-w-0 overflow-hidden">
              <div className="min-w-0 flex-1 overflow-auto px-2 pb-3">
                {isCappedMode ? (
                  <div className="bg-token-surface-muted text-token-foreground-muted mb-3 rounded-md px-3 py-2 text-xs">
                    Large diff detected — showing one file at a time.
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <ReviewDeferredRender
                    defer={reviewRenderPlan.shouldDefer}
                    fallback={reviewFallbackRows}
                  >
                    {reviewRows}
                  </ReviewDeferredRender>
                  {canLoadMoreMatches ? (
                    <div className="flex items-center justify-center py-2">
                      <button
                        type="button"
                        className="border-token-border user-select-none no-drag cursor-interaction gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full text-token-foreground enabled:hover:bg-token-list-hover-background border-transparent px-3 py-1.5 text-sm"
                        onClick={() => {
                          setVisibleSearchMatchCount((current) => current + REVIEW_CAPPED_MATCH_PAGE_SIZE);
                        }}
                      >
                        Load more matches
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {fileTreeOpen ? (
                <>
                  <button
                    type="button"
                    role="separator"
                    aria-label="Resize file tree"
                    aria-orientation="vertical"
                    aria-valuemin={REVIEW_FILE_TREE_MIN_WIDTH_PX}
                    aria-valuemax={REVIEW_FILE_TREE_MAX_WIDTH_PX}
                    aria-valuenow={fileTreeWidth}
                    className="group relative shrink-0 touch-none select-none cursor-col-resize outline-none"
                    style={{ width: REVIEW_SPLIT_HANDLE_WIDTH_PX }}
                    onPointerDown={handleFileTreeResizePointerDown}
                    onPointerMove={handleFileTreeResizePointerMove}
                    onPointerUp={clearFileTreeResizeState}
                    onPointerCancel={clearFileTreeResizeState}
                    onLostPointerCapture={clearFileTreeResizeState}
                    onKeyDown={handleFileTreeResizeKeyDown}
                  >
                    <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-token-border transition-colors duration-relaxed ease-basic group-hover:bg-token-foreground/25 group-active:bg-token-foreground/25" />
                  </button>
                  <div
                    className="h-full shrink-0 overflow-hidden pl-2"
                    style={{ width: fileTreeWidth }}
                  >
                    <aside
                      className="h-full shrink-0 overflow-hidden bg-token-main-surface-primary"
                    data-file-tree-virtualized={isReviewFileTreeVirtualizationEnabled(fileTreeState.rows.length, REVIEW_FILE_TREE_VIRTUALIZE_THRESHOLD) ? "true" : undefined}
                      style={{ width: "100%" }}
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
                    </aside>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
