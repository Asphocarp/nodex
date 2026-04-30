import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, LocalStatusIcon } from "@/components/shared/icons";
import { cn } from "../../../../lib/utils";
import type { ThreadFooterModel } from "../../thread-stage-types";
import {
  EMPTY_BRANCH_SELECTOR_STATE,
  isBranchSelectorMutationCurrent,
  parseBranchSelectorState,
  resolveBranchSelectorCwd,
  type BranchSelectorState,
} from "../shared/branch-selector-state";
import {
  BranchSelectorPopover,
  invoke,
  subscribeGitBranchChanges,
} from "./local-conversation-thread-composer-deps";

interface ThreadComposerStatusStripProps {
  model: ThreadFooterModel;
  onErrorMessage: (message: string | null) => void;
  className?: string;
}

export function ThreadComposerStatusStrip({
  model,
  onErrorMessage,
  className,
}: ThreadComposerStatusStripProps) {
  const [branchState, setBranchState] = useState<BranchSelectorState>(EMPTY_BRANCH_SELECTOR_STATE);
  const [isBranchBusy, setIsBranchBusy] = useState(false);
  const branchCwd = useMemo(
    () => resolveBranchSelectorCwd(model.conversation?.cwd, model.projectWorkspacePath),
    [model.conversation?.cwd, model.projectWorkspacePath],
  );
  const branchCwdRef = useRef<string | null>(branchCwd);
  const branchMutationRequestIdRef = useRef(0);
  branchCwdRef.current = branchCwd;

  const handleRefreshBranchState = useCallback(async () => {
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
    let cancelled = false;
    branchMutationRequestIdRef.current += 1;
    setIsBranchBusy(false);

    if (!branchCwd) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return () => {
        cancelled = true;
      };
    }

    void invoke("git:branch:state", branchCwd)
      .then((result) => {
        if (cancelled || branchCwdRef.current !== branchCwd) return;
        setBranchState(parseBranchSelectorState(result));
      })
      .catch(() => {
        if (cancelled || branchCwdRef.current !== branchCwd) return;
        setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      });

    return () => {
      cancelled = true;
    };
  }, [branchCwd]);

  useEffect(() => {
    if (!branchCwd) {
      void invoke("git:branch:watch:stop").catch(() => { });
      return;
    }

    void invoke("git:branch:watch:start", branchCwd).catch(() => { });
    const unsubscribe = subscribeGitBranchChanges((event) => {
      if (event.cwd !== branchCwdRef.current) return;
      void handleRefreshBranchState();
    });

    return () => {
      unsubscribe();
      void invoke("git:branch:watch:stop").catch(() => { });
    };
  }, [branchCwd, handleRefreshBranchState]);

  const handleCheckoutBranch = useCallback(async (branch: string) => {
    const requestedCwd = branchCwd;
    if (!requestedCwd) return false;
    const requestId = branchMutationRequestIdRef.current + 1;
    branchMutationRequestIdRef.current = requestId;
    const isCurrentRequest = () => isBranchSelectorMutationCurrent({
      activeRequestId: branchMutationRequestIdRef.current,
      requestId,
      activeCwd: branchCwdRef.current,
      requestedCwd,
    });

    setIsBranchBusy(true);
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
      if (isCurrentRequest()) setIsBranchBusy(false);
    }
  }, [branchCwd, onErrorMessage]);

  const handleCreateBranch = useCallback(async (branch: string) => {
    const requestedCwd = branchCwd;
    if (!requestedCwd) return false;
    const requestId = branchMutationRequestIdRef.current + 1;
    branchMutationRequestIdRef.current = requestId;
    const isCurrentRequest = () => isBranchSelectorMutationCurrent({
      activeRequestId: branchMutationRequestIdRef.current,
      requestId,
      activeCwd: branchCwdRef.current,
      requestedCwd,
    });

    setIsBranchBusy(true);
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
      if (isCurrentRequest()) setIsBranchBusy(false);
    }
  }, [branchCwd, onErrorMessage]);

  return (
    <div
      data-composer-lower-status-row="true"
      className={cn("flex flex-wrap items-center gap-2 overflow-visible px-2 py-1.5", className)}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-full border border-transparent px-1.5 text-sm/4.5 text-(--foreground-tertiary) hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
          aria-label="Run target"
        >
          <LocalStatusIcon className="shrink-0" />
          <span className="max-w-40 truncate text-sm">Work locally</span>
          <ChevronDownIcon />
        </button>
        <BranchSelectorPopover
          cwd={branchCwd}
          state={branchState}
          busy={isBranchBusy}
          onRefresh={handleRefreshBranchState}
          onCheckout={handleCheckoutBranch}
          onCreate={handleCreateBranch}
        />
      </div>
    </div>
  );
}
