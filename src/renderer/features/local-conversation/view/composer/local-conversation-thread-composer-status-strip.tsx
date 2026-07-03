import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, LocalStatusIcon } from "@/components/shared/icons";
import { cn } from "../../../../lib/utils";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import {
  EMPTY_BRANCH_SELECTOR_STATE,
  isBranchSelectorMutationCurrent,
  parseBranchSelectorState,
  resolveBranchSelectorCwd,
  type BranchSelectorState,
} from "../shared/branch-selector-state";
import {
  BranchSelectorPopover,
  EnvironmentSelectorPopover,
  invoke,
} from "./local-conversation-thread-composer-deps";
import { useGitBranchState } from "@/lib/use-git-branch-state";
import { NewChatProjectSelector } from "./new-chat-project-selector";
import { NewChatStartInSelector } from "./new-chat-start-in-selector";

interface ThreadComposerStatusStripProps {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
  projectSelectorDisabled?: boolean;
  className?: string;
}

const THREAD_COMPOSER_EXTERNAL_FOOTER_TRANSITION = {
  type: "spring",
  duration: 0.35,
  bounce: 0.1,
} as const;

interface ThreadComposerExternalFooterSlotProps {
  visible: boolean;
  children: ReactNode;
}

export function ThreadComposerExternalFooterSlot({
  visible,
  children,
}: ThreadComposerExternalFooterSlotProps) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {visible ? (
        <motion.div
          key="thread-composer-external-footer"
          data-composer-external-footer-slot="true"
          initial={{ y: "-100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%", pointerEvents: "none" }}
          transition={THREAD_COMPOSER_EXTERNAL_FOOTER_TRANSITION}
          className="relative z-0 -mt-2"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function ThreadComposerStatusStrip({
  model,
  actions,
  onErrorMessage,
  projectSelectorDisabled = false,
  className,
}: ThreadComposerStatusStripProps) {
  if (!shouldShowThreadComposerStatusStrip(model)) return null;

  return (
    <ThreadComposerStatusStripContent
      model={model}
      actions={actions}
      onErrorMessage={onErrorMessage}
      projectSelectorDisabled={projectSelectorDisabled}
      className={className}
    />
  );
}

export function shouldShowThreadComposerStatusStrip(model: ThreadFooterModel): boolean {
  return model.isNewThreadTab && model.conversation === null;
}

function ThreadComposerStatusStripContent({
  model,
  actions,
  onErrorMessage,
  projectSelectorDisabled = false,
  className,
}: ThreadComposerStatusStripProps) {
  const [branchState, setBranchState] = useState<BranchSelectorState>(EMPTY_BRANCH_SELECTOR_STATE);
  const [isBranchBusy, setIsBranchBusy] = useState(false);
  const branchCwd = useMemo(
    () => resolveBranchSelectorCwd(model.conversation?.cwd, model.projectWorkspacePath),
    [model.conversation?.cwd, model.projectWorkspacePath],
  );
  const { data: branchStateData, refetch: refetchBranchState } = useGitBranchState(branchCwd, {
    watch: true,
  });
  const branchCwdRef = useRef<string | null>(branchCwd);
  const branchMutationRequestIdRef = useRef(0);
  branchCwdRef.current = branchCwd;
  const showNewChatProjectSelector = Boolean(
    model.isNewThreadTab
    && model.conversation === null
    && model.newThreadTarget?.sessionId
    && !model.isCloudNewThreadTarget
    && model.newThreadProjectSelector,
  );
  const showNewChatStartInSelector = Boolean(
    model.isNewThreadTab
    && model.conversation === null
    && model.newThreadTarget?.sessionId
    && !model.isCloudNewThreadTarget
    && model.newThreadStartInSelector,
  );
  const worktreeAvailable = Boolean(
    branchCwd
    && (branchState.currentBranch || branchState.defaultBranch || branchState.branches.length > 0),
  );

  const handleRefreshBranchState = useCallback(async () => {
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
  }, [refetchBranchState]);

  useEffect(() => {
    branchMutationRequestIdRef.current += 1;
    setIsBranchBusy(false);

    if (!branchCwd) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
    }
  }, [branchCwd]);

  useEffect(() => {
    if (!branchCwd || !branchStateData) {
      setBranchState(EMPTY_BRANCH_SELECTOR_STATE);
      return;
    }

    setBranchState(parseBranchSelectorState(branchStateData));
  }, [branchCwd, branchStateData]);

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
      className={cn(
        "-mx-px -mt-4.5 flex flex-nowrap items-center gap-1 overflow-hidden rounded-b-2xl bg-token-side-bar-background px-2 pt-[25px] pb-2 select-none dark:bg-token-bg-fog",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
        {showNewChatProjectSelector && model.newThreadProjectSelector ? (
          <NewChatProjectSelector
            model={model.newThreadProjectSelector}
            actions={actions}
            disabled={projectSelectorDisabled}
          />
        ) : null}
        {showNewChatStartInSelector && model.newThreadStartInSelector ? (
          <NewChatStartInSelector
            model={model.newThreadStartInSelector}
            actions={actions}
            disabled={projectSelectorDisabled}
            worktreeAvailable={worktreeAvailable}
          />
        ) : (
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-transparent px-1.5 text-sm/4.5 text-(--foreground-tertiary) hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
            aria-label="Run target"
          >
            <LocalStatusIcon className="shrink-0" />
            <span className="max-w-40 truncate text-sm">Work locally</span>
            <ChevronDownIcon />
          </button>
        )}
        {showNewChatStartInSelector
          && model.newThreadStartInSelector
          && model.newThreadStartInSelector.target.runInTarget === "newWorktree" ? (
            <EnvironmentSelectorPopover
              options={model.newThreadStartInSelector.environments}
              selectedPath={model.newThreadStartInSelector.selectedEnvironmentPath}
              busy={model.newThreadStartInSelector.environmentsLoading}
              disabled={projectSelectorDisabled || model.newThreadStartInSelector.disabled}
              onRefresh={() => actions.onRefreshNewThreadStartInEnvironments?.() ?? Promise.resolve()}
              onSelect={(environmentPath) => {
                actions.onNewThreadStartInEnvironmentChange?.(environmentPath);
                return true;
              }}
              onOpenSettings={() => actions.onOpenNewThreadLocalEnvironmentsSettings?.()}
              triggerClassName="text-token-text-tertiary hover:text-token-foreground"
            />
          ) : null}
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
