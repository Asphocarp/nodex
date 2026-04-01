import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { motion } from "motion/react";
import {
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { buildCodexFileChangeUnifiedDiff } from "../../../../../../shared/codex-file-change";
import { invoke } from "../../../../../lib/api";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "../../../../../lib/diff-presentation";
import { useFileLinkOpener } from "../../../../../lib/use-file-link-opener";
import { useTheme } from "../../../../../lib/use-theme";
import type { CodexFileChange, CodexTranscriptEntry } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../thread-motion";
import { useMeasuredElementHeight } from "../use-measured-element-height";
import { CopyMessageActionButton } from "../thread-message-actions";
import { CodeBlock, ToolErrorDetail } from "./tool-primitives";
import {
  Chevron,
  DiffStats,
  FilenameButton,
  type DiffSummary,
  resolveOpenPath,
  summarizeDiff,
  summarizeFileDiffMetadata,
} from "./diff-file-shared";

interface FileChangeToolCallProps {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
}

type FileChangeRowAction = "edit" | "create" | "delete";
type FileChangeRowState = "applied" | "pending" | "rejected";
type FileChangeRowPreview =
  | {
      kind: "diff";
      unifiedDiff: string;
      fileDiff: FileDiffMetadata;
      copyText: string;
      openLine?: number;
    }
  | {
      kind: "semantic";
      copyText: string | null;
    };

interface FileChangeRowModel {
  key: string;
  displayPath: string;
  openPath: string | null;
  action: FileChangeRowAction;
  state: FileChangeRowState;
  label: string;
  expandedLabel: string | null;
  summary: DiffSummary;
  preview: FileChangeRowPreview;
  change: CodexFileChange;
}

function extractParsedChanges(item: CodexTranscriptEntry): CodexFileChange[] {
  return item.fileChange?.changes ?? [];
}

function parseSingleFilePatch(patch: string | null): FileDiffMetadata | null {
  if (!patch) return null;

  try {
    const parsed = parsePatchFiles(patch);
    if (parsed.length !== 1) return null;
    if (parsed[0]?.files.length !== 1) return null;
    return parsed[0]?.files[0] ?? null;
  } catch {
    return null;
  }
}

function resolveOpenLine(fileDiff: FileDiffMetadata | null | undefined): number | undefined {
  const firstHunk = fileDiff?.hunks[0];
  if (!firstHunk) return undefined;

  const line = firstHunk.additionStart > 0 ? firstHunk.additionStart : firstHunk.deletionStart;
  return line > 0 ? line : 1;
}

function resolveRowState(itemStatus: CodexTranscriptEntry["status"] | undefined): FileChangeRowState {
  if (itemStatus === "inProgress") return "pending";
  if (itemStatus === "failed" || itemStatus === "declined") return "rejected";
  return "applied";
}

function resolveRowAction(change: CodexFileChange): FileChangeRowAction {
  if (change.type === "add") return "create";
  if (change.type === "delete") return "delete";
  return "edit";
}

function resolveRowLabels(
  action: FileChangeRowAction,
  state: FileChangeRowState,
): { label: string; expandedLabel: string | null } {
  if (state === "rejected") {
    return {
      label: "Rejected",
      expandedLabel: null,
    };
  }

  if (state === "pending") {
    return {
      label: action === "create" ? "Creating" : action === "delete" ? "Deleting" : "Editing",
      expandedLabel: null,
    };
  }

  return {
    label: action === "create" ? "Created" : action === "delete" ? "Deleted" : "Edited",
    expandedLabel: action === "create" ? "Created file" : action === "delete" ? "Deleted file" : "Edited file",
  };
}

function countContentLines(content: string): number {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.length === 0) return 0;
  const lines = normalized.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

function summarizeFallbackChange(change: CodexFileChange, unifiedDiff: string | null): DiffSummary {
  if (change.type === "add") {
    return { additions: countContentLines(change.content), deletions: 0 };
  }
  if (change.type === "delete") {
    return { additions: 0, deletions: countContentLines(change.content) };
  }
  return summarizeDiff(unifiedDiff ?? change.unifiedDiff);
}

function hasVisibleDiffSummary(summary: DiffSummary): boolean {
  return summary.additions > 0 || summary.deletions > 0;
}

function DiffSummaryIndicator({
  action,
  summary,
}: {
  action: FileChangeRowAction;
  summary: DiffSummary;
}) {
  if (!hasVisibleDiffSummary(summary)) return null;
  if (action === "create") {
    return <span className="block size-1.5 rounded-full bg-token-charts-blue/70" />;
  }
  if (action === "delete") {
    return <span className="block size-1.5 rounded-full bg-token-charts-red/70" />;
  }
  return null;
}

function resolveChangeBasePath(
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): string | null {
  if (typeof threadCwd === "string" && threadCwd.trim().length > 0) return threadCwd;
  if (typeof projectWorkspacePath === "string" && projectWorkspacePath.trim().length > 0) return projectWorkspacePath;
  return null;
}

function buildFileChangeRow(
  change: CodexFileChange,
  index: number,
  itemStatus: CodexTranscriptEntry["status"] | undefined,
  basePath: string | null,
): FileChangeRowModel {
  const unifiedDiff = buildCodexFileChangeUnifiedDiff(change);
  const fileDiff = parseSingleFilePatch(unifiedDiff);
  const action = resolveRowAction(change);
  const state = resolveRowState(itemStatus);
  const labels = resolveRowLabels(action, state);
  const summary = fileDiff ? summarizeFileDiffMetadata(fileDiff) : summarizeFallbackChange(change, unifiedDiff);
  const preview: FileChangeRowPreview = fileDiff && unifiedDiff
    ? {
        kind: "diff",
        unifiedDiff,
        fileDiff,
        copyText: unifiedDiff,
        openLine: resolveOpenLine(fileDiff),
      }
    : {
        kind: "semantic",
        copyText: unifiedDiff,
      };

  return {
    key: `${change.type}:${change.path}:${index}`,
    displayPath: change.path,
    openPath: resolveOpenPath(change.path, basePath),
    action,
    state,
    label: labels.label,
    expandedLabel: labels.expandedLabel,
    summary,
    preview,
    change,
  };
}

export function buildFileChangeRows(
  item: CodexTranscriptEntry,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): FileChangeRowModel[] {
  const basePath = resolveChangeBasePath(threadCwd, projectWorkspacePath);
  return extractParsedChanges(item).map((change, index) => buildFileChangeRow(change, index, item.status, basePath));
}

function FileChangeCodePreview({
  content,
  isShortView,
}: {
  content: string;
  isShortView: boolean;
}) {
  return (
    <CodeBlock className={cn(
      "vertical-scroll-fade-mask rounded-none border-0 bg-transparent px-2 py-2 text-size-chat [--edge-fade-distance:1rem]",
      isShortView ? "max-h-25" : "max-h-40",
    )}
    >
      {content}
    </CodeBlock>
  );
}

function SemanticChangePreview({
  row,
  isShortView,
}: {
  row: FileChangeRowModel;
  isShortView: boolean;
}) {
  if (row.change.type === "delete") {
    return (
      <div className="text-token-description-foreground/80 bg-token-editor-background flex w-full items-center justify-center px-2 pt-7 pb-8 text-size-chat">
        Contents deleted
      </div>
    );
  }

  if (row.change.type === "add") {
    return <FileChangeCodePreview content={row.change.content} isShortView={isShortView} />;
  }

  return <FileChangeCodePreview content={row.change.unifiedDiff} isShortView={isShortView} />;
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
  const preview = row.preview.kind === "diff" ? (
    <FileDiff
      fileDiff={row.preview.fileDiff}
      className={cn(diffHostClassName, isShortView ? "max-h-25" : "max-h-60")}
      style={diffHostStyle}
      options={diffOptions}
    />
  ) : (
    <SemanticChangePreview row={row} isShortView={isShortView} />
  );

  return (
    <div className="border-token-border flex flex-col overflow-hidden rounded-lg border mt-1.5">
      <div className="text-size-chat-sm flex items-center justify-between gap-2 border-b border-token-border bg-token-list-hover-background/60 px-2.5 py-0.5 text-token-description-foreground/80">
        <div className="flex min-w-0 items-center gap-2">
          <FilenameButton
            displayPath={row.displayPath}
            onOpen={onOpenFile}
            className={cn(
              "text-token-description-foreground/80 cursor-interaction max-w-full truncate text-start hover:underline",
              !onOpenFile && "cursor-default no-underline",
            )}
          />
          <DiffStats additions={row.summary.additions} deletions={row.summary.deletions} />
        </div>
        {row.preview.copyText ? (
          <CopyMessageActionButton
            text={row.preview.copyText}
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
      ...(row.preview.kind === "diff" && row.preview.openLine ? { line: row.preview.openLine } : {}),
    }, openerId);
  }

  const summaryLabel = isExpanded && row.expandedLabel ? row.expandedLabel : row.label;
  const showCollapsedStats = !isExpanded && hasVisibleDiffSummary(row.summary);
  const showCollapsedIndicator = !isExpanded;

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
              {summaryLabel}
            </span>
            {!isExpanded ? (
              <FilenameButton
                displayPath={row.displayPath}
                onOpen={row.openPath ? openFile : null}
                dataState={isExpanded ? "open" : "closed"}
                className="max-w-full cursor-interaction truncate text-start text-token-text-link-foreground select-text hover:underline"
              />
            ) : null}
            {showCollapsedStats ? (
              <DiffStats additions={row.summary.additions} deletions={row.summary.deletions} />
            ) : null}
            {showCollapsedIndicator ? (
              <DiffSummaryIndicator action={row.action} summary={row.summary} />
            ) : null}
            <Chevron expanded={isExpanded} />
          </div>
          <div className="ml-1 flex items-center gap-1 transition-opacity duration-200" />
        </div>
        <motion.div
          data-file-change-row-body=""
          className={cn(isExpanded ? "overflow-visible" : "overflow-hidden")}
          data-thread-find-skip={isExpanded ? undefined : true}
          initial={false}
          animate={{
            height: isExpanded ? elementHeightPx : 0,
            opacity: isExpanded ? 1 : 0,
          }}
          transition={CODEX_THREAD_ACCORDION_TRANSITION}
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
              isShortView={row.state === "pending"}
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
  const diffOptions = useMemo(() => getNodexDiffOptions(resolved, true), [resolved]);
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
