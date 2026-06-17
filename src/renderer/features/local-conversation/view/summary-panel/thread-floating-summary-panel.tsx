import { GitPullRequest, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BranchStatusIcon, ChevronRightIcon, LocalStatusIcon } from "@/components/shared/icons";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import { BranchSelectorPopover } from "../shared/branch-selector-popover";
import {
  EMPTY_BRANCH_SELECTOR_STATE,
  isBranchSelectorMutationCurrent,
  parseBranchSelectorState,
  resolveBranchSelectorCwd,
  type BranchSelectorState,
} from "../shared/branch-selector-state";
import { DiffStats } from "../shared/tools/diff-file-shared";
import { invoke } from "../../../../lib/api";
import {
  CODEX_SUMMARY_PANEL_TRANSITION,
  CODEX_SUMMARY_PANEL_WIDTH,
} from "../../../../lib/codex-panel-motion";
import { useGitBranchState } from "../../../../lib/use-git-branch-state";
import { cn } from "../../../../lib/utils";
import type {
  CodexBackgroundTerminalRow,
  CodexConversationTurn,
  GitReviewSnapshot,
  GitReviewSource,
} from "../../../../lib/types";
import type { ThreadStageRouteInput, ThreadSummaryPanelAuxiliaryRow } from "../../thread-stage-types";
import { ThreadSummaryPanelRow } from "./thread-summary-panel-row";
import { ThreadSummaryPanelSection } from "./thread-summary-panel-section";
import { ThreadSummaryPanelToggleButton } from "./thread-summary-panel-toggle";

export interface ThreadSummaryPanelContentProps {
  activeThreadId: string | null;
  cwd: string | null;
  projectWorkspacePath: string | null;
  turns: readonly CodexConversationTurn[];
  backgroundTerminalRows?: readonly CodexBackgroundTerminalRow[];
  sideChatRows?: readonly ThreadSummaryPanelAuxiliaryRow[];
  browserRows?: readonly ThreadSummaryPanelAuxiliaryRow[];
  isVisible?: boolean;
  newThreadStartInSelector?: ThreadStageRouteInput["newThreadStartInSelector"];
  onErrorMessage: (message: string | null) => void;
}

interface ThreadFloatingSummaryPanelProps extends ThreadSummaryPanelContentProps {
  hideImmediately?: boolean;
  mounted: boolean;
  open: boolean;
}

interface GitSummaryState {
  loading: boolean;
  cwd: string | null;
  snapshots: Partial<Record<GitReviewSource, GitReviewSnapshot>>;
}

const EMPTY_GIT_SUMMARY: GitSummaryState = {
  loading: false,
  cwd: null,
  snapshots: {},
};

function sumSnapshotFiles(snapshot: GitReviewSnapshot | undefined): { additions: number; deletions: number } {
  if (!snapshot?.isGitRepository) return { additions: 0, deletions: 0 };

  return snapshot.files.reduce(
    (summary, file) => ({
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function resolvePrimaryGitSource(snapshots: Partial<Record<GitReviewSource, GitReviewSnapshot>>): GitReviewSource {
  const staged = sumSnapshotFiles(snapshots.staged);
  if (staged.additions > 0 || staged.deletions > 0) return "staged";

  const unstaged = sumSnapshotFiles(snapshots.unstaged);
  if (unstaged.additions > 0 || unstaged.deletions > 0) return "unstaged";

  return "branch";
}

function formatSourceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "context7") return "Context7";
  return trimmed;
}

function collectMcpSourceNames(turns: readonly CodexConversationTurn[]): string[] {
  const names = new Map<string, string>();
  for (const turn of turns) {
    for (const item of turn.items) {
      const sourceName = formatSourceName(item.mcpToolCall?.invocation.server ?? item.toolCall?.server ?? "");
      if (!sourceName) continue;
      const key = sourceName.toLowerCase();
      if (!names.has(key)) names.set(key, sourceName);
    }
  }

  return Array.from(names.values()).slice(0, 8);
}

function collectWebSearchCount(turns: readonly CodexConversationTurn[]): number {
  return turns.reduce(
    (count, turn) => count + turn.items.filter((item) => item.type === "webSearch").length,
    0,
  );
}

function collectProgressRows(turns: readonly CodexConversationTurn[]): string[] {
  const latestProgressItem = [...turns]
    .reverse()
    .flatMap((turn) => [...turn.items].reverse())
    .find((item) => item.semanticKind === "todoList" || item.semanticKind === "proposedPlan");
  const markdownText = latestProgressItem?.markdownText?.trim();
  if (!markdownText) return [];

  return markdownText
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[-*]\s+(?:\[[ xX]\]\s*)?/u, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function collectOutputRows(turns: readonly CodexConversationTurn[]): string[] {
  const paths = new Map<string, string>();
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.fileChange) {
        for (const path of item.fileChange.paths) {
          paths.set(path, path);
        }
      }
      if (item.type !== "imageGeneration" && item.type !== "imageView") continue;
      const rawItem = item.rawItem as { savedPath?: string; path?: string } | undefined;
      const path = rawItem?.savedPath ?? rawItem?.path;
      if (path) paths.set(path, path);
    }
  }
  return Array.from(paths.values()).slice(0, 5);
}

function collectBackgroundSubagentRows(turns: readonly CodexConversationTurn[]): string[] {
  const labels: string[] = [];
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "collabAgentToolCall") continue;
      const rawItem = item.rawItem as { receiverThreadIds?: string[]; tool?: string } | undefined;
      const receiverCount = rawItem?.receiverThreadIds?.length ?? 0;
      labels.push(receiverCount > 1 ? `${receiverCount} subagents` : rawItem?.tool ?? "Subagent");
    }
  }
  return labels.slice(0, 4);
}

function SummaryCountBadge({ count }: { count: number }) {
  return (
    <span className="ms-auto text-size-chat text-token-text-tertiary">
      {count}
    </span>
  );
}

function useGitSummary(cwd: string | null, open: boolean): GitSummaryState {
  const [state, setState] = useState<GitSummaryState>(EMPTY_GIT_SUMMARY);

  useEffect(() => {
    if (!open || !cwd) {
      setState(EMPTY_GIT_SUMMARY);
      return;
    }

    let cancelled = false;
    setState({ loading: true, cwd, snapshots: {} });
    const sources: GitReviewSource[] = ["unstaged", "staged", "branch"];

    void Promise.all(
      sources.map(async (source) => {
        try {
          return [source, await invoke("git:review:snapshot", { cwd, source })] as const;
        } catch {
          return [source, null] as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const snapshots: Partial<Record<GitReviewSource, GitReviewSnapshot>> = {};
      for (const [source, snapshot] of results) {
        if (snapshot) snapshots[source] = snapshot as GitReviewSnapshot;
      }
      setState({ loading: false, cwd, snapshots });
    });

    return () => {
      cancelled = true;
    };
  }, [cwd, open]);

  return state;
}

function useSummaryPanelBranchState({
  cwd,
  enabled,
  onErrorMessage,
}: {
  cwd: string | null;
  enabled: boolean;
  onErrorMessage: (message: string | null) => void;
}) {
  const [branchState, setBranchState] = useState<BranchSelectorState>(EMPTY_BRANCH_SELECTOR_STATE);
  const [busy, setBusy] = useState(false);
  const branchCwdRef = useRef<string | null>(cwd);
  const mutationRequestIdRef = useRef(0);
  const { data: branchStateData, refetch: refetchBranchState } = useGitBranchState(cwd, {
    enabled,
  });
  branchCwdRef.current = cwd;

  const refreshBranchState = useCallback(async () => {
    if (!enabled) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return;
    }
    const requestedCwd = branchCwdRef.current;
    if (!requestedCwd) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return;
    }

    try {
      const result = await refetchBranchState();
      if (branchCwdRef.current !== requestedCwd) return;
      setBranchState(result.data ? parseBranchSelectorState(result.data) : EMPTY_BRANCH_SELECTOR_STATE);
    } catch {
      if (branchCwdRef.current !== requestedCwd) return;
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
    }
  }, [enabled, refetchBranchState]);

  useEffect(() => {
    if (!enabled || !cwd) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return;
    }

    if (!branchStateData) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return;
    }

    setBranchState(parseBranchSelectorState(branchStateData));
  }, [branchStateData, cwd, enabled]);

  const checkoutBranch = useCallback(async (branch: string) => {
    const requestedCwd = cwd;
    if (!requestedCwd) return false;
    const requestId = mutationRequestIdRef.current + 1;
    mutationRequestIdRef.current = requestId;
    const isCurrentRequest = () => isBranchSelectorMutationCurrent({
      activeRequestId: mutationRequestIdRef.current,
      requestId,
      activeCwd: branchCwdRef.current,
      requestedCwd,
    });

    setBusy(true);
    onErrorMessage(null);
    try {
      const result = await invoke("git:branch:checkout", { cwd: requestedCwd, branch });
      if (!isCurrentRequest()) return false;
      setBranchState(parseBranchSelectorState(result));
      return true;
    } catch (error) {
      if (isCurrentRequest()) {
        onErrorMessage(error instanceof Error ? error.message : "Could not switch branches");
      }
      return false;
    } finally {
      if (isCurrentRequest()) setBusy(false);
    }
  }, [cwd, onErrorMessage]);

  const createBranch = useCallback(async (branch: string) => {
    const requestedCwd = cwd;
    if (!requestedCwd) return false;
    const requestId = mutationRequestIdRef.current + 1;
    mutationRequestIdRef.current = requestId;
    const isCurrentRequest = () => isBranchSelectorMutationCurrent({
      activeRequestId: mutationRequestIdRef.current,
      requestId,
      activeCwd: branchCwdRef.current,
      requestedCwd,
    });

    setBusy(true);
    onErrorMessage(null);
    try {
      const result = await invoke("git:branch:create", { cwd: requestedCwd, branch });
      if (!isCurrentRequest()) return false;
      setBranchState(parseBranchSelectorState(result));
      return true;
    } catch (error) {
      if (isCurrentRequest()) {
        onErrorMessage(error instanceof Error ? error.message : "Could not create branch");
      }
      return false;
    } finally {
      if (isCurrentRequest()) setBusy(false);
    }
  }, [cwd, onErrorMessage]);

  return {
    branchState,
    busy,
    refreshBranchState,
    checkoutBranch,
    createBranch,
  };
}

export function ThreadSummaryPanelSurface({
  activeThreadId,
  cwd,
  projectWorkspacePath,
  turns,
  backgroundTerminalRows = [],
  sideChatRows = [],
  browserRows = [],
  isVisible = true,
  newThreadStartInSelector,
  onErrorMessage,
}: Omit<ThreadFloatingSummaryPanelProps, "mounted" | "open">) {
  const branchCwd = useMemo(
    () => resolveBranchSelectorCwd(cwd, projectWorkspacePath),
    [cwd, projectWorkspacePath],
  );
  const gitSummary = useGitSummary(branchCwd, isVisible);
  const branch = useSummaryPanelBranchState({ cwd: branchCwd, enabled: isVisible, onErrorMessage });
  const sourceNames = useMemo(() => collectMcpSourceNames(turns), [turns]);
  const webSearchCount = useMemo(() => collectWebSearchCount(turns), [turns]);
  const progressRows = useMemo(() => collectProgressRows(turns), [turns]);
  const outputRows = useMemo(() => collectOutputRows(turns), [turns]);
  const backgroundSubagentRows = useMemo(() => collectBackgroundSubagentRows(turns), [turns]);
  const snapshots = gitSummary.snapshots;
  const unstaged = sumSnapshotFiles(snapshots.unstaged);
  const staged = sumSnapshotFiles(snapshots.staged);
  const branchDiff = sumSnapshotFiles(snapshots.branch);
  const changes = {
    additions: unstaged.additions + staged.additions + branchDiff.additions,
    deletions: unstaged.deletions + staged.deletions + branchDiff.deletions,
  };
  const hasRepository = Object.values(snapshots).some((snapshot) => snapshot?.isGitRepository);
  const currentBranch = branch.branchState.currentBranch ?? snapshots.branch?.currentBranch ?? null;
  const primaryGitSource = resolvePrimaryGitSource(snapshots);
  const runTargetLabel = newThreadStartInSelector?.target.runInTarget === "newWorktree" ? "New worktree" : "Local";

  const handleOpenGitReview = useCallback((source: GitReviewSource) => {
    if (!hasRepository) return;
    onErrorMessage(`Open the Diff stage to review ${source} changes.`);
  }, [hasRepository, onErrorMessage]);

  return (
    <div
      data-testid="thread-summary-panel"
      className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-token-border-default bg-token-dropdown-background pt-3 shadow-md select-none"
    >
      <div className="flex h-fit max-h-full min-h-0 flex-col gap-3 overflow-y-auto pb-3">
        <ThreadSummaryPanelSection title="Environment">
          <ThreadSummaryPanelRow
            label="Changes"
            interactive={hasRepository}
            disabled={!hasRepository || gitSummary.loading}
            onClick={() => handleOpenGitReview(primaryGitSource)}
            trailing={(
              changes.additions > 0 || changes.deletions > 0 ? (
                <DiffStats
                  additions={changes.additions}
                  deletions={changes.deletions}
                  className="text-size-chat"
                />
              ) : (
                <span className="text-size-chat text-token-text-tertiary">
                  {gitSummary.loading ? "Loading" : "Clean"}
                </span>
              )
            )}
            trailingVisible
          />
          <ThreadSummaryPanelRow
            label={runTargetLabel}
            icon={<LocalStatusIcon />}
            trailing={<ChevronRightIcon className="size-3 text-token-text-tertiary" />}
            trailingVisible
            interactive={Boolean(newThreadStartInSelector)}
            onClick={() => {
              if (!newThreadStartInSelector) return;
              onErrorMessage("Use the composer Start in selector to change the run target.");
            }}
          />
          <ThreadSummaryPanelRow
            label={currentBranch ?? "No branch"}
            icon={<BranchStatusIcon />}
            disabled={!isVisible || !branchCwd || branch.busy}
            accessory={(
              <BranchSelectorPopover
                cwd={branchCwd}
                state={branch.branchState}
                busy={branch.busy}
                onRefresh={branch.refreshBranchState}
                onCheckout={branch.checkoutBranch}
                onCreate={branch.createBranch}
                triggerClassName="h-6 max-w-36 text-token-text-tertiary hover:text-token-foreground"
              />
            )}
          />
          <ThreadSummaryPanelRow
            label="Commit or push"
            icon={<UploadCloud className="size-3.5" />}
            interactive={hasRepository}
            disabled={!hasRepository}
            onClick={() => handleOpenGitReview(staged.additions > 0 || staged.deletions > 0 ? "staged" : "unstaged")}
          />
          <ThreadSummaryPanelRow
            label="Create pull request"
            icon={<GitPullRequest className="size-3.5" />}
            interactive={hasRepository && Boolean(currentBranch)}
            disabled={!hasRepository || !currentBranch}
            onClick={() => handleOpenGitReview("branch")}
          />
        </ThreadSummaryPanelSection>

        {progressRows.length > 0 ? (
          <ThreadSummaryPanelSection title="Progress" actions={<SummaryCountBadge count={progressRows.length} />}>
            {progressRows.map((row) => (
              <ThreadSummaryPanelRow key={row} label={row} />
            ))}
          </ThreadSummaryPanelSection>
        ) : null}

        {outputRows.length > 0 ? (
          <ThreadSummaryPanelSection title="Outputs" actions={<SummaryCountBadge count={outputRows.length} />}>
            {outputRows.map((path) => (
              <ThreadSummaryPanelRow
                key={path}
                label={path.split("/").at(-1) ?? path}
                title={path}
              />
            ))}
          </ThreadSummaryPanelSection>
        ) : null}

        {sideChatRows.length > 0 ? (
          <ThreadSummaryPanelSection title="Side chats" actions={<SummaryCountBadge count={sideChatRows.length} />}>
            {sideChatRows.slice(0, 4).map((row) => (
              <ThreadSummaryPanelRow
                key={row.id}
                label={row.title}
                title={row.title}
                trailing={row.status ? (
                  <span className="block max-w-24 truncate text-size-chat text-token-text-tertiary">
                    {row.status}
                  </span>
                ) : null}
                trailingVisible={Boolean(row.status)}
              />
            ))}
          </ThreadSummaryPanelSection>
        ) : null}

        {backgroundSubagentRows.length > 0 ? (
          <ThreadSummaryPanelSection title="Background subagents" actions={<SummaryCountBadge count={backgroundSubagentRows.length} />}>
            {backgroundSubagentRows.map((row, index) => (
              <ThreadSummaryPanelRow key={`${row}:${index}`} label={row} />
            ))}
          </ThreadSummaryPanelSection>
        ) : null}

        {backgroundTerminalRows.length > 0 ? (
          <ThreadSummaryPanelSection title="Background tasks" actions={<SummaryCountBadge count={backgroundTerminalRows.length} />}>
            {backgroundTerminalRows.slice(0, 4).map((row) => (
              <ThreadSummaryPanelRow
                key={row.id}
                label={row.command}
                title={row.command}
                trailing={row.previewLine ? (
                  <span className="block max-w-24 truncate text-size-chat text-token-text-tertiary">
                    {row.previewLine}
                  </span>
                ) : null}
                trailingVisible={Boolean(row.previewLine)}
              />
            ))}
          </ThreadSummaryPanelSection>
        ) : null}

        {browserRows.length > 0 ? (
          <ThreadSummaryPanelSection title="Browser" actions={<SummaryCountBadge count={browserRows.length} />}>
            {browserRows.slice(0, 4).map((row) => (
              <ThreadSummaryPanelRow
                key={row.id}
                label={row.title}
                title={row.title}
                trailing={row.status ? (
                  <span className="block max-w-24 truncate text-size-chat text-token-text-tertiary">
                    {row.status}
                  </span>
                ) : null}
                trailingVisible={Boolean(row.status)}
              />
            ))}
          </ThreadSummaryPanelSection>
        ) : null}

        <ThreadSummaryPanelSection
          title="Sources"
          actions={<SummaryCountBadge count={sourceNames.length + (webSearchCount > 0 ? 1 : 0)} />}
        >
          {sourceNames.length > 0 || webSearchCount > 0 ? (
            <div className="flex flex-wrap gap-1.5 py-0.5" aria-label="Sources">
              {webSearchCount > 0 ? (
                <span
                  title="Web search"
                  className="inline-flex h-6 max-w-full items-center gap-1 rounded-lg bg-token-foreground/5 px-2 text-size-chat text-token-foreground"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-token-text-link-foreground" aria-hidden="true" />
                  <span className="truncate">Web search</span>
                </span>
              ) : null}
              {sourceNames.map((sourceName) => (
                <span
                  key={sourceName}
                  title={sourceName}
                  className="inline-flex h-6 max-w-full items-center gap-1 rounded-lg bg-token-foreground/5 px-2 text-size-chat text-token-foreground"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-token-text-link-foreground" aria-hidden="true" />
                  <span className="truncate">{sourceName}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="py-0.5 text-size-chat text-token-text-tertiary">No sources yet</div>
          )}
        </ThreadSummaryPanelSection>

        {!activeThreadId ? (
          <div className="px-4 text-size-chat text-token-text-tertiary">
            Start a thread to populate live summary rows.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadSummaryPanelPopover({
  onOpenChange,
  open: controlledOpen,
  ...props
}: ThreadSummaryPanelContentProps & {
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (controlledOpen == null) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }, [controlledOpen, onOpenChange]);

  return (
    <NodexPopover open={open} onOpenChange={handleOpenChange}>
      <NodexPopoverTrigger asChild>
        <ThreadSummaryPanelToggleButton
          label="Toggle summary"
          pressed={open}
        />
      </NodexPopoverTrigger>
      <NodexPopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="!w-auto !overflow-visible !rounded-3xl !bg-transparent !p-0 !shadow-none !ring-0 !backdrop-blur-none"
        style={{
          maxHeight: "none",
          maxWidth: "none",
        }}
      >
        <div
          data-thread-summary-panel-mode="popover"
          className="flex max-h-[min(var(--radix-popover-content-available-height),calc(100vh-16px))] flex-col"
          style={{ width: CODEX_SUMMARY_PANEL_WIDTH }}
        >
          <ThreadSummaryPanelSurface {...props} isVisible />
        </div>
      </NodexPopoverContent>
    </NodexPopover>
  );
}

export function ThreadFloatingSummaryPanel({
  hideImmediately = false,
  mounted,
  open,
  ...props
}: ThreadFloatingSummaryPanelProps) {
  const reducedMotion = useReducedMotion();
  if (!mounted) return null;

  return (
    <div
      className="pointer-events-none absolute top-(--thread-floating-content-top-inset) right-0 bottom-(--thread-floating-content-bottom-inset) z-40"
      data-thread-summary-panel-hide-immediately={String(hideImmediately)}
      data-thread-summary-panel-mode="pinned"
      data-thread-summary-panel-open={String(open)}
    >
      <div className="relative flex max-h-full">
        <motion.div
          className={cn(
            "pointer-events-none max-h-full min-h-0 origin-top-right pe-4",
            hideImmediately && "invisible",
          )}
          initial={false}
          animate={{
            opacity: open ? 1 : 0,
            translateX: open ? 0 : "100%",
            scale: open ? 1 : 0.8,
          }}
          transition={hideImmediately || reducedMotion ? { duration: 0 } : CODEX_SUMMARY_PANEL_TRANSITION}
        >
          <div
            className={cn(
              "flex max-h-full flex-col",
              open ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{ width: CODEX_SUMMARY_PANEL_WIDTH }}
          >
            <ThreadSummaryPanelSurface {...props} isVisible={open} />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
