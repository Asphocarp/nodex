import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, PatchDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { motion } from "motion/react";
import {
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "../../../../../lib/api";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "../../../../../lib/diff-presentation";
import { useFileLinkOpener } from "../../../../../lib/use-file-link-opener";
import { useTheme } from "../../../../../lib/use-theme";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { CODEX_MEASURED_TRANSITION, useMeasuredElementHeight } from "../use-measured-element-height";
import { CopyMessageActionButton } from "../thread-message-actions";
import { ToolErrorDetail } from "./tool-primitives";
import {
  Chevron,
  DiffStats,
  FilenameButton,
  type DiffSummary,
  normalizePathSegments,
  resolveOpenPath,
  stripPatchPrefix,
  summarizeDiff,
  summarizeFileDiffMetadata,
} from "./diff-file-shared";

interface FileChangeToolCallProps {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
}

interface ParsedChange {
  path?: string;
  diff?: string;
}

interface FileChangeRowModel {
  key: string;
  displayPath: string | null;
  openPath: string | null;
  label: "Edited" | "Editing" | "Created" | "Creating" | "Deleted" | "Deleting";
  expandedLabel: "Edited file" | "Created file" | "Deleted file";
  summary: DiffSummary;
  unifiedDiff?: string;
  fileDiff?: FileDiffMetadata;
  openLine?: number;
}

function extractDiffText(item: CodexTranscriptEntry): string | undefined {
  const toolResult = item.toolCall?.result;
  if (typeof toolResult !== "object" || toolResult === null) return undefined;

  const candidate = toolResult as { diff?: unknown };
  if (typeof candidate.diff !== "string") return undefined;
  if (candidate.diff.trim().length === 0) return undefined;
  return candidate.diff;
}

function extractParsedChanges(item: CodexTranscriptEntry): ParsedChange[] {
  const args = item.toolCall?.args;
  if (typeof args !== "object" || args === null) return [];

  const candidate = args as { changes?: unknown };
  if (!Array.isArray(candidate.changes)) return [];

  return candidate.changes
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      path: typeof entry.path === "string" ? entry.path : undefined,
      diff: typeof entry.diff === "string" ? entry.diff : undefined,
    }))
    .filter((entry) => typeof entry.diff === "string" && entry.diff.trim().length > 0);
}

function isSingleFilePatch(patch: string): boolean {
  try {
    const parsed = parsePatchFiles(patch);
    return parsed.length === 1 && parsed[0]?.files.length === 1;
  } catch {
    return false;
  }
}

function toSingleFilePatch(change: ParsedChange, index: number): string | undefined {
  if (!change.diff) return undefined;

  const normalizedDiff = `${change.diff.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd()}\n`;
  if (normalizedDiff.trim().length === 0) return undefined;
  if (isSingleFilePatch(normalizedDiff)) return normalizedDiff;

  const hasHunkHeader = normalizedDiff.split("\n").some((line) => line.startsWith("@@ "));
  if (!hasHunkHeader) return undefined;

  const patchPath = normalizePathSegments(change.path ? stripPatchPrefix(change.path) : `file-${index + 1}.txt`);
  const synthesizedPatch = `--- a/${patchPath}\n+++ b/${patchPath}\n${normalizedDiff}`;
  return isSingleFilePatch(synthesizedPatch) ? synthesizedPatch : undefined;
}

function parseSingleFilePatch(patch: string): FileDiffMetadata | null {
  try {
    const parsed = parsePatchFiles(patch);
    return parsed[0]?.files[0] ?? null;
  } catch {
    return null;
  }
}

function parseDiffFiles(diffText: string | undefined): FileDiffMetadata[] {
  if (!diffText) return [];

  try {
    return parsePatchFiles(diffText).flatMap((patch) => patch.files);
  } catch {
    return [];
  }
}

function resolveOpenLine(fileDiff: FileDiffMetadata | null | undefined): number | undefined {
  const firstHunk = fileDiff?.hunks[0];
  if (!firstHunk) return undefined;

  const line = firstHunk.additionStart > 0 ? firstHunk.additionStart : firstHunk.deletionStart;
  return line > 0 ? line : 1;
}

function resolveRowLabels(
  fileDiff: FileDiffMetadata | null | undefined,
  itemStatus: CodexTranscriptEntry["status"] | undefined,
): Pick<FileChangeRowModel, "label" | "expandedLabel"> {
  const isPending = itemStatus === "inProgress";
  if (fileDiff?.type === "new") {
    return {
      label: isPending ? "Creating" : "Created",
      expandedLabel: "Created file",
    };
  }

  if (fileDiff?.type === "deleted") {
    return {
      label: isPending ? "Deleting" : "Deleted",
      expandedLabel: "Deleted file",
    };
  }

  return {
    label: isPending ? "Editing" : "Edited",
    expandedLabel: "Edited file",
  };
}

function resolveChangeBasePath(
  item: CodexTranscriptEntry,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): string | null {
  const args = item.toolCall?.args;
  if (typeof args === "object" && args !== null) {
    const cwd = (args as { cwd?: unknown }).cwd;
    if (typeof cwd === "string" && cwd.trim().length > 0) return cwd;
  }

  if (typeof threadCwd === "string" && threadCwd.trim().length > 0) return threadCwd;
  if (typeof projectWorkspacePath === "string" && projectWorkspacePath.trim().length > 0) return projectWorkspacePath;
  return null;
}

function buildRowModelFromPatch(
  patch: string,
  fallbackPath: string | undefined,
  index: number,
  itemStatus: CodexTranscriptEntry["status"] | undefined,
  basePath: string | null,
): FileChangeRowModel | null {
  const fileDiff = parseSingleFilePatch(patch);
  if (!fileDiff) return null;

  const resolvedPath = stripPatchPrefix(fallbackPath ?? fileDiff.name ?? fileDiff.prevName ?? `file-${index + 1}.txt`);
  const labels = resolveRowLabels(fileDiff, itemStatus);
  return {
    key: `patch:${resolvedPath}:${index}`,
    displayPath: resolvedPath,
    openPath: resolveOpenPath(resolvedPath, basePath),
    label: labels.label,
    expandedLabel: labels.expandedLabel,
    summary: summarizeDiff(patch),
    unifiedDiff: patch,
    fileDiff,
    openLine: resolveOpenLine(fileDiff),
  };
}

function buildRowModelFromFileDiff(
  fileDiff: FileDiffMetadata,
  index: number,
  itemStatus: CodexTranscriptEntry["status"] | undefined,
  basePath: string | null,
): FileChangeRowModel {
  const resolvedPath = stripPatchPrefix(fileDiff.name ?? fileDiff.prevName ?? `file-${index + 1}.txt`);
  const labels = resolveRowLabels(fileDiff, itemStatus);
  return {
    key: `file-diff:${resolvedPath}:${index}`,
    displayPath: resolvedPath,
    openPath: resolveOpenPath(resolvedPath, basePath),
    label: labels.label,
    expandedLabel: labels.expandedLabel,
    summary: summarizeFileDiffMetadata(fileDiff),
    fileDiff,
    openLine: resolveOpenLine(fileDiff),
  };
}

function buildFileChangeRows(
  item: CodexTranscriptEntry,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): FileChangeRowModel[] {
  const basePath = resolveChangeBasePath(item, threadCwd, projectWorkspacePath);
  const patchesFromChanges = extractParsedChanges(item)
    .map((change, index) => buildRowModelFromPatch(
      toSingleFilePatch(change, index) ?? "",
      change.path,
      index,
      item.status,
      basePath,
    ))
    .filter((row): row is FileChangeRowModel => row !== null);

  if (patchesFromChanges.length > 0) return patchesFromChanges;

  const diffText = extractDiffText(item);
  const parsedFileDiffs = parseDiffFiles(diffText);
  if (parsedFileDiffs.length > 0) {
    return parsedFileDiffs.map((fileDiff, index) => buildRowModelFromFileDiff(
      fileDiff,
      index,
      item.status,
      basePath,
    ));
  }

  if (diffText) {
    return [{
      key: `raw-diff:${item.entryId ?? item.itemId}`,
      displayPath: null,
      openPath: null,
      label: item.status === "inProgress" ? "Editing" : "Edited",
      expandedLabel: "Edited file",
      summary: summarizeDiff(diffText),
      unifiedDiff: diffText,
    }];
  }

  return [];
}

function PatchFrame({
  row,
  diffHostClassName,
  diffHostStyle,
  diffOptions,
  onOpenFile,
  isShortView,
}: {
  row: FileChangeRowModel;
  diffHostClassName: string;
  diffHostStyle: CSSProperties;
  diffOptions: ReturnType<typeof getNodexDiffOptions>;
  onOpenFile: (() => void) | null;
  isShortView: boolean;
}) {
  const preview = row.unifiedDiff ? (
    <PatchDiff
      patch={row.unifiedDiff}
      className={cn(diffHostClassName, isShortView ? "max-h-25" : "max-h-60")}
      style={diffHostStyle}
      options={diffOptions}
    />
  ) : row.fileDiff ? (
    <FileDiff
      fileDiff={row.fileDiff}
      className={cn(diffHostClassName, isShortView ? "max-h-25" : "max-h-60")}
      style={diffHostStyle}
      options={diffOptions}
    />
  ) : (
    <div className="text-token-description-foreground/80 bg-token-editor-background flex w-full items-center justify-center px-2 pt-7 pb-8 text-size-chat">
      No changes
    </div>
  );

  return (
    <div className="border-token-border flex flex-col overflow-hidden rounded-lg border mt-1.5">
      <div className="text-size-chat-sm flex items-center justify-between gap-2 border-b border-token-border bg-token-list-hover-background/60 px-2.5 py-0.5 text-token-description-foreground/80">
        <div className="flex min-w-0 items-center gap-2">
          {row.displayPath ? (
            <FilenameButton
              displayPath={row.displayPath}
              onOpen={onOpenFile}
              className={cn(
                "text-token-description-foreground/80 cursor-interaction max-w-full truncate text-start hover:underline",
                !onOpenFile && "cursor-default no-underline",
              )}
            />
          ) : null}
          <DiffStats additions={row.summary.additions} deletions={row.summary.deletions} />
        </div>
        {row.unifiedDiff ? (
          <CopyMessageActionButton
            text={row.unifiedDiff}
            label="Copy diff"
            copiedLabel="Copied diff"
            tooltipLabel="Copy"
            copiedTooltipLabel="Copied"
          />
        ) : null}
      </div>
      <div className="bg-token-editor-background">
        {preview}
      </div>
    </div>
  );
}

function FileChangeRow({
  row,
  diffHostClassName,
  diffHostStyle,
  diffOptions,
  openerId,
}: {
  row: FileChangeRowModel;
  diffHostClassName: string;
  diffHostStyle: CSSProperties;
  diffOptions: ReturnType<typeof getNodexDiffOptions>;
  openerId: string;
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

  const showSummaryFilename = !isExpanded && row.displayPath !== null;
  const showSummaryStats = !isExpanded;

  return (
    <div className="px-0">
      <div className={cn("flex flex-col overflow-clip transition-[box-shadow] duration-300", isExpanded ? "rounded-xl" : "rounded-lg")}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          className="cursor-interaction group flex items-center justify-between gap-1 text-ellipsis text-size-chat px-0 py-0"
          onClick={() => {
            setIsExpanded((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setIsExpanded((current) => !current);
          }}
        >
          <div className="text-size-chat flex min-w-0 items-center gap-1 text-token-description-foreground/80">
            <span className="text-token-description-foreground/80 group-hover:text-token-foreground select-text">
              {isExpanded ? row.expandedLabel : row.label}
            </span>
            {showSummaryFilename && row.displayPath ? (
              <FilenameButton
                displayPath={row.displayPath}
                onOpen={row.openPath ? openFile : null}
                dataState={isExpanded ? "open" : "closed"}
                className="max-w-full cursor-interaction truncate text-start text-token-text-link-foreground select-text hover:underline"
              />
            ) : null}
            {showSummaryStats ? (
              <DiffStats additions={row.summary.additions} deletions={row.summary.deletions} />
            ) : null}
            <Chevron expanded={isExpanded} />
          </div>
          <div className="ml-1 flex items-center gap-1 transition-opacity duration-200" />
        </div>
        <motion.div
          data-patch-row-body=""
          className={cn(isExpanded ? "overflow-visible" : "overflow-hidden")}
          data-thread-find-skip={isExpanded ? undefined : true}
          initial={false}
          animate={{
            height: isExpanded ? elementHeightPx : 0,
            opacity: isExpanded ? 1 : 0,
          }}
          transition={CODEX_MEASURED_TRANSITION}
          style={{
            pointerEvents: isExpanded ? "auto" : "none",
          }}
        >
          <div ref={elementRef}>
            <PatchFrame
              row={row}
              diffHostClassName={diffHostClassName}
              diffHostStyle={diffHostStyle}
              diffOptions={diffOptions}
              onOpenFile={row.openPath ? openFile : null}
              isShortView={row.label === "Editing" || row.label === "Creating" || row.label === "Deleting"}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export function FileChangeToolCall({
  item,
  projectWorkspacePath,
  threadCwd,
}: FileChangeToolCallProps) {
  const { resolved } = useTheme();
  const { opener } = useFileLinkOpener();
  const rows = useMemo(() => buildFileChangeRows(item, threadCwd, projectWorkspacePath), [
    item,
    projectWorkspacePath,
    threadCwd,
  ]);
  const isSingleFile = rows.length <= 1;
  const diffOptions = useMemo(() => getNodexDiffOptions(resolved, isSingleFile), [resolved, isSingleFile]);
  const diffHostStyle = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);
  const diffHostClassName = `${NODEX_DIFF_HOST_CLASS} overflow-y-auto`;

  if (rows.length === 0 && !item.toolCall?.error) return null;

  return (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      <div className="flex flex-col gap-[var(--conversation-tool-assistant-gap,8px)]">
        {rows.map((row) => (
          <FileChangeRow
            key={row.key}
            row={row}
            diffHostClassName={diffHostClassName}
            diffHostStyle={diffHostStyle}
            diffOptions={diffOptions}
            openerId={opener}
          />
        ))}
        {item.toolCall?.error ? (
          <ToolErrorDetail
            error={item.toolCall.error}
            showLabel={rows.length === 0}
            className={rows.length === 0 ? undefined : "px-1 py-1"}
          />
        ) : null}
      </div>
    </div>
  );
}

export const fileChangeToolCallTestHelpers = {
  buildFileChangeRows,
  resolveOpenPath,
  resolveOpenLine,
};
