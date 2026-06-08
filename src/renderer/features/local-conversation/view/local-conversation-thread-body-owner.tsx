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
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import {
  readSkipForkFromOlderTurnConfirm,
  writeSkipForkFromOlderTurnConfirm,
} from "@/lib/thread-fork-confirm-settings";
import { cn } from "../../../lib/utils";
import type {
  CodexConversationCapabilityFlags,
  CodexConversationResumeState,
  CodexConversationServerRequest,
  CodexConversationTurn,
  CodexThreadStatusType,
} from "../../../lib/types";
import { selectVisibleConversationTurnEntries } from "../selectors";
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
import { createLocalConversationSearchSource } from "./local-conversation-search-source";
import { applyThreadSearchDomMarks } from "./local-conversation-thread-search-dom-marks";

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
  projectId: string;
  threadId: string | null;
  cwd: string | null;
  turns: CodexConversationTurn[];
  requests: CodexConversationServerRequest[];
  resumeState: CodexConversationResumeState | null;
  capabilityFlags: CodexConversationCapabilityFlags;
  statusType: CodexThreadStatusType | null;
  parentTurns: readonly CodexConversationTurn[];
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
  projectId,
  threadId,
  cwd,
  turns,
  requests,
  resumeState,
  capabilityFlags,
  statusType,
  parentTurns,
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
  const [isRestoringArchivedThread, setIsRestoringArchivedThread] = useState(false);
  const [isDeferredBodyReady, setIsDeferredBodyReady] = useState(
    () =>
      !threadId ||
      body.turnCount < DEFER_TURN_COUNT_THRESHOLD ||
      body.emptyState.type !== "none",
  );
  const matchedSearchUnitKeysRef = useRef<ReadonlySet<string>>(new Set());
  const matchedTurnKeysRef = useRef<ReadonlySet<string>>(new Set());
  const activeSearchUnitKeyRef = useRef<string | null>(null);
  const conversation = useMemo(
    () =>
      threadId
        ? {
            threadId,
            projectId: null,
            cardId: null,
            source: null,
            threadName: null,
            threadPreview: "",
            modelProvider: "",
            cwd,
            statusType: statusType ?? (resumeState === "resumed" ? "idle" : "notLoaded"),
            statusActiveFlags: [],
            archived: false,
            createdAt: 0,
            updatedAt: 0,
            linkedAt: "",
            latestCollaborationMode: undefined,
            resumeState: resumeState ?? "needs_resume",
            turns,
            requests,
            queuedFollowUps: [],
            pendingSteers: [],
            backgroundTerminalRows: [],
            childMemberships: [],
            capabilityFlags,
          }
        : null,
    [capabilityFlags, cwd, requests, resumeState, statusType, threadId, turns],
  );

  const latestTurnId = body.latestTurnId;
  const editableTurnId =
    capabilityFlags.canEditLastUserTurn
      ? [...turns]
          .reverse()
          .find((turn) => turn.status !== "inProgress")?.turnId ?? null
      : null;
  const canForkFromTurn =
    capabilityFlags.canForkFromTurn;
  const turnEntries = useMemo(
    () => selectVisibleConversationTurnEntries({
      conversation,
      parentTurns,
    }),
    [conversation, parentTurns],
  );
  const virtualizedEntries = useMemo<LocalConversationVirtualizedTurnListEntry[]>(
    () => turnEntries,
    [turnEntries],
  );
  const turnKeyByTurnId = useMemo(
    () => new Map(turnEntries.map((entry) => [entry.turnId, entry.turnKey] as const)),
    [turnEntries],
  );

  const activeTurnRenderModel = useMemo(
    () => {
      const activeEntry = body.activeTurnId
        ? turnEntries.find((entry) => entry.turnId === body.activeTurnId) ?? null
        : null;
      if (!activeEntry) {
        return null;
      }

      return buildTurnRenderModel({
        turn: activeEntry.turn,
        requests: activeEntry.requests,
        isLatestTurn: latestTurnId === activeEntry.turnId,
        isStreamingTurn: true,
        canEditTurnUserPrefix: editableTurnId === activeEntry.turnId,
        canForkTurn:
          canForkFromTurn && activeEntry.turn.status !== "inProgress",
      });
    },
    [
      body.activeTurnId,
      turnEntries,
      canForkFromTurn,
      editableTurnId,
      latestTurnId,
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

  const syncSearchMarks = useCallback(() => {
    const root = contentRootRef.current;
    if (!root) return;
    applyThreadSearchDomMarks({
      root,
      matchedSearchUnitKeys: matchedSearchUnitKeysRef.current,
      matchedTurnKeys: matchedTurnKeysRef.current,
      activeSearchUnitKey: activeSearchUnitKeyRef.current,
    });
  }, []);

  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const matchedSearchUnits = useMemo(
    () => searchSource.findMatches(normalizedSearchQuery),
    [normalizedSearchQuery, searchSource],
  );
  const matchedSearchUnitKeys = useMemo(
    () => new Set(matchedSearchUnits.map((unit) => unit.key)),
    [matchedSearchUnits],
  );
  const matchedTurnKeys = useMemo(
    () =>
      new Set(
        matchedSearchUnits.flatMap((unit) => {
          const turnKey = turnKeyByTurnId.get(unit.turnId);
          return turnKey ? [turnKey] : [];
        }),
      ),
    [matchedSearchUnits, turnKeyByTurnId],
  );
  const activeSearchUnitKey =
    matchedSearchUnits[activeMatchIndex]?.key ?? null;

  useEffect(() => {
    matchedSearchUnitKeysRef.current = matchedSearchUnitKeys;
    matchedTurnKeysRef.current = matchedTurnKeys;
    activeSearchUnitKeyRef.current = activeSearchUnitKey;
    syncSearchMarks();
  }, [
    activeSearchUnitKey,
    matchedSearchUnitKeys,
    matchedTurnKeys,
    syncSearchMarks,
  ]);

  useEffect(() => {
    const root = contentRootRef.current;
    if (!root || typeof MutationObserver === "undefined") {
      return;
    }

    const observer = new MutationObserver(() => {
      syncSearchMarks();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [body.threadId, syncSearchMarks]);

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

  const handleRestoreArchivedThread = useCallback(async () => {
    if (!threadId || isRestoringArchivedThread) return;

    setIsRestoringArchivedThread(true);
    onErrorMessage(null);
    try {
      await actions.onUnarchiveThread(threadId, projectId);
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRestoringArchivedThread(false);
    }
  }, [actions, isRestoringArchivedThread, onErrorMessage, projectId, threadId]);

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
          threadCwd={cwd}
          onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
          onOpenSideChat={actions.onOpenSideChat}
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
        ) : body.emptyState.type === "archivedThread" ? (
          <div className="flex items-center justify-center py-16">
            <div className="space-y-3 px-6 text-center">
              <div className="space-y-1">
                <div className="text-base font-medium text-(--foreground-tertiary)">
                  {body.emptyState.title}
                </div>
                <div className="text-sm text-(--foreground-tertiary) opacity-60">
                  {body.emptyState.description}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRestoreArchivedThread()}
                disabled={isRestoringArchivedThread || !threadId}
                className="mx-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-token-foreground px-3 text-sm font-medium text-token-background transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
              >
                {isRestoringArchivedThread ? (
                  <SpinnerIcon className="icon-xs animate-spin" />
                ) : (
                  <RefreshIcon className="icon-xs" />
                )}
                Restore
              </button>
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
                entries={virtualizedEntries}
                conversationId={conversation?.threadId ?? body.threadId ?? ""}
                threadCwd={conversation?.cwd ?? null}
                projectWorkspacePath={projectWorkspacePath}
                editableTurnId={editableTurnId}
                canForkFromTurn={canForkFromTurn}
                collapsedAgentBodyByTurnId={collapsedAgentBodyByTurnId}
                onSetTurnCollapsed={handleAgentBodyCollapsedChange}
                onEditLastTurnMessage={handleEditLastUserTurn}
                onForkTurnMessage={handleForkFromTurn}
                onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
                onOpenSideChat={actions.onOpenSideChat}
                scrollElement={scrollElement}
                onApiChange={(api) => {
                  listApiRef.current = api;
                }}
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
