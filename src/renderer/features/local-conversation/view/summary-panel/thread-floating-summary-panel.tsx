import { GitPullRequest, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BranchStatusIcon, ChevronRightIcon, LocalStatusIcon } from "@/components/shared/icons";
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
import { cn } from "../../../../lib/utils";
import type {
  CodexAccountSnapshot,
  CodexConnectionState,
  CodexConversationTurn,
  GitReviewSnapshot,
  GitReviewSource,
} from "../../../../lib/types";
import type { ThreadStageActions, ThreadStageRouteInput } from "../../thread-stage-types";
import { ThreadSummaryPanelRateLimitRow } from "./thread-summary-panel-rate-limit-row";
import { ThreadSummaryPanelRow } from "./thread-summary-panel-row";
import { ThreadSummaryPanelSection } from "./thread-summary-panel-section";

interface ThreadFloatingSummaryPanelProps {
  mounted: boolean;
  open: boolean;
  activeThreadId: string | null;
  cwd: string | null;
  projectWorkspacePath: string | null;
  account: CodexAccountSnapshot | null;
  connection: CodexConnectionState;
  turns: readonly CodexConversationTurn[];
  actions: ThreadStageActions;
  newThreadStartInSelector?: ThreadStageRouteInput["newThreadStartInSelector"];
  onErrorMessage: (message: string | null) => void;
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
  onErrorMessage,
}: {
  cwd: string | null;
  onErrorMessage: (message: string | null) => void;
}) {
  const [branchState, setBranchState] = useState<BranchSelectorState>(EMPTY_BRANCH_SELECTOR_STATE);
  const [busy, setBusy] = useState(false);
  const branchCwdRef = useRef<string | null>(cwd);
  const mutationRequestIdRef = useRef(0);
  branchCwdRef.current = cwd;

  const refreshBranchState = useCallback(async () => {
    const requestedCwd = branchCwdRef.current;
    if (!requestedCwd) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return;
    }

    try {
      const result = await invoke("git:branch:state", requestedCwd);
      if (branchCwdRef.current !== requestedCwd) return;
      setBranchState(parseBranchSelectorState(result));
    } catch {
      if (branchCwdRef.current !== requestedCwd) return;
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
    }
  }, []);

  useEffect(() => {
    if (!cwd) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return;
    }

    void refreshBranchState();
  }, [cwd, refreshBranchState]);

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

function SummaryPanelSurface({
  activeThreadId,
  cwd,
  projectWorkspacePath,
  account,
  connection,
  turns,
  actions,
  newThreadStartInSelector,
  onErrorMessage,
}: Omit<ThreadFloatingSummaryPanelProps, "mounted" | "open">) {
  const branchCwd = useMemo(
    () => resolveBranchSelectorCwd(cwd, projectWorkspacePath),
    [cwd, projectWorkspacePath],
  );
  const gitSummary = useGitSummary(branchCwd, true);
  const branch = useSummaryPanelBranchState({ cwd: branchCwd, onErrorMessage });
  const sourceNames = useMemo(() => collectMcpSourceNames(turns), [turns]);
  const panelOpenRefreshStartedRef = useRef(false);
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

  useEffect(() => {
    if (panelOpenRefreshStartedRef.current || !account?.account) return;

    panelOpenRefreshStartedRef.current = true;
    void actions.onRefreshAccount().catch(() => {});
  }, [account?.account, actions]);

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
            disabled={!branchCwd || branch.busy}
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

        <ThreadSummaryPanelSection title="Account">
          <ThreadSummaryPanelRateLimitRow
            account={account}
            connection={connection}
            actions={actions}
            onErrorMessage={onErrorMessage}
          />
        </ThreadSummaryPanelSection>

        {sourceNames.length > 0 ? (
          <ThreadSummaryPanelSection title="Sources">
            <div className="flex flex-wrap gap-1.5 py-0.5" aria-label="Sources">
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
          </ThreadSummaryPanelSection>
        ) : null}

        {!activeThreadId ? (
          <div className="px-4 text-size-chat text-token-text-tertiary">
            Start a thread to populate live summary rows.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadFloatingSummaryPanel({
  mounted,
  open,
  ...props
}: ThreadFloatingSummaryPanelProps) {
  if (!mounted) return null;

  return (
    <div
      className="pointer-events-none absolute top-(--thread-floating-content-top-inset) right-0 bottom-(--thread-floating-content-bottom-inset) z-40"
      data-thread-summary-panel-mode="pinned"
      data-thread-summary-panel-open={String(open)}
    >
      <div className="relative flex max-h-full">
        <div
          className="pointer-events-none max-h-full min-h-0 origin-top-right pe-4"
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "none" : "translateX(100%) scale(0.8)",
          }}
        >
          <div
            className={cn(
              "flex max-h-full flex-col",
              open ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{ width: 300 }}
          >
            {open ? <SummaryPanelSurface {...props} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
