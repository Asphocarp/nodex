import { useForm, useStore } from "@tanstack/react-form";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { handleFormSubmit } from "@/lib/forms";
import { formatCodexModelLabel, formatCodexReasoningEffortLabel } from "@/lib/codex-thread-settings";
import { resolveContextWindowIndicatorState } from "@/lib/codex-context-window";
import type { CodexReasoningEffort } from "@/lib/types";
import { shouldSubmitComposerPromptFromKeyDown } from "@/lib/composer-enter-behavior";
import { useCodexServiceTierSettings } from "@/lib/use-codex-service-tier-settings";
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
  CodexFastModeIcon,
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
  formatComposerDictationDuration,
  isComposerDictationShortcut,
  isComposerDictationShortcutTargetBlocked,
  useComposerDictation,
} from "./use-composer-dictation";
import {
  BranchSelectorPopover,
  ContextWindowIndicator,
  invoke,
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSection,
  NodexDropdownSelectedIcon,
  NodexDropdownTitle,
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

const SERVICE_TIER_OPTIONS = [
  {
    value: null,
    label: "Standard",
    description: "Use the default service tier.",
  },
  {
    value: "fast" as const,
    label: "Fast",
    description: "Use the faster service tier for new requests.",
  },
];

function isElectronLikeComposerEnvironment(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.api) {
    return true;
  }

  return document.documentElement.dataset.codexWindowType === "electron";
}

function renderModelSelectorLabel(input: {
  availableModels: ThreadFooterModel["availableModels"];
  selectedModel: string;
  serviceTier: null | "fast";
}) {
  const label = formatCodexModelLabel(input.selectedModel, input.availableModels);
  const showFastModeIndicator = input.serviceTier === "fast";

  return (
    <span className="flex min-w-0 items-center gap-1 tabular-nums">
      {showFastModeIndicator ? (
        <span data-fast-mode-indicator="true">
          <CodexFastModeIcon className="text-token-link-foreground" />
        </span>
      ) : null}
      <span className="truncate whitespace-nowrap">{label}</span>
    </span>
  );
}

export function ThreadComposer({ model, actions, errorMessage, onErrorMessage }: ThreadComposerProps) {
  const [busyAction, setBusyAction] = useState<StageThreadsBusyAction>(null);
  const [branchState, setBranchState] = useState<BranchSelectorState>(EMPTY_BRANCH_SELECTOR_STATE);
  const [isBranchBusy, setIsBranchBusy] = useState(false);
  const [customPermissionDescription, setCustomPermissionDescription] = useState<string | null>(null);
  const [dictationToastMessage, setDictationToastMessage] = useState<string | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const dictationShortcutActiveRef = useRef(false);
  const branchCwd = useMemo(
    () => resolveBranchSelectorCwd(model.conversation?.cwd, model.projectWorkspacePath),
    [model.conversation?.cwd, model.projectWorkspacePath],
  );
  const branchCwdRef = useRef<string | null>(branchCwd);
  const branchMutationRequestIdRef = useRef(0);
  branchCwdRef.current = branchCwd;
  const { serviceTierSettings, setServiceTier } = useCodexServiceTierSettings();

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
  const isDictationSupported = useMemo(
    () =>
      model.dictation.isEnabled
      && isElectronLikeComposerEnvironment()
      && typeof navigator !== "undefined"
      && typeof navigator.mediaDevices?.getUserMedia === "function"
      && typeof MediaRecorder !== "undefined",
    [model.dictation.isEnabled],
  );

  const insertDictationTranscript = useCallback((transcript: string): string => {
    const textarea = promptTextareaRef.current;
    const normalizedTranscript = transcript.trim();
    if (normalizedTranscript.length === 0) {
      return prompt;
    }

    if (textarea) {
      const selectionStart = textarea.selectionStart ?? prompt.length;
      const selectionEnd = textarea.selectionEnd ?? selectionStart;
      const nextPrompt = `${prompt.slice(0, selectionStart)}${normalizedTranscript}${prompt.slice(selectionEnd)}`;
      promptForm.setFieldValue("prompt", nextPrompt);
      requestAnimationFrame(() => {
        textarea.focus();
        const nextSelection = selectionStart + normalizedTranscript.length;
        textarea.setSelectionRange(nextSelection, nextSelection);
      });
      return nextPrompt;
    }

    const nextPrompt = `${prompt}${normalizedTranscript}`;
    promptForm.setFieldValue("prompt", nextPrompt);
    return nextPrompt;
  }, [prompt, promptForm]);

  const showDictationToast = useCallback((message: string) => {
    setDictationToastMessage(message);
  }, []);

  const {
    isDictating,
    isTranscribing,
    recordingDurationMs,
    waveformCanvasRef,
    startDictation,
    stopDictation,
  } = useComposerDictation({
    enabled: isDictationSupported,
    onTranscriptInsert: (transcript) => {
      insertDictationTranscript(transcript);
    },
    onTranscriptSend: (transcript) => {
      const nextPrompt = insertDictationTranscript(transcript);
      window.setTimeout(() => {
        void submitPrompt({
          prompt: nextPrompt,
          reset: () => {
            promptForm.reset();
          },
        });
      }, 0);
    },
    onStartError: (error) => {
      console.error("[composer-dictation:start]", error);
      showDictationToast("Unable to start dictation");
    },
    onTranscribeError: (error) => {
      console.error("[composer-dictation:transcribe]", error);
      showDictationToast("Unable to transcribe audio");
    },
    onUnsupported: () => {
      showDictationToast("Dictation is not available on this device");
    },
  });
  const startDictationRef = useRef(startDictation);
  const stopDictationRef = useRef(stopDictation);

  useEffect(() => {
    if (!dictationToastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDictationToastMessage(null);
    }, 4000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [dictationToastMessage]);

  useEffect(() => {
    startDictationRef.current = startDictation;
    stopDictationRef.current = stopDictation;
  }, [startDictation, stopDictation]);

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
    if (!isDictationSupported || model.dictation.isRealtimeVoiceActive) {
      dictationShortcutActiveRef.current = false;
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || !isComposerDictationShortcut(event)) {
        return;
      }
      if (isComposerDictationShortcutTargetBlocked(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (dictationShortcutActiveRef.current) {
        return;
      }

      dictationShortcutActiveRef.current = true;
      void startDictationRef.current();
    };

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (!isComposerDictationShortcut(event)) {
        return;
      }
      if (isComposerDictationShortcutTargetBlocked(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (!dictationShortcutActiveRef.current) {
        return;
      }

      dictationShortcutActiveRef.current = false;
      stopDictationRef.current("insert");
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    return () => {
      dictationShortcutActiveRef.current = false;
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [
    isDictationSupported,
    model.dictation.isRealtimeVoiceActive,
  ]);

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

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
      <div className="relative">
        {dictationToastMessage ? (
          <button
            type="button"
            onClick={() => setDictationToastMessage(null)}
            className="absolute inset-x-0 -top-10 z-20 mx-auto inline-flex w-fit max-w-[min(24rem,100%)] items-center rounded-full border border-(--destructive)/30 bg-(--destructive)/10 px-3 py-1 text-xs font-medium text-(--destructive)"
            title={dictationToastMessage}
          >
            {dictationToastMessage}
          </button>
        ) : null}
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

          {isDictating ? (
            <div className="mb-2 flex items-center gap-2 px-2">
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) opacity-50"
                aria-label="Add files and more"
                title="Add files and more"
                disabled
              >
                <PlusIcon className="size-4" />
              </button>
              <div className="flex h-7 min-w-0 flex-1 items-center">
                <canvas
                  ref={waveformCanvasRef}
                  className="h-7 w-full text-(--foreground)"
                />
              </div>
              <span className="text-sm tabular-nums text-(--foreground-secondary)">
                {formatComposerDictationDuration(recordingDurationMs)}
              </span>
              <NodexTooltip tooltipContent={<span className="text-token-foreground">Stop dictation</span>} side="top" sideOffset={4}>
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-secondary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground)"
                  aria-label="Stop dictation"
                  onClick={() => stopDictation("insert")}
                  disabled={isTranscribing}
                >
                  <StopIcon className="size-4" />
                </button>
              </NodexTooltip>
              <NodexTooltip tooltipContent={<span className="text-token-foreground">Transcribe and send</span>} side="top" sideOffset={4}>
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full bg-(--foreground) p-0.5 text-(--background) focus-visible:outline-2 focus-visible:outline-(--ring)",
                    isTranscribing && "opacity-50",
                  )}
                  aria-label="Transcribe and send"
                  onClick={() => stopDictation("send")}
                  disabled={isTranscribing}
                >
                  <UpArrowIcon className="size-5" />
                </button>
              </NodexTooltip>
            </div>
          ) : (
            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.25 px-2">
              <div className="flex w-full min-w-0 flex-nowrap items-center justify-start gap-1.25">
                <NodexDropdownMenu
                  triggerButton={(
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
                      aria-label="Add files and more"
                      title="Add files and more"
                    >
                      <PlusIcon className="size-4" />
                    </button>
                  )}
                  side="top"
                  align="start"
                  contentWidth="sm"
                >
                  <NodexDropdownSection className="flex min-w-40 flex-col overflow-hidden pt-1">
                    <NodexDropdownTitle>Add files and more</NodexDropdownTitle>
                    <NodexDropdownFlyoutSubmenuItem label="Speed">
                      <NodexDropdownSection className="flex min-w-52 flex-col overflow-hidden pt-1">
                        <NodexDropdownTitle>Speed</NodexDropdownTitle>
                        {SERVICE_TIER_OPTIONS.map((option) => (
                          <NodexDropdownItem
                            key={option.label}
                            onSelect={() => setServiceTier(option.value, "composer_menu")}
                            rightSlot={option.value === serviceTierSettings.serviceTier ? <NodexDropdownSelectedIcon /> : null}
                            subText={option.description}
                            allowWrap
                          >
                            {option.label}
                          </NodexDropdownItem>
                        ))}
                      </NodexDropdownSection>
                    </NodexDropdownFlyoutSubmenuItem>
                  </NodexDropdownSection>
                </NodexDropdownMenu>

                <div className="flex min-w-0 items-center gap-1">
                  <StageThreadsCollaborationModeDropdown
                    collaborationModes={model.collaborationModes}
                    selectedMode={model.selectedCollaborationMode}
                    onSelect={actions.onCollaborationModeChange}
                  />
                  <ToolbarDropdownMenu
                    label={renderModelSelectorLabel({
                      selectedModel: model.selectedModel,
                      availableModels: model.availableModels,
                      serviceTier: serviceTierSettings.serviceTier,
                    })}
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
                {isDictationSupported ? (
                  <NodexTooltip
                    tooltipContent={<span className="text-token-foreground">Click to dictate or hold</span>}
                    shortcut={model.dictation.shortcutLabel}
                    side="top"
                    sideOffset={4}
                  >
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-full border border-transparent px-0 text-(--foreground-tertiary) transition-colors duration-100 hover:bg-(--background-tertiary) hover:text-(--foreground-secondary)"
                      aria-label="Dictate"
                      onClick={() => {
                        void startDictation();
                      }}
                      disabled={model.dictation.isRealtimeVoiceActive}
                    >
                      {isTranscribing ? (
                        <SpinnerIcon className="size-4" />
                      ) : (
                        <MicIcon className="size-4" />
                      )}
                    </button>
                  </NodexTooltip>
                ) : null}

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
          )}
        </div>
        </form>
      </div>

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
          <ContextWindowIndicator
            state={contextWindowIndicatorState}
            account={model.account}
          />
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
