import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { motion } from "motion/react";
import {
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  buildCodexFileChangePatchRows,
  resolveCodexFileChangeDisplayStatus,
  type CodexFileChangePatchAction,
  type CodexFileChangePatchRow,
  type CodexFileChangeDisplayStatus,
  type CodexUnifiedDiffSummary,
} from "../../../../../../shared/codex-file-change";
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
import { AutomaticApprovalReviewRows, AutomaticApprovalReviewShield } from "../automatic-approval-review-surface";
import { CodexShimmerText } from "../codex-shimmer-text";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../thread-motion";
import { useMeasuredElementHeight } from "../use-measured-element-height";
import { CopyMessageActionButton } from "../thread-message-actions";
import { CodeBlock, ToolErrorDetail } from "./tool-primitives";
import {
  Chevron,
  DiffStats,
  FilenameButton,
  resolveOpenPath,
} from "./diff-file-shared";
import { InlineFileDiff } from "./inline-file-diff";

interface FileChangeToolCallProps {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
  isTurnCancelled?: boolean;
  automaticApprovalReviews?: CodexTranscriptEntry[];
}

type FileChangeRowAction = CodexFileChangePatchAction;
type FileChangeRowState = CodexFileChangeDisplayStatus;
type FileChangeRowPreview =
  | {
      kind: "diff";
      unifiedDiff: string;
      fileDiff: FileDiffMetadata;
      copyText: string;
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
  showActionLabel: boolean;
  expandedLabel: string | null;
  summary: CodexUnifiedDiffSummary | null;
  openLine?: number;
  preview: FileChangeRowPreview;
  change: CodexFileChange;
  automaticApprovalReviews: CodexTranscriptEntry[];
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

function resolveRowLabels(
  action: FileChangeRowAction,
  state: FileChangeRowState,
): { label: string; showActionLabel: boolean; expandedLabel: string | null } {
  if (state === "pending") {
    return {
      label: action === "create" ? "Creating" : action === "delete" ? "Deleting" : "Editing",
      showActionLabel: false,
      expandedLabel: null,
    };
  }

  if (state === "rejected") {
    return {
      label: "Rejected",
      showActionLabel: true,
      expandedLabel: null,
    };
  }

  if (state === "stopped") {
    return {
      label: action === "create" ? "Stopped creating" : action === "delete" ? "Stopped deleting" : "Stopped editing",
      showActionLabel: true,
      expandedLabel: null,
    };
  }

  if (state === "streaming") {
    return {
      label: action === "create" ? "Creating" : action === "delete" ? "Deleting" : "Editing",
      showActionLabel: true,
      expandedLabel: null,
    };
  }

  return {
    label: action === "create" ? "Created" : action === "delete" ? "Deleted" : "Edited",
    showActionLabel: true,
    expandedLabel: action === "create" ? "Created file" : action === "delete" ? "Deleted file" : "Edited file",
  };
}

function hasVisibleDiffSummary(summary: CodexUnifiedDiffSummary | null): boolean {
  return summary != null && (summary.additions > 0 || summary.deletions > 0);
}

function DiffSummaryIndicator({
  action,
  summary,
}: {
  action: FileChangeRowAction;
  summary: CodexUnifiedDiffSummary | null;
}) {
  if (action === "delete") {
    return summary ? <span className="block size-1.5 rounded-full bg-token-charts-red/70" /> : null;
  }
  if (action === "create") {
    if (!hasVisibleDiffSummary(summary)) return null;
    return <span className="block size-1.5 rounded-full bg-token-charts-blue/70" />;
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
  patchRow: CodexFileChangePatchRow,
  item: CodexTranscriptEntry,
  basePath: string | null,
  isTurnCancelled: boolean,
  automaticApprovalReviews: CodexTranscriptEntry[],
): FileChangeRowModel {
  const unifiedDiff = patchRow.unifiedDiff;
  const fileDiff = parseSingleFilePatch(unifiedDiff);
  const state = resolveCodexFileChangeDisplayStatus({
    itemStatus: item.status,
    approvalRequestId: item.approvalRequestId,
    isTurnCancelled,
  });
  const labels = resolveRowLabels(patchRow.action, state);
  const preview: FileChangeRowPreview = fileDiff && unifiedDiff
    ? {
        kind: "diff",
        unifiedDiff,
        fileDiff,
        copyText: unifiedDiff,
      }
    : {
        kind: "semantic",
        copyText: unifiedDiff,
      };

  return {
    key: patchRow.key,
    displayPath: patchRow.path,
    openPath: resolveOpenPath(patchRow.path, basePath),
    action: patchRow.action,
    state,
    label: labels.label,
    showActionLabel: labels.showActionLabel,
    expandedLabel: labels.expandedLabel,
    summary: patchRow.summary,
    openLine: patchRow.openLine,
    preview,
    change: patchRow.change,
    automaticApprovalReviews,
  };
}

export function buildFileChangeRows(
  item: CodexTranscriptEntry,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
  isTurnCancelled = false,
  automaticApprovalReviews: CodexTranscriptEntry[] = [],
): FileChangeRowModel[] {
  const basePath = resolveChangeBasePath(threadCwd, projectWorkspacePath);
  return buildCodexFileChangePatchRows(item.fileChange?.changes).map((row) =>
    buildFileChangeRow(row, item, basePath, isTurnCancelled, automaticApprovalReviews)
  );
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
    <InlineFileDiff
      fileDiff={row.preview.fileDiff}
      className={cn(diffHostClassName, isShortView ? "max-h-25" : "max-h-60")}
      style={diffHostStyle}
      options={diffOptions}
      displayPath={row.displayPath}
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
          {row.summary ? (
            <DiffStats
              additions={row.summary.additions}
              deletions={row.summary.deletions}
              showZero
            />
          ) : null}
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
      ...(row.openLine ? { line: row.openLine } : {}),
    }, openerId);
  }

  const useExpandedSettledHeader = isExpanded && row.expandedLabel !== null;
  const summaryLabel = useExpandedSettledHeader && row.expandedLabel ? row.expandedLabel : row.label;
  const showInlineStats = !useExpandedSettledHeader
    && (row.action === "delete" ? row.summary != null : hasVisibleDiffSummary(row.summary));
  const showCollapsedIndicator = !useExpandedSettledHeader;
  const actionLabel = row.showActionLabel ? (
    row.state === "streaming" ? (
      <CodexShimmerText className="text-token-description-foreground/80 group-hover/activity-header:text-token-foreground select-text">
        {summaryLabel}
      </CodexShimmerText>
    ) : (
      <CodexShimmerText
        active={false}
        className="text-token-description-foreground/80 group-hover/activity-header:text-token-foreground select-text"
      >
        {summaryLabel}
      </CodexShimmerText>
    )
  ) : null;
  const hasApprovalReviews = row.automaticApprovalReviews.length > 0;
  const body = (
    <div ref={row.state === "streaming" ? undefined : elementRef}>
      {hasApprovalReviews ? (
        <AutomaticApprovalReviewRows items={row.automaticApprovalReviews} />
      ) : null}
      <PatchFrame
        row={row}
        diffHostClassName={diffHostClassName}
        diffHostStyle={diffHostStyle}
        diffOptions={diffOptions}
        onOpenFile={row.openPath && row.openLine ? openFile : null}
        isShortView={row.state === "pending"}
      />
    </div>
  );

  return (
    <div className="px-0">
      <div
        className={cn(
          "flex flex-col overflow-clip transition-[box-shadow] duration-300",
          row.state === "pending" ? "rounded-xl" : "rounded-lg",
        )}
      >
        <div
          data-file-change-row-header=""
          className="cursor-interaction group/activity-header flex items-center justify-between gap-1 text-ellipsis text-size-chat px-0 py-0"
          onClick={() => {
            setIsExpanded((current) => !current);
          }}
        >
          <div className="text-size-chat flex min-w-0 items-center gap-1 text-token-description-foreground/80">
            {actionLabel}
            {!useExpandedSettledHeader ? (
              <FilenameButton
                displayPath={row.displayPath}
                onOpen={row.openPath ? openFile : null}
                dataState={isExpanded ? "open" : "closed"}
                className="max-w-full cursor-interaction truncate text-start text-token-text-link-foreground select-text hover:underline"
              />
            ) : null}
            {showInlineStats ? (
              row.summary ? (
                <DiffStats
                  additions={row.summary.additions}
                  deletions={row.summary.deletions}
                  showZero={row.action === "delete"}
                />
              ) : null
            ) : null}
            {showCollapsedIndicator ? (
              <DiffSummaryIndicator action={row.action} summary={row.summary} />
            ) : null}
            {hasApprovalReviews ? (
              <AutomaticApprovalReviewShield />
            ) : null}
            <Chevron expanded={isExpanded} />
          </div>
          <div className="ml-1 flex items-center gap-1 transition-opacity duration-200" />
        </div>
        {row.state === "streaming" ? (
          isExpanded ? (
            <div data-file-change-row-body="">
              {body}
            </div>
          ) : null
        ) : (
          <motion.div
            data-file-change-row-body=""
            className={cn(isExpanded ? "overflow-visible" : "overflow-hidden")}
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
            {isExpanded ? body : null}
          </motion.div>
        )}
      </div>
    </div>
  );
}

export function FileChangeToolCall({
  item,
  projectWorkspacePath,
  threadCwd,
  isTurnCancelled = false,
  automaticApprovalReviews = [],
}: FileChangeToolCallProps) {
  const { resolved } = useTheme();
  const { opener } = useFileLinkOpener();
  const rows = useMemo(() => buildFileChangeRows(
    item,
    threadCwd,
    projectWorkspacePath,
    isTurnCancelled,
    automaticApprovalReviews,
  ), [
    automaticApprovalReviews,
    isTurnCancelled,
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
};
