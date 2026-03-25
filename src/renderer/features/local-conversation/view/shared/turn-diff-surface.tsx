import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { motion } from "motion/react";
import { useMemo, useState, type CSSProperties } from "react";
import { invoke } from "../../../../lib/api";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "../../../../lib/diff-presentation";
import { useFileLinkOpener } from "../../../../lib/use-file-link-opener";
import { useTheme } from "../../../../lib/use-theme";
import type { CodexTranscriptEntry } from "../../../../lib/types";
import { cn } from "../../../../lib/utils";
import { CODEX_MEASURED_TRANSITION, useMeasuredElementHeight } from "./use-measured-element-height";
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

function TurnDiffBanner({ summary }: { summary: TurnDiffSummary }) {
  return (
    <div className="mb-2 flex flex-col overflow-hidden rounded-xl bg-token-list-hover-background/60 text-base">
      <div className="flex items-center gap-2">
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-1 pr-1 pl-3">
          <TurnDiffFilesChangedLabel fileCount={summary.fileCount} />
          <DiffStats
            additions={summary.additions}
            deletions={summary.deletions}
            className="text-size-chat"
          />
          <div className="flex-1" />
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
}: {
  row: TurnDiffRowModel;
  openerId: string;
  diffHostClassName: string;
  diffHostStyle: CSSProperties;
  diffOptions: ReturnType<typeof getNodexDiffOptions>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();

  function openFile() {
    if (!row.openPath) return;
    void invoke("shell:open-file-link", {
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
        transition={CODEX_MEASURED_TRANSITION}
        className={cn(isExpanded ? "overflow-visible" : "overflow-hidden")}
        data-thread-find-skip={isExpanded ? undefined : true}
        style={{
          pointerEvents: isExpanded ? "auto" : "none",
        }}
      >
        <div ref={elementRef}>
          <div className="bg-token-editor-background border-t border-token-border">
            {row.isTooLarge ? (
              <div className="text-token-description-foreground/80 flex items-center justify-center px-4 py-5 text-size-chat">
                Too large to render inline
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
  projectWorkspacePath,
  threadCwd,
}: {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
}) {
  const payload = extractTurnDiffPayload(item);
  const rows = useMemo(() => buildTurnDiffRows(item, threadCwd, projectWorkspacePath), [item, projectWorkspacePath, threadCwd]);
  const summary = useMemo(() => summarizeRows(rows, payload?.unifiedDiff), [payload?.unifiedDiff, rows]);
  const { resolved } = useTheme();
  const { opener } = useFileLinkOpener();
  const diffOptions = useMemo(() => getNodexDiffOptions(resolved, true), [resolved]);
  const diffHostStyle = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);
  const diffHostClassName = NODEX_DIFF_HOST_CLASS;

  if (!payload || (summary.fileCount === 0 && summary.additions === 0 && summary.deletions === 0)) {
    return null;
  }

  if (item.status === "inProgress") {
    return <TurnDiffBanner summary={summary} />;
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
          />
        ))}
      </div>
    </div>
  );
}

export const turnDiffSurfaceTestHelpers = {
  buildTurnDiffRows,
};
