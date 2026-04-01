import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckmarkIcon,
  ChevronDownIcon,
  DownArrowIcon,
  SearchIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import { readSkipForkFromOlderTurnConfirm, writeSkipForkFromOlderTurnConfirm } from "@/lib/thread-fork-confirm-settings";
import { LOCAL_CONVERSATION_CONTENT_CLASS_NAME } from "./shared/local-conversation-view-constants";
import { cn } from "../../../lib/utils";
import type { ThreadBodyUiStateOverrides, ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import {
  VirtualizedTurnList,
  type VirtualizedTurnListHandle,
} from "./local-conversation-virtualized-turn-list";
import { LocalConversationAboveComposerPortal } from "./local-conversation-above-composer-portal";
import { LocalConversationForkFromTurnDialog } from "./local-conversation-fork-from-turn-dialog";
import {
  LocalConversationThreadScrollLayout,
  useLocalConversationThreadScrollController,
} from "./local-conversation-thread-scroll-controller";
import { LocalConversationResumeLoader } from "./shared/local-conversation-resume-loader";

const PROGRESS_PHASES = [
  { key: "creatingWorktree", label: "Worktree" },
  { key: "runningSetup", label: "Setup" },
  { key: "startingThread", label: "Thread" },
] as const;

function resolvePhaseIndex(
  phase: ThreadStageModel["threadStartProgress"] extends infer T ? T extends { phase: infer P } ? P : never : never,
): number {
  if (phase === "creatingWorktree") return 0;
  if (phase === "runningSetup") return 1;
  if (phase === "startingThread" || phase === "ready") return 2;
  return -1;
}

function ThreadStartProgressPanel({
  progress,
  outputText,
  setupProgressLogRef,
}: {
  progress: NonNullable<ThreadStageModel["threadStartProgress"]>;
  outputText: string;
  setupProgressLogRef: React.RefObject<HTMLDivElement | null>;
}) {
  const activePhaseIndex = resolvePhaseIndex(progress.phase);
  const isFailed = progress.phase === "failed";

  return (
    <div className="w-full max-w-140 px-4">
      <div className="mb-3 flex items-center gap-2">
        {!isFailed && <SpinnerIcon className="size-3.5 shrink-0 text-(--foreground-tertiary)" />}
        <span className="text-sm font-medium text-(--foreground-secondary)">
          {progress.message || "Preparing worktree…"}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-1">
        {PROGRESS_PHASES.map((phase, index) => {
          const isComplete = activePhaseIndex > index;
          const isActive = activePhaseIndex === index && !isFailed;
          return (
            <div key={phase.key} className="flex items-center gap-1">
              {index > 0 && (
                <div className={cn("mx-1 h-px w-4", isComplete ? "bg-(--accent-blue)" : "bg-(--border)")} />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full text-[10px] font-medium transition-colors duration-200",
                    isComplete && "bg-(--accent-blue) text-white",
                    isActive && "bg-(--accent-blue)/20 text-(--accent-blue) ring-1 ring-(--accent-blue)/40",
                    !isComplete && !isActive && "bg-(--background-tertiary) text-(--foreground-tertiary)",
                    isFailed && index === activePhaseIndex && "bg-(--destructive)/15 text-(--destructive) ring-1 ring-(--destructive)/30",
                  )}
                >
                  {isComplete ? <CheckmarkIcon className="size-2.5" /> : index + 1}
                </div>
                <span
                  className={cn(
                    "text-xs",
                    isComplete && "text-(--foreground-secondary)",
                    isActive && "font-medium text-(--foreground-secondary)",
                    !isComplete && !isActive && "text-(--foreground-tertiary)",
                    isFailed && index === activePhaseIndex && "font-medium text-(--destructive)",
                  )}
                >
                  {phase.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border-[0.5px] border-(--border) bg-(--background-secondary)">
        <div ref={setupProgressLogRef} className="scrollbar-token max-h-80 min-h-28 overflow-auto p-3">
          <pre className="font-mono text-xs/relaxed wrap-break-word whitespace-pre-wrap text-(--foreground-tertiary)">
            {outputText || "Preparing…\n"}
          </pre>
        </div>
      </div>
    </div>
  );
}

interface LocalConversationThreadBodyProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
  initialUiState?: ThreadBodyUiStateOverrides;
}

function LocalConversationThreadBodyContent({ model, actions, onErrorMessage, initialUiState }: LocalConversationThreadBodyProps) {
  const body = model.body;
  const {
    isScrolledFromBottom,
    maybeStickToBottom,
    scrollToBottom,
    setScrollMode,
  } = useLocalConversationThreadScrollController();
  const listRef = useRef<VirtualizedTurnListHandle>(null);
  const setupProgressLogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastHandledSearchOpenTickRef = useRef(model.searchOpenTick);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [collapsedAgentBodyByTurnId, setCollapsedAgentBodyByTurnId] = useState<Record<string, boolean>>(
    () => initialUiState?.collapsedAgentBodyByTurnId ?? {},
  );
  const [forkDialogState, setForkDialogState] = useState<{
    threadId: string;
    turnId: string;
    message: string;
  } | null>(null);
  const [isForkSubmitting, setIsForkSubmitting] = useState(false);

  useEffect(() => {
    setScrollMode("stickToBottom");
    maybeStickToBottom();
  }, [body.threadId, maybeStickToBottom, setScrollMode]);

  useEffect(() => {
    setIsSearchVisible(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
    setCollapsedAgentBodyByTurnId(initialUiState?.collapsedAgentBodyByTurnId ?? {});
    setForkDialogState(null);
    setIsForkSubmitting(false);
  }, [body.threadId, initialUiState?.collapsedAgentBodyByTurnId]);

  useEffect(() => {
    const shouldOpenSearch =
      model.searchOpenTick > 0
      && model.searchOpenTick !== lastHandledSearchOpenTickRef.current
      && body.turns.length > 0
      && !body.showThreadStartProgressPanel
      && body.emptyState.type === "none";

    if (!shouldOpenSearch) return;

    lastHandledSearchOpenTickRef.current = model.searchOpenTick;
    setIsSearchVisible(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [body.emptyState.type, body.showThreadStartProgressPanel, body.turns.length, model.searchOpenTick]);

  useEffect(() => {
    if (!body.showThreadStartProgressPanel) return;
    const element = setupProgressLogRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      const current = setupProgressLogRef.current;
      if (!current) return;
      current.scrollTop = current.scrollHeight;
    });
  }, [body.showThreadStartProgressPanel, model.threadStartProgress?.outputText, model.threadStartProgress?.updatedAt]);

  const handleCatchUp = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const handleAgentBodyCollapsedChange = useCallback((turnId: string, collapsed: boolean) => {
    setCollapsedAgentBodyByTurnId((current) => {
      if (current[turnId] === collapsed) return current;
      return {
        ...current,
        [turnId]: collapsed,
      };
    });
  }, []);

  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const matchedSearchUnits = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return body.turns.flatMap((turn) =>
      turn.searchUnits.filter((unit) => unit.text.toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [body.turns, normalizedSearchQuery]);
  const matchedTurnIds = useMemo(() => new Set(matchedSearchUnits.map((unit) => unit.turnId)), [matchedSearchUnits]);
  const matchedSearchUnitKeys = useMemo(() => new Set(matchedSearchUnits.map((unit) => unit.key)), [matchedSearchUnits]);
  const activeSearchUnitKey = matchedSearchUnits[activeMatchIndex]?.key ?? null;

  useEffect(() => {
    if (matchedSearchUnits.length === 0) {
      setActiveMatchIndex(0);
      return;
    }
    setActiveMatchIndex((current) => Math.min(current, matchedSearchUnits.length - 1));
  }, [matchedSearchUnits]);

  useEffect(() => {
    if (matchedSearchUnits.length === 0) return;
    const targetUnit = matchedSearchUnits[activeMatchIndex];
    if (!targetUnit) return;
    listRef.current?.scrollToTurn(targetUnit.turnId, { expandAgentBody: true });
  }, [activeMatchIndex, matchedSearchUnits]);

  const handleStepSearchMatch = useCallback((direction: "previous" | "next") => {
    if (matchedSearchUnits.length === 0) return;
    setActiveMatchIndex((current) => {
      const delta = direction === "next" ? 1 : -1;
      return (current + delta + matchedSearchUnits.length) % matchedSearchUnits.length;
    });
  }, [matchedSearchUnits.length]);

  const closeSearch = useCallback(() => {
    setIsSearchVisible(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
  }, []);

  const handleEditLastUserTurn = useCallback(async (
    input: { threadId: string; turnId: string; message: string },
  ) => {
    onErrorMessage(null);
    try {
      await actions.onEditLastUserTurn(input);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "Could not edit the last user message";
      onErrorMessage(nextError);
      throw error;
    }
  }, [actions, onErrorMessage]);

  const runForkFromTurn = useCallback(async (
    input: { threadId: string; turnId: string; message: string },
    opts?: { skipConfirm?: boolean },
  ) => {
    setIsForkSubmitting(true);
    onErrorMessage(null);
    try {
      if (opts?.skipConfirm) {
        writeSkipForkFromOlderTurnConfirm(true);
      }
      await actions.onForkFromTurn(input);
      setForkDialogState(null);
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Could not fork the conversation");
    } finally {
      setIsForkSubmitting(false);
    }
  }, [actions, onErrorMessage]);

  const handleForkFromTurn = useCallback(async (
    input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean },
  ) => {
    if (input.isLatestTurn || readSkipForkFromOlderTurnConfirm()) {
      await runForkFromTurn(input);
      return;
    }

    setForkDialogState({
      threadId: input.threadId,
      turnId: input.turnId,
      message: input.message,
    });
  }, [runForkFromTurn]);

  const showThreadSearch =
    isSearchVisible
    && body.turns.length > 0
    && !body.showThreadStartProgressPanel
    && body.emptyState.type === "none";
  const showCatchUpControl =
    model.conversation !== null
    && body.turns.length > 0
    && isScrolledFromBottom;
  const aboveComposerBlocks = body.aboveComposerBlocks ?? [];
  const shouldRenderAboveComposerPortal =
    aboveComposerBlocks.length > 0
    && body.activeTurnId !== null;

  return (
    <>
      {shouldRenderAboveComposerPortal ? (
        <LocalConversationAboveComposerPortal
          blocks={aboveComposerBlocks}
          isLatestTurn={body.latestTurnId === body.activeTurnId}
          isStreamingTurn={true}
          projectWorkspacePath={model.projectWorkspacePath}
          threadCwd={model.conversation?.cwd ?? null}
          onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
        />
      ) : null}
      <div className="mx-auto flex h-full min-h-full max-w-(--thread-content-max-width) flex-col px-2.5 md:px-panel">
        {body.showThreadStartProgressPanel && model.threadStartProgress ? (
          <div className="flex flex-1 items-center justify-center">
            <ThreadStartProgressPanel
              progress={model.threadStartProgress}
              outputText={model.threadStartProgress.outputText}
              setupProgressLogRef={setupProgressLogRef}
            />
          </div>
        ) : body.emptyState.type === "newThread" || body.emptyState.type === "noThread" ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-95 space-y-2 px-6 text-center">
              <div className="text-base font-medium text-(--foreground-tertiary)">{body.emptyState.title}</div>
              <div className="text-sm/normal text-(--foreground-tertiary) opacity-60">{body.emptyState.description}</div>
            </div>
          </div>
        ) : body.emptyState.type === "emptyThread" ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="space-y-1 px-6 text-center">
              <div className="text-base font-medium text-(--foreground-tertiary)">{body.emptyState.title}</div>
              <div className="text-sm text-(--foreground-tertiary) opacity-60">{body.emptyState.description}</div>
            </div>
          </div>
        ) : body.emptyState.type === "resumingThread" ? (
          <LocalConversationResumeLoader
            title={body.emptyState.title}
            description={body.emptyState.description}
          />
        ) : (
          <div data-thread-find-target="conversation" className={LOCAL_CONVERSATION_CONTENT_CLASS_NAME}>
            {showThreadSearch ? (
              <div className="sticky top-0 z-10 -mt-1 mb-3 flex items-center gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--border)_78%,transparent)] bg-token-input-background/80 px-3 py-2 backdrop-blur-sm">
                <SearchIcon className="text-token-description-foreground" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    closeSearch();
                  }}
                  placeholder="Find in thread"
                  aria-label="Find in thread"
                  className="min-w-0 flex-1 bg-transparent text-size-chat text-token-foreground outline-none placeholder:text-token-description-foreground"
                />
                {matchedSearchUnits.length > 0 ? (
                  <div className="flex items-center gap-1.5 text-size-chat-sm text-token-description-foreground">
                    <span>{activeMatchIndex + 1}/{matchedSearchUnits.length}</span>
                    <button
                      type="button"
                      className="rounded-full p-1 hover:bg-token-foreground/5"
                      onClick={() => handleStepSearchMatch("previous")}
                      aria-label="Previous match"
                    >
                      <ChevronDownIcon className="rotate-90" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full p-1 hover:bg-token-foreground/5"
                      onClick={() => handleStepSearchMatch("next")}
                      aria-label="Next match"
                    >
                      <ChevronDownIcon className="-rotate-90" />
                    </button>
                  </div>
                ) : normalizedSearchQuery ? (
                  <div className="text-size-chat-sm text-token-description-foreground">No matches</div>
                ) : null}
              </div>
            ) : null}

            <VirtualizedTurnList
              ref={listRef}
              turns={body.turns}
              collapsedAgentBodyByTurnId={collapsedAgentBodyByTurnId}
              onAgentBodyCollapsedChange={handleAgentBodyCollapsedChange}
              matchedTurnIds={matchedTurnIds}
              matchedSearchUnitKeys={matchedSearchUnitKeys}
              activeSearchUnitKey={activeSearchUnitKey}
                projectWorkspacePath={model.projectWorkspacePath}
                threadCwd={model.conversation?.cwd ?? null}
                onEditLastUserTurn={handleEditLastUserTurn}
                onForkFromTurn={handleForkFromTurn}
                onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
              />

            {showCatchUpControl ? (
              <div className="pointer-events-none sticky bottom-4 mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={handleCatchUp}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-token-border bg-token-background px-1.5 py-1.5 text-size-chat-sm text-token-foreground shadow-card-md hover:bg-token-foreground/5"
                >
                  <DownArrowIcon className="size-4" />
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <LocalConversationForkFromTurnDialog
        open={forkDialogState !== null}
        message={forkDialogState?.message ?? ""}
        busy={isForkSubmitting}
        onOpenChange={(open) => {
          if (open) return;
          setForkDialogState(null);
        }}
        onConfirm={(skipConfirm) => {
          if (!forkDialogState) return;
          void runForkFromTurn(forkDialogState, { skipConfirm });
        }}
      />
    </>
  );
}

export function LocalConversationThreadBody({ model, actions, onErrorMessage, initialUiState }: LocalConversationThreadBodyProps) {
  return (
    <LocalConversationThreadScrollLayout
      scrollViewClassName="min-h-0 flex-1 px-panel hide-scrollbar electron:md:px-0"
      contentWrapperClassName="h-full min-h-full"
    >
      <LocalConversationThreadBodyContent
        model={model}
        actions={actions}
        onErrorMessage={onErrorMessage}
        initialUiState={initialUiState}
      />
    </LocalConversationThreadScrollLayout>
  );
}
