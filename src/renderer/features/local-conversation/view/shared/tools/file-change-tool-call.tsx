import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { motion } from "motion/react";
import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { reviewDiffPreferencesAtom } from "@/features/review/model/review-view-state";
import { useScopedAtomValue } from "@/lib/maitai";
import type { CodexVisualizationActivity } from "../../../../../../shared/types";
import {
  buildCodexFileChangePatchRows,
  canParseCodexFileChangeInline,
  resolveCodexFileChangeDisplayStatus,
  type CodexFileChangePatchAction,
  type CodexFileChangePatchRow,
  type CodexFileChangeDisplayStatus,
  type CodexUnifiedDiffSummary,
} from "../../../../../../shared/codex-file-change";
import { buildTextPreview, INLINE_TEXT_PREVIEW_MAX_CHARS } from "../../../../../lib/text-preview";
import { invoke } from "../../../../../lib/api";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "../../../../../lib/diff-presentation";
import { useFileLinkOpener } from "../../../../../lib/use-file-link-opener";
import { useTheme } from "../../../../../lib/use-theme";
import type { CodexFileChange, CodexTranscriptEntry } from "../../../../../lib/types";
import type { ThreadStageActions } from "../../../thread-stage-types";
import { cn } from "../../../../../lib/utils";
import { NodexTooltip } from "../../../../../components/ui/tooltip";
import { AutomaticApprovalReviewRows, AutomaticApprovalReviewShield } from "../automatic-approval-review-surface";
import { CodexShimmerText } from "../codex-shimmer-text";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../thread-motion";
import { useMeasuredElementHeight } from "../use-measured-element-height";
import { CopyMessageActionButton } from "../thread-message-actions";
import { CodeBlock, ThreadRichActivityHeader } from "./tool-primitives";
import {
  basename,
  Chevron,
  DiffStats,
  FilenameButton,
  resolveOpenPath,
} from "./diff-file-shared";
import { InlineFileDiff } from "./inline-file-diff";
import { semanticToolIcon, ToolActivityIcon } from "./tool-call-icons";

interface FileChangeToolCallProps {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
  isTurnCancelled?: boolean;
  automaticApprovalReviews?: CodexTranscriptEntry[];
  showDiffDetails?: boolean;
  showToolSummaryIcon?: boolean;
  onOpenFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
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
  workspaceRoot: string | null;
  action: FileChangeRowAction;
  state: FileChangeRowState;
  label: string;
  showActionLabel: boolean;
  expandedLabel: string | null;
  summary: CodexUnifiedDiffSummary | null;
  openLine?: number;
  canExpand: boolean;
  preview: FileChangeRowPreview;
  change: CodexFileChange;
  automaticApprovalReviews: CodexTranscriptEntry[];
}

function resolveFileChangeStatus(
  item: CodexTranscriptEntry,
  isTurnCancelled: boolean,
): CodexFileChangeDisplayStatus {
  return resolveCodexFileChangeDisplayStatus({
    success: item.fileChange?.success,
    approvalRequestId: item.approvalRequestId,
    isTurnCancelled,
  });
}

function resolveVisualizationActivityKind(
  activities: readonly CodexVisualizationActivity[],
): "create" | "update" | null {
  if (activities.length === 0) return null;
  return activities.some((activity) => activity.kind === "create") ? "create" : "update";
}

function parseSingleFilePatch(patch: string | null): FileDiffMetadata | null {
  if (!patch) return null;
  if (!canParseCodexFileChangeInline(patch)) return null;

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
  grantRoot: string | null | undefined,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): string | null {
  if (typeof grantRoot === "string" && grantRoot.trim().length > 0) return grantRoot;
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
  showDiffDetails: boolean,
): FileChangeRowModel {
  const unifiedDiff = showDiffDetails ? patchRow.unifiedDiff : null;
  const fileDiff = parseSingleFilePatch(unifiedDiff);
  const state = resolveFileChangeStatus(item, isTurnCancelled);
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
    workspaceRoot: basePath,
    action: patchRow.action,
    state,
    label: labels.label,
    showActionLabel: labels.showActionLabel,
    expandedLabel: labels.expandedLabel,
    summary: showDiffDetails ? patchRow.summary : null,
    openLine: showDiffDetails ? patchRow.openLine : undefined,
    canExpand: showDiffDetails,
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
  showDiffDetails = true,
): FileChangeRowModel[] {
  const basePath = resolveChangeBasePath(item.grantRoot, threadCwd, projectWorkspacePath);
  return buildCodexFileChangePatchRows(item.fileChange?.changes).map((row) =>
    buildFileChangeRow(
      row,
      item,
      basePath,
      isTurnCancelled,
      automaticApprovalReviews,
      showDiffDetails,
    )
  );
}

function FileChangeCodePreview({ content }: { content: string }) {
  const preview = buildTextPreview(content, INLINE_TEXT_PREVIEW_MAX_CHARS);
  return (
    <CodeBlock className="vertical-scroll-fade-mask max-h-40 rounded-none border-0 bg-transparent px-2 py-2 text-size-chat [--edge-fade-distance:1rem]">
      {preview.text}
    </CodeBlock>
  );
}

function SemanticChangePreview({ row }: { row: FileChangeRowModel }) {
  if (row.change.type === "delete") {
    return (
      <div className="text-token-description-foreground/80 bg-token-editor-background flex w-full items-center justify-center px-2 pt-7 pb-8 text-size-chat">
        Contents deleted
      </div>
    );
  }

  if (row.change.type === "add") {
    return <FileChangeCodePreview content={row.change.content} />;
  }

  if (row.change.type === "update") {
    return <FileChangeCodePreview content={row.change.unifiedDiff} />;
  }

  return (
    <div className="text-token-description-foreground/80 bg-token-editor-background flex w-full items-center justify-center px-2 pt-7 pb-8 text-size-chat">
      No changes
    </div>
  );
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
    <SemanticChangePreview row={row} />
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

function VisualizationActivityStatus({
  kind,
  isInProgress,
}: {
  kind: "create" | "update";
  isInProgress: boolean;
}) {
  const verb = kind === "create"
    ? isInProgress ? "Creating" : "Created"
    : isInProgress ? "Updating" : "Updated";

  return (
    <div
      data-file-change-visualization-status=""
      className="text-size-chat text-token-description-foreground/80"
    >
      {isInProgress ? (
        <CodexShimmerText>{verb}</CodexShimmerText>
      ) : (
        <span className="text-token-conversation-summary-leading">{verb}</span>
      )}{" visualization"}
    </div>
  );
}

function PatchPathLink({
  displayPath,
  onOpen,
}: {
  displayPath: string;
  onOpen: (modifiedClick: boolean) => void;
}) {
  return (
    <NodexTooltip
      tooltipContent={<span className="font-mono">{displayPath}</span>}
      side="top"
      delayDuration={0}
      tooltipBodyClassName="font-mono text-xs leading-4"
    >
      <span
        data-agent-activity-file-link
        role="link"
        tabIndex={0}
        className="pointer-events-auto inline-block max-w-full cursor-interaction truncate align-bottom text-inherit underline decoration-dotted decoration-hairline underline-offset-2 group-hover/activity-header:!text-token-foreground hover:!text-token-foreground"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(event.metaKey || event.ctrlKey);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.stopPropagation();
          event.preventDefault();
          onOpen(false);
        }}
      >
        {basename(displayPath)}
      </span>
    </NodexTooltip>
  );
}

function FileChangeRow({
  row,
  diffHostClassName,
  diffHostStyle,
  diffOptions,
  openerId,
  onOpenFileInSidePanel,
  summaryIcon,
}: {
  row: FileChangeRowModel;
  diffHostClassName: string;
  diffHostStyle: CSSProperties;
  diffOptions: ReturnType<typeof getNodexDiffOptions>;
  openerId: string;
  onOpenFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  summaryIcon?: ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { elementHeightPx, elementRef } = useMeasuredElementHeight();

  function openExternalFile() {
    if (!row.openPath) return;
    void invoke("shell:open-file-link", {
      path: row.openPath,
      ...(row.openLine ? { line: row.openLine } : {}),
    }, openerId);
  }

  function openCollapsedFile(modifiedClick: boolean) {
    if (!row.openPath) return;
    if (!modifiedClick && onOpenFileInSidePanel) {
      void onOpenFileInSidePanel({
        path: row.openPath,
        title: basename(row.displayPath),
        workspaceRoot: row.workspaceRoot,
      });
      return;
    }
    openExternalFile();
  }

  const useExpandedSettledHeader = isExpanded && row.expandedLabel !== null;
  const summaryLabel = useExpandedSettledHeader && row.expandedLabel ? row.expandedLabel : row.label;
  const showInlineStats = !useExpandedSettledHeader
    && (row.action === "delete" ? row.summary != null : hasVisibleDiffSummary(row.summary));
  const actionLabel = row.showActionLabel ? (
    row.state === "streaming" ? (
      <CodexShimmerText className="text-token-description-foreground/80 select-text [@media(hover:hover)]:group-[:hover:not(:has([data-agent-activity-file-link]:hover))]/activity-header:text-token-foreground">
        {summaryLabel}
      </CodexShimmerText>
    ) : row.state === "stopped" ? (
      <span className="text-token-description-foreground/80 select-text [@media(hover:hover)]:group-[:hover:not(:has([data-agent-activity-file-link]:hover))]/activity-header:text-token-foreground">
        {summaryLabel}
      </span>
    ) : (
      <CodexShimmerText
        active={false}
        className="text-token-description-foreground/80 select-text [@media(hover:hover)]:group-[:hover:not(:has([data-agent-activity-file-link]:hover))]/activity-header:text-token-foreground"
      >
        {summaryLabel}
      </CodexShimmerText>
    )
  ) : null;
  const hasApprovalReviews = row.automaticApprovalReviews.length > 0;
  const bodyContent = (
    <div ref={row.state === "streaming" ? undefined : elementRef}>
      {hasApprovalReviews ? (
        <AutomaticApprovalReviewRows items={row.automaticApprovalReviews} />
      ) : null}
      <PatchFrame
        row={row}
        diffHostClassName={diffHostClassName}
        diffHostStyle={diffHostStyle}
        diffOptions={diffOptions}
        onOpenFile={row.openPath && row.openLine ? openExternalFile : null}
        isShortView={row.state === "pending"}
      />
    </div>
  );
  const summary = (
    <>
      {actionLabel}
      {!useExpandedSettledHeader ? (
        <>
          {row.state === "pending" ? null : " "}
          <PatchPathLink displayPath={row.displayPath} onOpen={openCollapsedFile} />
        </>
      ) : null}
    </>
  );
  const statsAccessory = showInlineStats && row.summary ? (
    <div className="flex items-center gap-1.5">
      <DiffStats
        additions={row.summary.additions}
        deletions={row.summary.deletions}
        showZero={row.action === "delete"}
        className="text-size-chat-sm"
      />
      <DiffSummaryIndicator action={row.action} summary={row.summary} />
    </div>
  ) : null;
  const accessory = (
    <>
      {statsAccessory}
      {hasApprovalReviews ? <AutomaticApprovalReviewShield /> : null}
    </>
  );
  const disclosure = row.canExpand
    ? {
        expanded: isExpanded,
        onToggle: () => {
          setIsExpanded((current) => !current);
        },
      }
    : undefined;
  const header = summaryIcon !== undefined ? (
    <ThreadRichActivityHeader
      accessibleLabel={`Toggle diff for ${basename(row.displayPath)}`}
      accessory={accessory}
      className="text-token-conversation-body"
      disclosure={disclosure}
      icon={summaryIcon}
      summary={summary}
      testId="file-change-row-header"
    />
  ) : (
    <div
      data-file-change-row-header=""
      className={cn(
        "group/activity-header flex items-center justify-between gap-1 text-ellipsis text-size-chat px-0 py-0",
        row.canExpand && "cursor-interaction",
      )}
      onClick={row.canExpand ? disclosure?.onToggle : undefined}
    >
      <div className="text-size-chat flex min-w-0 items-center gap-1 text-token-description-foreground/80">
        {summary}
        {accessory}
        {row.canExpand ? <Chevron expanded={isExpanded} /> : null}
      </div>
      <div className="ml-1 flex items-center gap-1 transition-opacity duration-basic" />
    </div>
  );
  const body = !row.canExpand ? null : row.state === "streaming" ? (
    isExpanded ? <div data-file-change-row-body="">{bodyContent}</div> : null
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
      style={{ pointerEvents: isExpanded ? "auto" : "none" }}
    >
      {isExpanded ? bodyContent : null}
    </motion.div>
  );
  const rowContent = (
    <div
      className={cn(
        summaryIcon === undefined ? "flex flex-col overflow-clip" : "overflow-clip",
        row.state === "pending" ? "rounded-xl" : "rounded-lg",
      )}
    >
      {header}
      {body}
    </div>
  );

  return summaryIcon === undefined ? <div className="px-0">{rowContent}</div> : rowContent;
}

export function FileChangeToolCall({
  item,
  projectWorkspacePath,
  threadCwd,
  isTurnCancelled = false,
  automaticApprovalReviews = [],
  showDiffDetails = true,
  showToolSummaryIcon = true,
  onOpenFileInSidePanel,
}: FileChangeToolCallProps) {
  const { resolved } = useTheme();
  const { wrap } = useScopedAtomValue(reviewDiffPreferencesAtom);
  const { opener } = useFileLinkOpener();
  const rows = useMemo(() => buildFileChangeRows(
    item,
    threadCwd,
    projectWorkspacePath,
    isTurnCancelled,
    automaticApprovalReviews,
    showDiffDetails,
  ), [
    automaticApprovalReviews,
    isTurnCancelled,
    item,
    projectWorkspacePath,
    showDiffDetails,
    threadCwd,
  ]);
  const diffOptions = useMemo(
    () => getNodexDiffOptions(resolved, true, { wrap }),
    [resolved, wrap],
  );
  const diffHostStyle = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);
  const diffHostClassName = `${NODEX_DIFF_HOST_CLASS} overflow-y-auto`;
  const state = resolveFileChangeStatus(item, isTurnCancelled);
  const visualizationKind = resolveVisualizationActivityKind(item.fileChange?.visualizationActivities ?? []);
  const showVisualization = visualizationKind !== null && state !== "stopped" && state !== "rejected";
  const summaryIcon = showToolSummaryIcon
    ? <ToolActivityIcon descriptor={semanticToolIcon("edit-files")} />
    : undefined;

  if (rows.length === 0 && !showVisualization) return null;

  const content = (
    <div className="flex flex-col gap-[var(--conversation-patch-file-gap,var(--conversation-item-gap,16px))]">
      {showVisualization && visualizationKind ? (
        <VisualizationActivityStatus
          kind={visualizationKind}
          isInProgress={state === "streaming" || state === "pending"}
        />
      ) : null}
      {rows.map((row) => (
        <FileChangeRow
          key={row.key}
          row={row}
          diffHostClassName={diffHostClassName}
          diffHostStyle={diffHostStyle}
          diffOptions={diffOptions}
          openerId={opener}
          onOpenFileInSidePanel={onOpenFileInSidePanel}
          summaryIcon={summaryIcon}
        />
      ))}
    </div>
  );

  return summaryIcon === undefined ? (
    <div className="min-w-0 text-size-chat relative overflow-visible py-0">
      {content}
    </div>
  ) : content;
}

export const fileChangeToolCallTestHelpers = {
  buildFileChangeRows,
  resolveOpenPath,
};
