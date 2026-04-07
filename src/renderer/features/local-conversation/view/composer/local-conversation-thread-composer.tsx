import { useForm, useStore } from "@tanstack/react-form";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { handleFormSubmit } from "@/lib/forms";
import { formatCodexModelLabel, formatCodexReasoningEffortLabel } from "@/lib/codex-thread-settings";
import { resolveContextWindowIndicatorState } from "@/lib/codex-context-window";
import type { CodexReasoningEffort } from "@/lib/types";
import { shouldSubmitComposerPromptFromKeyDown } from "@/lib/composer-enter-behavior";
import {
  resolveThreadInProgressFollowUpMode,
  resolveShortcutKeycapTokens,
  resolveThreadComposerAlternateShortcutAccelerator,
  resolveThreadComposerPrimaryShortcutAccelerator,
  shouldInvertThreadInProgressFollowUpModeFromKeyDown,
} from "@/lib/thread-composer-follow-up-mode";
import {
  resolveStageThreadsComposerActionState,
  type StageThreadsBusyAction,
  type StageThreadsComposerSubmitAction,
} from "../shared/composer-action";
import {
  EMPTY_BRANCH_SELECTOR_STATE,
  isBranchSelectorMutationCurrent,
  parseBranchSelectorState,
  resolveBranchSelectorCwd,
  type BranchSelectorState,
} from "../shared/branch-selector-state";
import { resolvePromptTextareaSize } from "../shared/prompt-textarea-size";
import { cn } from "../../../../lib/utils";
import {
  ChevronDownIcon,
  LocalStatusIcon,
  MicIcon,
  PlusIcon,
  ReasoningEffortIcon,
  SpinnerIcon,
  StopIcon,
  UpArrowIcon,
} from "@/components/shared/icons";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import { ComposerActionTooltipContent } from "./composer-submit-tooltip";
import {
  BranchSelectorPopover,
  ContextWindowIndicator,
  invoke,
  NodexTooltip,
  PermissionModeDropdown,
  resolvePromptTextareaMaxHeightPx,
  StageThreadsCollaborationModeDropdown,
  subscribeGitBranchChanges,
  ToolbarDropdownMenu,
} from "./local-conversation-thread-composer-deps";

interface ThreadComposerProps {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
}

export function ThreadComposer({ model, actions, errorMessage, onErrorMessage }: ThreadComposerProps) {
  const [busyAction, setBusyAction] = useState<StageThreadsBusyAction>(null);
  const [branchState, setBranchState] = useState<BranchSelectorState>(EMPTY_BRANCH_SELECTOR_STATE);
  const [isBranchBusy, setIsBranchBusy] = useState(false);
  const [customPermissionDescription, setCustomPermissionDescription] = useState<string | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const branchCwd = useMemo(
    () => resolveBranchSelectorCwd(model.conversation?.cwd, model.projectWorkspacePath),
    [model.conversation?.cwd, model.projectWorkspacePath],
  );
  const branchCwdRef = useRef<string | null>(branchCwd);
  const branchMutationRequestIdRef = useRef(0);
  branchCwdRef.current = branchCwd;

  const submitPrompt = useCallback(async (
    input: {
      prompt: string;
      reset?: () => void;
      invertInProgressFollowUpMode?: boolean;
    },
  ) => {
    const nextPrompt = input.prompt.trim();
    const target = model.newThreadTarget;
    const inProgressFollowUpMode = resolveThreadInProgressFollowUpMode({
      invertInProgressFollowUpMode: input.invertInProgressFollowUpMode,
      isQueueingEnabled: model.isQueueingEnabled,
    });

    if (!nextPrompt) {
      return;
    }

    setBusyAction("send");
    onErrorMessage(null);

    try {
      if (!model.conversation) {
        if (!target) return;
        await actions.onStartThreadForCard({
          projectId: target.projectId,
          cardId: target.cardId,
          prompt: nextPrompt,
        });
      } else if (model.isThreadRunning) {
        if (inProgressFollowUpMode === "queue") {
          await actions.onEnqueueQueuedFollowUp(model.conversation.threadId, nextPrompt, {
            collaborationMode: model.selectedCollaborationMode,
          });
        } else {
          if (!model.activeTurn) {
            onErrorMessage("Codex is already running. Wait for the active turn to load or queue the follow-up instead.");
            return;
          }
          await actions.onSteerPrompt(model.activeTurn.turnId, nextPrompt);
        }
      } else {
        await actions.onSendPrompt(nextPrompt);
      }
      input.reset?.();
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not send prompt");
    } finally {
      setBusyAction(null);
    }
  }, [
    actions,
    model.activeTurn,
    model.conversation,
    model.isNewThreadTab,
    model.isQueueingEnabled,
    model.isThreadRunning,
    model.newThreadTarget,
    model.selectedCollaborationMode,
    onErrorMessage,
  ]);

  const promptForm = useForm({
    defaultValues: { prompt: "" },
    onSubmit: async ({ value, formApi }) => {
      await submitPrompt({
        prompt: value.prompt,
        reset: () => {
          formApi.reset();
        },
      });
    },
  });
  const prompt = useStore(promptForm.store, (state) => state.values.prompt);

  const resizePromptTextarea = useCallback(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const { heightPx, hasOverflow } = resolvePromptTextareaSize({
      scrollHeight: textarea.scrollHeight,
      maxHeightPx: resolvePromptTextareaMaxHeightPx(),
    });
    textarea.style.height = heightPx > 0 ? `${heightPx}px` : "";
    textarea.style.overflowY = hasOverflow ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizePromptTextarea();
  }, [prompt, resizePromptTextarea]);

  useEffect(() => {
    const composerIntent = model.composerIntent;
    const threadId = model.conversation?.threadId ?? model.body.threadId;
    if (!composerIntent || !threadId) return;

    promptForm.setFieldValue("prompt", composerIntent.prompt);
    requestAnimationFrame(() => {
      const textarea = promptTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const selectionStart = composerIntent.prompt.length;
      textarea.setSelectionRange(selectionStart, selectionStart);
    });
    actions.onConsumeComposerIntent(threadId, composerIntent.focusNonce);
  }, [actions, model.body.threadId, model.composerIntent, model.conversation?.threadId, promptForm]);

  useEffect(() => {
    let cancelled = false;

    void invoke("codex:permission:custom-description:get", model.projectId)
      .then((result) => {
        if (cancelled) return;
        setCustomPermissionDescription(typeof result === "string" ? result : null);
      })
      .catch(() => {
        if (cancelled) return;
        setCustomPermissionDescription(null);
      });

    return () => {
      cancelled = true;
    };
  }, [model.projectId]);

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

  const handleInterrupt = useCallback(async () => {
    if (!model.conversation || !model.isThreadRunning) return;
    setBusyAction("interrupt");
    onErrorMessage(null);
    try {
      await actions.onInterruptTurn(model.activeTurn?.turnId ?? undefined);
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not stop Codex");
    } finally {
      setBusyAction(null);
    }
  }, [actions, model.activeTurn?.turnId, model.conversation, model.isThreadRunning, onErrorMessage]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    const hasMultilinePrompt = prompt.includes("\n");

    if (shouldInvertThreadInProgressFollowUpModeFromKeyDown({
      enterBehavior: model.composerEnterBehavior,
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing,
    }) && model.conversation && model.isThreadRunning) {
      event.preventDefault();
      void submitPrompt({
        prompt,
        reset: () => {
          promptForm.reset();
        },
        invertInProgressFollowUpMode: true,
      });
      return;
    }

    if (!shouldSubmitComposerPromptFromKeyDown({
      enterBehavior: model.composerEnterBehavior,
      hasMultilinePrompt,
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing,
    })) {
      return;
    }

    event.preventDefault();
    void promptForm.handleSubmit();
  }, [model.composerEnterBehavior, model.conversation, model.isThreadRunning, prompt, promptForm, submitPrompt]);

  const hasDraftContent = prompt.trim().length > 0;
  const hasMultilinePrompt = prompt.includes("\n");
  const isMacPlatform = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const composerActionState = resolveStageThreadsComposerActionState({
    canSendPrompt: (model.conversation !== null || (model.isNewThreadTab && model.newThreadTarget !== null)) && !model.isCloudNewThreadTarget,
    isThreadRunning: model.isThreadRunning,
    busyAction,
    hasDraftContent,
    isQueueingEnabled: model.isQueueingEnabled,
  });
  const isSendPending = busyAction === "send" && composerActionState.action === "send";
  const canRunPrimaryAction = Boolean(
    hasDraftContent &&
    (model.conversation || (model.isNewThreadTab && model.newThreadTarget)) &&
    !model.isCloudNewThreadTarget,
  );
  const primaryShortcutKeys = resolveShortcutKeycapTokens({
    accelerator: resolveThreadComposerPrimaryShortcutAccelerator({
      enterBehavior: model.composerEnterBehavior,
      hasMultilinePrompt,
    }),
    isMacPlatform,
  });
  const alternateShortcutKeys = resolveShortcutKeycapTokens({
    accelerator: resolveThreadComposerAlternateShortcutAccelerator(model.composerEnterBehavior),
    isMacPlatform,
  });
  const contextWindowIndicatorState = resolveContextWindowIndicatorState(model.conversation);
  const composerActionTooltip = renderComposerActionTooltipContent({
    action: composerActionState.action,
    submitAction: composerActionState.submitAction,
    alternateInProgressSubmitAction: composerActionState.alternateInProgressSubmitAction,
    isThreadRunning: model.isThreadRunning,
    primaryShortcutKeys,
    alternateShortcutKeys,
  });

  return (
    <>
      <form
        className="border-token-border bg-token-input-background relative overflow-hidden rounded-3xl border bg-clip-padding shadow-card-md electron:shadow-md electron:focus-within:shadow-lg electron:dark:bg-token-dropdown-background/50"
        onSubmit={(event) => handleFormSubmit(event, promptForm.handleSubmit)}
      >
        <div className="relative z-10">
          <div className="px-2 py-1.5">
            <div className="flex w-full flex-wrap items-center justify-start gap-1" />
          </div>

          <div className="mb-2 grow overflow-y-auto px-3">
            <div className="h-auto max-h-[25dvh] min-h-[4dvh] overflow-y-auto text-sm text-(--foreground)">
              <textarea
                ref={promptTextareaRef}
                value={prompt}
                placeholder={
                  model.conversation
                    ? "Ask for follow-up changes"
                    : model.isNewThreadTab
                      ? model.newThreadTarget
                        ? model.isCloudNewThreadTarget
                          ? "Cloud run target is currently mock-only"
                          : "Write the first prompt for this new thread..."
                        : "Select a card before starting a new thread"
                      : "Select a thread"
                }
                onChange={(event) => {
                  promptForm.setFieldValue("prompt", event.target.value);
                }}
                onKeyDown={handleKeyDown}
                rows={1}
                className="min-h-10 w-full resize-none border-0 bg-transparent p-0 text-sm/editor text-(--foreground) placeholder:text-(--foreground-tertiary) focus:outline-none"
                disabled={(model.conversation === null && (!model.isNewThreadTab || model.newThreadTarget === null || model.isCloudNewThreadTarget)) || busyAction !== null}
              />
            </div>
          </div>

          {errorMessage && <div className="px-3 pb-2 text-xs text-(--destructive)">{errorMessage}</div>}

          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.25 px-2">
            <div className="flex w-full min-w-0 flex-nowrap items-center justify-start gap-1.25">
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
                aria-label="Add files and more"
                title="Add files and more"
              >
                <PlusIcon className="size-4" />
              </button>

              <div className="flex min-w-0 items-center gap-1">
                <StageThreadsCollaborationModeDropdown
                  collaborationModes={model.collaborationModes}
                  selectedMode={model.selectedCollaborationMode}
                  onSelect={actions.onCollaborationModeChange}
                />
                <ToolbarDropdownMenu
                  label={formatCodexModelLabel(model.selectedModel, model.availableModels)}
                  title="Select model"
                  ariaLabel="Select Codex model"
                  className="min-w-0"
                  items={model.availableModels.filter((candidate) => !candidate.hidden).map((candidate) => ({
                    value: candidate.id,
                    label: formatCodexModelLabel(candidate.id, model.availableModels),
                    description: candidate.description,
                  }))}
                  selectedValue={model.selectedModel}
                  onSelect={actions.onModelChange}
                  emptyLabel="No Codex models available"
                />
                <ToolbarDropdownMenu
                  label={formatCodexReasoningEffortLabel(model.selectedReasoningEffort)}
                  title="Select reasoning"
                  ariaLabel="Select reasoning effort"
                  items={model.reasoningEffortOptions.map((option) => ({
                    value: option.reasoningEffort,
                    label: formatCodexReasoningEffortLabel(option.reasoningEffort),
                    description: option.description,
                  }))}
                  selectedValue={model.selectedReasoningEffort}
                  selectedItemDataAttribute="data-reasoning-selected"
                  onSelect={(value) => actions.onReasoningEffortChange(value as CodexReasoningEffort)}
                  renderItemIcon={(value) => (
                    <ReasoningEffortIcon effort={value as CodexReasoningEffort} className="icon-2xs" />
                  )}
                />
              </div>
            </div>

            <div className="flex items-center" />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
                aria-label="Dictate"
                title="Dictate"
              >
                <MicIcon className="size-4" />
              </button>

              <NodexTooltip
                tooltipContent={composerActionTooltip}
                side="top"
                tooltipBodyClassName={cn(
                  composerActionState.action === "stop" || !model.isThreadRunning
                    ? "text-center text-pretty"
                    : "max-w-none",
                )}
              >
                <span className="inline-flex">
                  <button
                    type={composerActionState.action === "stop" ? "button" : "submit"}
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-(--ring)",
                      "bg-(--foreground) text-(--background)",
                      (composerActionState.disabled || (composerActionState.action !== "stop" && !canRunPrimaryAction)) && !isSendPending && "opacity-50",
                      isSendPending && "cursor-wait",
                    )}
                    onClick={composerActionState.action === "stop" ? () => void handleInterrupt() : undefined}
                    disabled={composerActionState.action === "stop"
                      ? composerActionState.disabled
                      : composerActionState.disabled || !canRunPrimaryAction}
                    aria-label={composerActionState.label}
                  >
                    {isSendPending ? (
                      <SpinnerIcon className="size-5" />
                    ) : composerActionState.action === "stop" ? (
                      <StopIcon className="size-4" />
                    ) : (
                      <UpArrowIcon className="size-5" />
                    )}
                  </button>
                </span>
              </NodexTooltip>
            </div>
          </div>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2 overflow-visible px-2 py-1.5">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
          <div className="relative flex w-full items-center gap-2">
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-transparent px-1.5 text-sm/4.5 text-(--foreground-tertiary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
            >
              <LocalStatusIcon className="shrink-0" />
              <span className="max-w-40 truncate text-sm">{model.projectId.split("/").pop() ?? "Local"}</span>
              <ChevronDownIcon />
            </button>

            <PermissionModeDropdown
              selectedMode={model.permissionMode}
              customDescription={customPermissionDescription}
              onSelect={actions.onPermissionModeChange}
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <BranchSelectorPopover
            cwd={branchCwd}
            state={branchState}
            busy={isBranchBusy}
            onRefresh={handleRefreshBranchState}
            onCheckout={handleCheckoutBranch}
            onCreate={handleCreateBranch}
          />
          <ContextWindowIndicator state={contextWindowIndicatorState} />
        </div>
      </div>
    </>
  );
}

function renderComposerActionTooltipContent(input: {
  action: "send" | "stop";
  submitAction: StageThreadsComposerSubmitAction | null;
  alternateInProgressSubmitAction: Exclude<StageThreadsComposerSubmitAction, "send"> | null;
  isThreadRunning: boolean;
  primaryShortcutKeys: readonly string[];
  alternateShortcutKeys: readonly string[];
}) {
  return (
    <ComposerActionTooltipContent
      action={input.action}
      submitAction={input.submitAction}
      alternateInProgressSubmitAction={input.alternateInProgressSubmitAction}
      isThreadRunning={input.isThreadRunning}
      primaryShortcutKeys={input.primaryShortcutKeys}
      alternateShortcutKeys={input.alternateShortcutKeys}
    />
  );
}
