import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckmarkIcon,
  ChevronDownIcon,
  SearchIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import {
  readSkipForkFromOlderTurnConfirm,
  writeSkipForkFromOlderTurnConfirm,
} from "@/lib/thread-fork-confirm-settings";
import { cn } from "../../../lib/utils";
import type {
  CodexConversationSnapshot,
} from "../../../lib/types";
import {
  selectConversationTurnRequestsByTurnId,
} from "../conversation-request-helpers";
import type {
  ThreadBodyModel,
  ThreadBodyUiStateOverrides,
  ThreadStageActions,
} from "../thread-stage-types";
import { buildTurnRenderModel } from "../projection/build-turn-render-model";
import {
  LocalConversationVirtualizedTurnList,
  type LocalConversationVirtualizedTurnListApi,
  type LocalConversationVirtualizedTurnListEntry,
} from "./local-conversation-virtualized-turn-list";
import { LocalConversationAboveComposerPortal } from "./local-conversation-above-composer-portal";
import { LocalConversationForkFromTurnDialog } from "./local-conversation-fork-from-turn-dialog";
import {
  useLocalConversationThreadScrollController,
} from "./local-conversation-thread-scroll-controller";
import { LocalConversationResumeLoader } from "./shared/local-conversation-resume-loader";
import { LOCAL_CONVERSATION_CONTENT_CLASS_NAME } from "./shared/local-conversation-view-constants";
import { LocalConversationTurnEntry } from "./local-conversation-turn-entry";
import { createLocalConversationSearchSource } from "./local-conversation-search-source";

const PROGRESS_PHASES = [
  { key: "creatingWorktree", label: "Worktree" },
  { key: "runningSetup", label: "Setup" },
  { key: "startingThread", label: "Thread" },
] as const;

const DEFER_TURN_COUNT_THRESHOLD = 40;

function resolvePhaseIndex(
  phase:
    | "creatingWorktree"
    | "runningSetup"
    | "startingThread"
    | "ready"
    | "failed",
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
  progress: NonNullable<{
    phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
    message: string;
    outputText: string;
    updatedAt: number;
  }>;
  outputText: string;
  setupProgressLogRef: React.RefObject<HTMLDivElement | null>;
}) {
  const activePhaseIndex = resolvePhaseIndex(progress.phase);
  const isFailed = progress.phase === "failed";

  return (
    <div className="w-full max-w-140 px-4">
      <div className="mb-3 flex items-center gap-2">
        {!isFailed ? (
          <SpinnerIcon className="size-3.5 shrink-0 text-(--foreground-tertiary)" />
        ) : null}
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
              {index > 0 ? (
                <div
                  className={cn(
                    "mx-1 h-px w-4",
                    isComplete ? "bg-(--accent-blue)" : "bg-(--border)",
                  )}
                />
              ) : null}
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full text-[10px] font-medium transition-colors duration-200",
                    isComplete && "bg-(--accent-blue) text-white",
                    isActive &&
                      "bg-(--accent-blue)/20 text-(--accent-blue) ring-1 ring-(--accent-blue)/40",
                    !isComplete &&
                      !isActive &&
                      "bg-(--background-tertiary) text-(--foreground-tertiary)",
                    isFailed &&
                      index === activePhaseIndex &&
                      "bg-(--destructive)/15 text-(--destructive) ring-1 ring-(--destructive)/30",
                  )}
                >
                  {isComplete ? <CheckmarkIcon className="size-2.5" /> : index + 1}
                </div>
                <span
                  className={cn(
                    "text-xs",
                    isComplete && "text-(--foreground-secondary)",
                    isActive && "font-medium text-(--foreground-secondary)",
                    !isComplete &&
                      !isActive &&
                      "text-(--foreground-tertiary)",
                    isFailed &&
                      index === activePhaseIndex &&
                      "font-medium text-(--destructive)",
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
        <div
          ref={setupProgressLogRef}
          className="scrollbar-token max-h-80 min-h-28 overflow-auto p-3"
        >
          <pre className="font-mono text-xs/relaxed wrap-break-word whitespace-pre-wrap text-(--foreground-tertiary)">
            {outputText || "Preparing…\n"}
          </pre>
        </div>
      </div>
    </div>
  );
}

function DeferredThreadBodyPlaceholder() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-16 rounded-2xl bg-token-foreground/4" />
      <div className="h-32 rounded-2xl bg-token-foreground/4" />
      <div className="h-20 rounded-2xl bg-token-foreground/4" />
    </div>
  );
}

interface LocalConversationThreadBodyOwnerProps {
  body: ThreadBodyModel;
  conversation: CodexConversationSnapshot | null;
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  threadStartProgress: {
    phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
    message: string;
    outputText: string;
    updatedAt: number;
  } | null;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
  initialUiState?: ThreadBodyUiStateOverrides;
}

export function LocalConversationThreadBodyOwner({
  body,
  conversation,
  projectWorkspacePath,
  searchOpenTick,
  threadStartProgress,
  actions,
  onErrorMessage,
  initialUiState,
}: LocalConversationThreadBodyOwnerProps) {
  const {
    maybeStickToBottom,
    scrollElement,
    setScrollMode,
  } = useLocalConversationThreadScrollController();
  const setupProgressLogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastHandledSearchOpenTickRef = useRef(searchOpenTick);
  const contentRootRef = useRef<HTMLDivElement | null>(null);
  const listApiRef = useRef<LocalConversationVirtualizedTurnListApi | null>(null);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [collapsedAgentBodyByTurnId, setCollapsedAgentBodyByTurnId] = useState<
    Record<string, boolean>
  >(() => initialUiState?.collapsedAgentBodyByTurnId ?? {});
  const [forkDialogState, setForkDialogState] = useState<{
    threadId: string;
    turnId: string;
    message: string;
  } | null>(null);
  const [isForkSubmitting, setIsForkSubmitting] = useState(false);
  const [isDeferredBodyReady, setIsDeferredBodyReady] = useState(
    () =>
      !conversation ||
      conversation.turns.length < DEFER_TURN_COUNT_THRESHOLD ||
      body.emptyState.type !== "none",
  );

  const turnRequestsByTurnId = useMemo(
    () =>
      conversation
        ? selectConversationTurnRequestsByTurnId(conversation, {
            dismissedPlanImplementationTurnId:
              body.dismissedPlanImplementationTurnId,
          })
        : new Map(),
    [body.dismissedPlanImplementationTurnId, conversation],
  );
  const latestTurnId = body.latestTurnId;
  const editableTurnId =
    conversation?.capabilityFlags.canEditLastUserTurn
      ? [...conversation.turns]
          .reverse()
          .find((turn) => turn.status !== "inProgress")?.turnId ?? null
      : null;
  const canForkFromTurn =
    conversation?.capabilityFlags.canForkFromTurn ?? false;
  const turnEntries = useMemo(
    () =>
      conversation?.turns.map((turn, index) => ({
        turn,
        turnId: turn.turnId,
        turnKey: turn.turnId || `turn-index-${index}`,
        requests: turnRequestsByTurnId.get(turn.turnId) ?? [],
        isMostRecentTurn: latestTurnId === turn.turnId,
      })) ?? [],
    [conversation?.turns, latestTurnId, turnRequestsByTurnId],
  );
  const turnKeyByTurnId = useMemo(
    () =>
      new Map(turnEntries.map((entry) => [entry.turnId, entry.turnKey] as const)),
    [turnEntries],
  );
  const entryDescriptors = useMemo<LocalConversationVirtualizedTurnListEntry[]>(
    () => turnEntries.map((entry) => ({ turnKey: entry.turnKey })),
    [turnEntries],
  );

  const activeTurn = useMemo(
    () =>
      body.activeTurnId
        ? conversation?.turns.find((turn) => turn.turnId === body.activeTurnId) ?? null
        : null,
    [body.activeTurnId, conversation?.turns],
  );
  const activeTurnRenderModel = useMemo(
    () =>
      activeTurn
        ? buildTurnRenderModel({
            turn: activeTurn,
            requests: turnRequestsByTurnId.get(activeTurn.turnId) ?? [],
            isLatestTurn: latestTurnId === activeTurn.turnId,
            isStreamingTurn: true,
            canEditTurnUserPrefix: editableTurnId === activeTurn.turnId,
            canForkTurnUserPrefix:
              canForkFromTurn && activeTurn.status !== "inProgress",
          })
        : null,
    [
      activeTurn,
      canForkFromTurn,
      editableTurnId,
      latestTurnId,
      turnRequestsByTurnId,
    ],
  );
  const aboveComposerBlocks = activeTurnRenderModel?.aboveComposerBlocks ?? [];

  const currentTurnEntriesRef = useRef(turnEntries);
  currentTurnEntriesRef.current = turnEntries;

  const searchSource = useMemo(
    () =>
      createLocalConversationSearchSource({
        routeContextId: body.threadId ? `conversation:${body.threadId}` : "unavailable",
        getTurns: () => currentTurnEntriesRef.current,
        scrollAdapter: {
          scrollToTurn: async (turnKey) => {
            const turnId = currentTurnEntriesRef.current.find(
              (entry) => entry.turnKey === turnKey,
            )?.turnId;
            if (turnId && collapsedAgentBodyByTurnId[turnId] === true) {
              setCollapsedAgentBodyByTurnId((current) => ({
                ...current,
                [turnId]: false,
              }));
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                  resolve();
                });
              });
            }
            const api = listApiRef.current;
            if (!api) return;
            await api.scrollToKey(turnKey);
          },
          getTurnContainer: (turnKey) =>
            contentRootRef.current?.querySelector<HTMLElement>(
              `[data-content-search-turn-key="${turnKey}"]`,
            ) ?? null,
        },
      }),
    [body.threadId, collapsedAgentBodyByTurnId],
  );

  useEffect(() => {
    setScrollMode("stickToBottom");
    maybeStickToBottom();
  }, [body.threadId, maybeStickToBottom, setScrollMode]);

  useEffect(() => {
    setIsSearchVisible(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
    setCollapsedAgentBodyByTurnId(
      initialUiState?.collapsedAgentBodyByTurnId ?? {},
    );
    setForkDialogState(null);
    setIsForkSubmitting(false);
  }, [body.threadId, initialUiState?.collapsedAgentBodyByTurnId]);

  useEffect(() => {
    const shouldOpenSearch =
      searchOpenTick > 0 &&
      searchOpenTick !== lastHandledSearchOpenTickRef.current &&
      body.turnCount > 0 &&
      !body.showThreadStartProgressPanel &&
      body.emptyState.type === "none";

    if (!shouldOpenSearch) return;

    lastHandledSearchOpenTickRef.current = searchOpenTick;
    setIsSearchVisible(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [
    body.emptyState.type,
    body.showThreadStartProgressPanel,
    body.turnCount,
    searchOpenTick,
  ]);

  useEffect(() => {
    if (!body.showThreadStartProgressPanel) return;
    const element = setupProgressLogRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      const current = setupProgressLogRef.current;
      if (!current) return;
      current.scrollTop = current.scrollHeight;
    });
  }, [
    body.showThreadStartProgressPanel,
    threadStartProgress?.outputText,
    threadStartProgress?.updatedAt,
  ]);

  useEffect(() => {
    const shouldDefer =
      body.emptyState.type === "none" &&
      !body.showThreadStartProgressPanel &&
      body.turnCount >= DEFER_TURN_COUNT_THRESHOLD;

    if (!shouldDefer) {
      setIsDeferredBodyReady(true);
      return;
    }

    setIsDeferredBodyReady(false);
    let cancelled = false;
    const frameHandle = window.requestAnimationFrame(() => {
      if (cancelled) return;
      startTransition(() => {
        setIsDeferredBodyReady(true);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameHandle);
    };
  }, [body.emptyState.type, body.showThreadStartProgressPanel, body.threadId, body.turnCount]);

  const handleAgentBodyCollapsedChange = useCallback(
    (turnId: string, collapsed: boolean) => {
      setCollapsedAgentBodyByTurnId((current) => {
        if (current[turnId] === collapsed) return current;
        return {
          ...current,
          [turnId]: collapsed,
        };
      });
    },
    [],
  );

  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const matchedSearchUnits = useMemo(
    () => searchSource.findMatches(normalizedSearchQuery),
    [normalizedSearchQuery, searchSource],
  );
  const matchedTurnIds = useMemo(
    () => new Set(matchedSearchUnits.map((unit) => unit.turnId)),
    [matchedSearchUnits],
  );
  const matchedSearchUnitKeys = useMemo(
    () => new Set(matchedSearchUnits.map((unit) => unit.key)),
    [matchedSearchUnits],
  );
  const activeSearchUnitKey =
    matchedSearchUnits[activeMatchIndex]?.key ?? null;

  useEffect(() => {
    if (matchedSearchUnits.length === 0) {
      setActiveMatchIndex(0);
      return;
    }
    setActiveMatchIndex((current) =>
      Math.min(current, matchedSearchUnits.length - 1),
    );
  }, [matchedSearchUnits]);

  useEffect(() => {
    if (matchedSearchUnits.length === 0) return;
    const targetUnit = matchedSearchUnits[activeMatchIndex];
    if (!targetUnit) return;
    const turnKey = turnKeyByTurnId.get(targetUnit.turnId);
    if (!turnKey) return;
    void searchSource.scrollAdapter.scrollToTurn(turnKey);
  }, [activeMatchIndex, matchedSearchUnits, searchSource, turnKeyByTurnId]);

  const handleStepSearchMatch = useCallback(
    (direction: "previous" | "next") => {
      if (matchedSearchUnits.length === 0) return;
      setActiveMatchIndex((current) => {
        const delta = direction === "next" ? 1 : -1;
        return (
          (current + delta + matchedSearchUnits.length) %
          matchedSearchUnits.length
        );
      });
    },
    [matchedSearchUnits.length],
  );

  const closeSearch = useCallback(() => {
    setIsSearchVisible(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
  }, []);

  const handleEditLastUserTurn = useCallback(
    async (input: { threadId: string; turnId: string; message: string }) => {
      onErrorMessage(null);
      try {
        await actions.onEditLastUserTurn(input);
      } catch (error) {
        const nextError =
          error instanceof Error
            ? error.message
            : "Could not edit the last user message";
        onErrorMessage(nextError);
        throw error;
      }
    },
    [actions, onErrorMessage],
  );

  const runForkFromTurn = useCallback(
    async (
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
        onErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not fork the conversation",
        );
      } finally {
        setIsForkSubmitting(false);
      }
    },
    [actions, onErrorMessage],
  );

  const handleForkFromTurn = useCallback(
    async (input: {
      threadId: string;
      turnId: string;
      message: string;
      isLatestTurn: boolean;
    }) => {
      if (input.isLatestTurn || readSkipForkFromOlderTurnConfirm()) {
        await runForkFromTurn(input);
        return;
      }

      setForkDialogState({
        threadId: input.threadId,
        turnId: input.turnId,
        message: input.message,
      });
    },
    [runForkFromTurn],
  );

  const renderTurn = useCallback(
    (index: number) => {
      const entry = turnEntries[index];
      if (!entry || !conversation) return null;

      return (
        <LocalConversationTurnEntry
          conversationId={conversation.threadId}
          turnSearchKey={entry.turnKey}
          turn={entry.turn}
          requests={entry.requests}
          cwd={conversation.cwd ?? null}
          isMostRecentTurn={entry.isMostRecentTurn}
          persistedCollapsed={collapsedAgentBodyByTurnId[entry.turnId]}
          onSetCollapsed={(collapsed) => {
            handleAgentBodyCollapsedChange(entry.turnId, collapsed);
          }}
          canEditTurnUserPrefix={editableTurnId === entry.turnId}
          canForkTurnUserPrefix={
            canForkFromTurn && entry.turn.status !== "inProgress"
          }
          matchedSearchUnitKeys={matchedSearchUnitKeys}
          activeSearchUnitKey={activeSearchUnitKey}
          isMatched={matchedTurnIds.has(entry.turnId)}
          projectWorkspacePath={projectWorkspacePath}
          threadCwd={conversation.cwd ?? null}
          onEditLastTurnMessage={handleEditLastUserTurn}
          onForkTurnMessage={handleForkFromTurn}
          onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
        />
      );
    },
    [
      actions.onOpenTurnDiffReview,
      activeSearchUnitKey,
      canForkFromTurn,
      collapsedAgentBodyByTurnId,
      conversation,
      editableTurnId,
      handleAgentBodyCollapsedChange,
      handleEditLastUserTurn,
      handleForkFromTurn,
      matchedSearchUnitKeys,
      matchedTurnIds,
      projectWorkspacePath,
      turnEntries,
    ],
  );

  const showThreadSearch =
    isSearchVisible &&
    body.turnCount > 0 &&
    !body.showThreadStartProgressPanel &&
    body.emptyState.type === "none";
  const shouldRenderAboveComposerPortal =
    aboveComposerBlocks.length > 0 && body.activeTurnId !== null;

  return (
    <>
      {shouldRenderAboveComposerPortal ? (
        <LocalConversationAboveComposerPortal
          blocks={aboveComposerBlocks}
          isLatestTurn={body.latestTurnId === body.activeTurnId}
          isStreamingTurn={true}
          projectWorkspacePath={projectWorkspacePath}
          threadCwd={conversation?.cwd ?? null}
          onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
        />
      ) : null}
      <div className="flex flex-col">
        {body.showThreadStartProgressPanel && threadStartProgress ? (
          <div className="flex items-center justify-center py-10">
            <ThreadStartProgressPanel
              progress={threadStartProgress}
              outputText={threadStartProgress.outputText}
              setupProgressLogRef={setupProgressLogRef}
            />
          </div>
        ) : body.emptyState.type === "newThread" || body.emptyState.type === "noThread" ? (
          <div className="flex items-center justify-center py-16">
            <div className="max-w-95 space-y-2 px-6 text-center">
              <div className="text-base font-medium text-(--foreground-tertiary)">
                {body.emptyState.title}
              </div>
              <div className="text-sm/normal text-(--foreground-tertiary) opacity-60">
                {body.emptyState.description}
              </div>
            </div>
          </div>
        ) : body.emptyState.type === "emptyThread" ? (
          <div className="flex items-center justify-center py-16">
            <div className="space-y-1 px-6 text-center">
              <div className="text-base font-medium text-(--foreground-tertiary)">
                {body.emptyState.title}
              </div>
              <div className="text-sm text-(--foreground-tertiary) opacity-60">
                {body.emptyState.description}
              </div>
            </div>
          </div>
        ) : body.emptyState.type === "resumingThread" ? (
          <LocalConversationResumeLoader
            title={body.emptyState.title}
            description={body.emptyState.description}
          />
        ) : (
          <div
            ref={contentRootRef}
            data-thread-find-target="conversation"
            className={LOCAL_CONVERSATION_CONTENT_CLASS_NAME}
          >
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
                    <span>
                      {activeMatchIndex + 1}/{matchedSearchUnits.length}
                    </span>
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
                  <div className="text-size-chat-sm text-token-description-foreground">
                    No matches
                  </div>
                ) : null}
              </div>
            ) : null}

            {isDeferredBodyReady ? (
              <LocalConversationVirtualizedTurnList
                entries={entryDescriptors}
                scrollElement={scrollElement}
                onApiChange={(api) => {
                  listApiRef.current = api;
                }}
                renderTurn={renderTurn}
              />
            ) : (
              <DeferredThreadBodyPlaceholder />
            )}
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
