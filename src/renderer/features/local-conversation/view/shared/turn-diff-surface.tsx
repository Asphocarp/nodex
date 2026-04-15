import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { toast } from "@/components/ui/toast";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "../../../../lib/diff-presentation";
import { resolveInvokeTransport } from "../../../../lib/renderer-transport";
import { useFileLinkOpener } from "../../../../lib/use-file-link-opener";
import { useTheme } from "../../../../lib/use-theme";
import type { CodexTranscriptEntry, CodexTurnDiffReviewTarget, GitApplyPatchResult } from "../../../../lib/types";
import { cn } from "../../../../lib/utils";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "./thread-motion";
import { useMeasuredElementHeight } from "./use-measured-element-height";
import {
  Chevron,
  DiffStats,
  FilenameButton,
  normalizePathSegments,
  resolveOpenPath,
  stripPatchPrefix,
  summarizeDiff,
  summarizeFileDiffMetadata,
} from "./tools/diff-file-shared";

const TURN_DIFF_MAX_INLINE_LINES = 5000;

interface TurnDiffPayload {
  unifiedDiff: string;
  cwd?: string;
  showRevertButton?: boolean;
}

interface TurnDiffSummary {
  fileCount: number;
  additions: number;
  deletions: number;
}

interface TurnDiffRowModel {
  key: string;
  displayPath: string | null;
  openPath: string | null;
  openLine?: number;
  fileDiff: FileDiffMetadata | null;
  additions: number;
  deletions: number;
  isTooLarge: boolean;
}

function extractTurnDiffPayload(item: CodexTranscriptEntry): TurnDiffPayload | null {
  const rawItem = item.rawItem;
  if (typeof rawItem !== "object" || rawItem === null) return null;

  const unifiedDiff = (rawItem as { unifiedDiff?: unknown }).unifiedDiff;
  if (typeof unifiedDiff !== "string" || unifiedDiff.trim().length === 0) return null;

  const cwd = (rawItem as { cwd?: unknown }).cwd;
  const showRevertButton = (rawItem as { showRevertButton?: unknown }).showRevertButton;

  return {
    unifiedDiff,
    cwd: typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined,
    showRevertButton: showRevertButton === true,
  };
}

function normalizeBasePath(
  payload: TurnDiffPayload | null,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): string | null {
  const basePath = payload?.cwd ?? threadCwd ?? projectWorkspacePath ?? null;
  if (!basePath) return null;
  const normalizedPath = normalizePathSegments(basePath);
  return normalizedPath.length > 0 ? normalizedPath : null;
}

function buildTurnDiffReviewTarget(
  item: CodexTranscriptEntry,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): CodexTurnDiffReviewTarget | null {
  const payload = extractTurnDiffPayload(item);
  if (!payload) return null;

  return {
    type: "turnDiff",
    threadId: item.threadId,
    turnId: item.turnId,
    entryId: item.entryId ?? item.itemId,
    patch: payload.unifiedDiff,
    cwd: normalizeBasePath(payload, threadCwd, projectWorkspacePath),
    showRevertButton: payload.showRevertButton === true,
  };
}

function resolveOpenLine(fileDiff: FileDiffMetadata | null): number | undefined {
  const firstHunk = fileDiff?.hunks[0];
  if (!firstHunk) return undefined;

  const line = firstHunk.additionStart > 0 ? firstHunk.additionStart : firstHunk.deletionStart;
  return line > 0 ? line : 1;
}

function exceedsInlineThreshold(fileDiff: FileDiffMetadata): boolean {
  const summary = summarizeFileDiffMetadata(fileDiff);
  return Math.max(
    fileDiff.unifiedLineCount,
    fileDiff.splitLineCount,
    summary.additions + summary.deletions,
  ) > TURN_DIFF_MAX_INLINE_LINES;
}

function buildTurnDiffRows(
  item: CodexTranscriptEntry,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): TurnDiffRowModel[] {
  const payload = extractTurnDiffPayload(item);
  if (!payload) return [];

  const basePath = normalizeBasePath(payload, threadCwd, projectWorkspacePath);
  let parsedFiles: FileDiffMetadata[] = [];

  try {
    parsedFiles = parsePatchFiles(payload.unifiedDiff).flatMap((patch) => patch.files);
  } catch {
    parsedFiles = [];
  }

  if (parsedFiles.length === 0) {
    const summary = summarizeDiff(payload.unifiedDiff);
    return [{
      key: item.entryId ?? item.itemId,
      displayPath: null,
      openPath: null,
      fileDiff: null,
      additions: summary.additions,
      deletions: summary.deletions,
      isTooLarge: false,
    }];
  }

  return parsedFiles.map((fileDiff, index) => {
    const displayPath = stripPatchPrefix(fileDiff.name ?? fileDiff.prevName ?? `file-${index + 1}.txt`);
    const summary = summarizeFileDiffMetadata(fileDiff);

    return {
      key: `${item.entryId ?? item.itemId}:${displayPath}:${index}`,
      displayPath,
      openPath: resolveOpenPath(displayPath, basePath),
      openLine: resolveOpenLine(fileDiff),
      fileDiff,
      additions: summary.additions,
      deletions: summary.deletions,
      isTooLarge: exceedsInlineThreshold(fileDiff),
    };
  });
}

function summarizeRows(rows: TurnDiffRowModel[], fallbackDiff: string | undefined): TurnDiffSummary {
  if (rows.length === 0) {
    const fallbackSummary = summarizeDiff(fallbackDiff);
    return {
      fileCount: 0,
      additions: fallbackSummary.additions,
      deletions: fallbackSummary.deletions,
    };
  }

  return rows.reduce(
    (summary, row) => ({
      fileCount: summary.fileCount + 1,
      additions: summary.additions + row.additions,
      deletions: summary.deletions + row.deletions,
    }),
    { fileCount: 0, additions: 0, deletions: 0 },
  );
}

function TurnDiffFilesChangedLabel({ fileCount }: { fileCount: number }) {
  if (fileCount <= 0) return <span className="text-size-chat min-w-0 truncate py-2 text-token-input-foreground">Files changed</span>;

  return (
    <span className="text-size-chat min-w-0 truncate py-2 text-token-input-foreground">
      {fileCount} {fileCount === 1 ? "file" : "files"} changed
    </span>
  );
}

function ReviewChangesIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs translate-y-[1px] text-token-input-placeholder-foreground transition-colors group-hover:text-token-foreground" fill="none" aria-hidden="true">
      <path
        d="M14.3349 13.3301V6.60645L5.47065 15.4707C5.21095 15.7304 4.78895 15.7304 4.52925 15.4707C4.26955 15.211 4.26955 14.789 4.52925 14.5293L13.3935 5.66504H6.66011C6.29284 5.66504 5.99507 5.36727 5.99507 5C5.99507 4.63273 6.29284 4.33496 6.66011 4.33496H14.9999L15.1337 4.34863C15.4369 4.41057 15.665 4.67857 15.665 5V13.3301C15.6649 13.6973 15.3672 13.9951 14.9999 13.9951C14.6327 13.9951 14.335 13.6973 14.3349 13.3301Z"
        fill="currentColor"
      />
    </svg>
  );
}

function turnDiffActionButtonClassName(tone: "default" | "destructive" = "default"): string {
  return cn(
    "group text-size-chat ml-auto inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-token-input-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
    tone === "destructive" ? "hover:bg-token-charts-red/10" : "hover:bg-token-foreground/5",
  );
}

function TurnDiffActionButton({
  label,
  onClick,
  tone = "default",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "destructive";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={turnDiffActionButtonClassName(tone)}
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
    >
      <span>{label}</span>
      <ReviewChangesIcon />
    </button>
  );
}

function TurnDiffBanner({
  summary,
  onReview,
}: {
  summary: TurnDiffSummary;
  onReview: (() => void) | null;
}) {
  return (
    <div className="bg-token-input-background/70 text-token-foreground border-token-border/80 relative overflow-clip border-x border-t backdrop-blur-sm transition-colors first:rounded-t-2xl">
      <div className="flex flex-col">
        <div className="flex w-full items-center justify-between gap-1.5 py-1.5 pr-2 pl-3 text-sm font-normal">
          <div className="text-size-chat flex w-full items-center justify-between">
            <div className="flex min-w-0 items-center gap-1">
              <span className="block min-w-0 truncate text-token-input-placeholder-foreground">
                {summary.fileCount <= 0
                  ? "Files changed"
                  : `${summary.fileCount} ${summary.fileCount === 1 ? "file" : "files"} changed`}
              </span>
              <span className="text-token-charts-green">+{summary.additions}</span>
              <span className="text-token-charts-red">-{summary.deletions}</span>
            </div>
            {onReview ? (
              <TurnDiffActionButton label="Review changes" onClick={onReview} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TurnDiffEmbeddedRow({
  row,
  openerId,
  diffHostClassName,
  diffHostStyle,
  diffOptions,
  onReview,
}: {
  row: TurnDiffRowModel;
  openerId: string;
  diffHostClassName: string;
  diffHostStyle: CSSProperties;
  diffOptions: ReturnType<typeof getNodexDiffOptions>;
  onReview: (() => void) | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();
  const openFileTransport = useMemo(() => resolveInvokeTransport("shell:open-file-link"), []);

  function openFile() {
    if (!row.openPath) return;
    void openFileTransport.invoke("shell:open-file-link", {
      path: row.openPath,
      ...(row.openLine ? { line: row.openLine } : {}),
    }, openerId);
  }

  return (
    <div
      className="group/file-diff flex flex-col overflow-clip bg-token-foreground/5"
      style={{
        "--codex-diffs-surface":
          "color-mix(in srgb, var(--color-token-side-bar-background) 97%, var(--color-token-foreground))",
      } as CSSProperties}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className="cursor-interaction select-none focus-visible:outline-none bg-token-side-bar-background"
        onClick={() => setIsExpanded((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setIsExpanded((current) => !current);
        }}
      >
        <div className="bg-token-foreground/5">
          <div className="group text-size-chat @container/diff-header relative flex items-center gap-2 pt-1 pr-1 pb-1 pl-3">
            <div className="text-size-chat flex min-w-0 items-center gap-2 pb-0.5 text-token-text-primary">
              {row.displayPath ? (
                <FilenameButton
                  displayPath={row.displayPath}
                  onOpen={row.openPath ? openFile : null}
                  dataState={isExpanded ? "open" : "closed"}
                  className="min-w-0 cursor-interaction truncate text-start text-token-text-primary select-text [direction:rtl]"
                />
              ) : (
                <span className="min-w-0 truncate text-start text-token-text-primary">Changed file</span>
              )}
              <DiffStats additions={row.additions} deletions={row.deletions} className="ml-auto shrink-0 text-size-chat" />
              <Chevron expanded={isExpanded} className="opacity-100" />
            </div>
          </div>
        </div>
      </div>
      <motion.div
        initial={false}
        animate={{
          height: isExpanded ? elementHeightPx : 0,
          opacity: isExpanded ? 1 : 0,
        }}
        transition={CODEX_THREAD_ACCORDION_TRANSITION}
        className={cn(isExpanded ? "overflow-visible" : "overflow-hidden")}
        data-thread-find-skip={isExpanded ? undefined : true}
        style={{
          pointerEvents: isExpanded ? "auto" : "none",
        }}
      >
        <div ref={elementRef}>
          <div className="bg-token-editor-background border-t border-token-border">
            {row.isTooLarge ? (
              <div className="text-token-description-foreground/80 flex flex-col items-center justify-center gap-2 px-4 py-5 text-size-chat">
                <span>Too large to render inline</span>
                {onReview ? (
                  <TurnDiffActionButton label="Review changes" onClick={onReview} />
                ) : null}
              </div>
            ) : row.fileDiff ? (
              <div className="overflow-hidden">
                <FileDiff
                  fileDiff={row.fileDiff}
                  className={cn(diffHostClassName, "max-h-[320px] overflow-y-auto")}
                  style={diffHostStyle}
                  options={diffOptions}
                />
              </div>
            ) : (
              <div className="text-token-description-foreground/80 flex items-center justify-center px-4 py-5 text-size-chat">
                No diff preview available
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function TurnDiffSurface({
  item,
  isInProgress,
  projectWorkspacePath,
  threadCwd,
  onOpenReview,
}: {
  item: CodexTranscriptEntry;
  isInProgress: boolean;
  projectWorkspacePath?: string;
  threadCwd?: string;
  onOpenReview?: (target: CodexTurnDiffReviewTarget) => void;
}) {
  const payload = extractTurnDiffPayload(item);
  const rows = useMemo(() => buildTurnDiffRows(item, threadCwd, projectWorkspacePath), [item, projectWorkspacePath, threadCwd]);
  const summary = useMemo(() => summarizeRows(rows, payload?.unifiedDiff), [payload?.unifiedDiff, rows]);
  const reviewTarget = useMemo(
    () => buildTurnDiffReviewTarget(item, threadCwd, projectWorkspacePath),
    [item, projectWorkspacePath, threadCwd],
  );
  const { resolved } = useTheme();
  const { opener } = useFileLinkOpener();
  const diffOptions = useMemo(() => getNodexDiffOptions(resolved, true), [resolved]);
  const diffHostStyle = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);
  const diffHostClassName = NODEX_DIFF_HOST_CLASS;
  const [isPatchApplied, setIsPatchApplied] = useState(true);
  const [patchActionInFlight, setPatchActionInFlight] = useState(false);
  const patchTransport = useMemo(() => resolveInvokeTransport("git:apply-patch"), []);

  useEffect(() => {
    setIsPatchApplied(true);
    setPatchActionInFlight(false);
  }, [reviewTarget?.entryId, reviewTarget?.patch]);

  if (!payload || (summary.fileCount === 0 && summary.additions === 0 && summary.deletions === 0)) {
    return null;
  }

  const handleOpenReview = reviewTarget && onOpenReview
    ? () => {
        onOpenReview(reviewTarget);
      }
    : null;

  const handleTogglePatch = reviewTarget?.showRevertButton && reviewTarget.cwd
    ? async () => {
        setPatchActionInFlight(true);
        try {
          const result = await patchTransport.invoke("git:apply-patch", {
            cwd: reviewTarget.cwd,
            diff: reviewTarget.patch,
            target: "unstaged",
            revert: isPatchApplied,
          }) as GitApplyPatchResult;

          if (result.status === "success") {
            setIsPatchApplied((current) => !current);
            toast.success(isPatchApplied ? "Reverted thread changes." : "Reapplied thread changes.", {
              id: "turn-diff-notice",
            });
            return;
          }

          toast.danger(
            result.status === "partial-success"
              ? "Partially applied thread patch. Review the workspace before continuing."
              : (result.errorMessage ?? "Could not apply thread patch."),
            {
              id: "turn-diff-notice",
            },
          );
        } catch (error) {
          toast.danger(error instanceof Error ? error.message : "Could not apply thread patch.", {
            id: "turn-diff-notice",
          });
        } finally {
          setPatchActionInFlight(false);
        }
      }
    : null;

  if (isInProgress) {
    return <TurnDiffBanner summary={summary} onReview={handleOpenReview} />;
  }

  return (
    <div className="mb-2 flex flex-col overflow-hidden rounded-xl bg-token-list-hover-background/60 text-base">
      <div className="flex items-center gap-2">
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-1 pr-1 pl-3">
          <TurnDiffFilesChangedLabel fileCount={summary.fileCount} />
          {summary.fileCount > 1 ? (
            <DiffStats additions={summary.additions} deletions={summary.deletions} className="text-size-chat" />
          ) : null}
          <div className="flex-1" />
          {handleTogglePatch ? (
            <TurnDiffActionButton
              label={isPatchApplied ? "Revert changes" : "Reapply changes"}
              onClick={() => {
                void handleTogglePatch();
              }}
              tone={isPatchApplied ? "destructive" : "default"}
              disabled={patchActionInFlight}
            />
          ) : null}
          {handleOpenReview ? (
            <TurnDiffActionButton label="Review changes" onClick={handleOpenReview} disabled={patchActionInFlight} />
          ) : null}
        </div>
      </div>
      <div className="flex flex-col divide-y-[0.5px] divide-token-border">
        {rows.map((row) => (
          <TurnDiffEmbeddedRow
            key={row.key}
            row={row}
            openerId={opener}
            diffHostClassName={diffHostClassName}
            diffHostStyle={diffHostStyle}
            diffOptions={diffOptions}
            onReview={row.isTooLarge ? handleOpenReview : null}
          />
        ))}
      </div>
    </div>
  );
}

export const turnDiffSurfaceTestHelpers = {
  buildTurnDiffRows,
  buildTurnDiffReviewTarget,
};
