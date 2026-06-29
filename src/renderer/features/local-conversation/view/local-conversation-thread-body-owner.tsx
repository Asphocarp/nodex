import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckmarkIcon,
  RefreshIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import {
  useRegisterContentSearchSource,
  type ContentSearchLocalMatch,
  type ContentSearchLocalSource,
} from "@/features/content-search/content-search-context";
import {
  CONTENT_SEARCH_ACTIVE_MARK_CLASS,
  CONTENT_SEARCH_MARK_CLASS,
  applyContentSearchDomMarks,
  clearContentSearchMarks,
} from "@/features/content-search/content-search-dom";
import {
  readSkipForkFromOlderTurnConfirm,
  writeSkipForkFromOlderTurnConfirm,
} from "@/lib/thread-fork-confirm-settings";
import { cn } from "../../../lib/utils";
import type {
  CardRunInTarget,
  CodexConversationCapabilityFlags,
  CodexConversationResumeState,
  CodexConversationServerRequest,
  CodexConversationTurn,
  CodexConversationTurnPagination,
  CodexThreadStatusType,
} from "../../../lib/types";
import { requestLocalConversationOlderTurns } from "../local-conversation-store";
import { selectVisibleConversationTurnEntries } from "../selectors";
import type {
  ThreadBodyModel,
  ThreadBodyUiStateOverrides,
  ThreadStageActions,
} from "../thread-stage-types";
import { buildTurnRenderModel } from "../projection/build-turn-render-model";
import { buildThreadUserMessageNavigationItems } from "../projection/thread-user-message-navigation-items";
import {
  LocalConversationVirtualizedTurnList,
  type LocalConversationVirtualizedTurnListApi,
  type LocalConversationVirtualizedTurnListEntry,
} from "./local-conversation-virtualized-turn-list";
import type { ThreadUserMessageNavigationItem } from "../thread-stage-types";
import { LocalConversationAboveComposerPortal } from "./local-conversation-above-composer-portal";
import { LocalConversationForkFromTurnDialog } from "./local-conversation-fork-from-turn-dialog";
import {
  useLocalConversationThreadScrollController,
} from "./local-conversation-thread-scroll-controller";
import {
  readLocalConversationVirtualizedTurnRestoreSnapshot,
  writeLocalConversationVirtualizedTurnRestoreSnapshot,
  type LocalConversationVirtualizedTurnRestoreSnapshot,
} from "./local-conversation-virtualized-turn-restore-store";
import type {
  VirtualizedLatestTurnRestoreState,
  VirtualizedTurnListRestoreState,
} from "./local-conversation-turn-virtualization";
import { LocalConversationResumeLoader } from "./shared/local-conversation-resume-loader";
import { LOCAL_CONVERSATION_CONTENT_CLASS_NAME } from "./shared/local-conversation-view-constants";
import { createLocalConversationSearchSource } from "./local-conversation-search-source";
import { ThreadUserMessageNavigationRailLazy } from "./thread-user-message-navigation-rail-lazy";

const PROGRESS_PHASES = [
  { key: "creatingWorktree", label: "Worktree" },
  { key: "runningSetup", label: "Setup" },
  { key: "startingThread", label: "Thread" },
] as const;

const DEFER_TURN_COUNT_THRESHOLD = 40;

function countNeedleOccurrences(text: string, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let cursor = 0;
  while (cursor < haystack.length) {
    const index = haystack.indexOf(normalizedQuery, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + normalizedQuery.length;
  }
  return count;
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isConversationSearchMatchMeta(
  value: unknown,
): value is { unitKey: string; turnId: string; occurrenceIndex: number } {
  if (!value || typeof value !== "object") return false;
  const meta = value as { unitKey?: unknown; turnId?: unknown; occurrenceIndex?: unknown };
  return typeof meta.unitKey === "string"
    && typeof meta.turnId === "string"
    && typeof meta.occurrenceIndex === "number";
}

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
    runInTarget: CardRunInTarget;
    threadId?: string | null;
    phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
    message: string;
    outputText: string;
    updatedAt: number;
  }>;
  outputText: string;
  setupProgressLogRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isWorktreeProgress =
    progress.runInTarget === "newWorktree" ||
    progress.phase === "creatingWorktree" ||
    progress.phase === "runningSetup";
  const activePhaseIndex = resolvePhaseIndex(progress.phase);
  const isFailed = progress.phase === "failed";

  if (!isWorktreeProgress) {
    return (
      <div className="w-full max-w-95 px-6 text-center">
        <div
          className={cn(
            "inline-flex min-h-8 items-center gap-2 rounded-full border-[0.5px] px-3 py-1.5 text-sm font-medium",
            isFailed
              ? "border-(--destructive)/25 bg-(--destructive)/8 text-(--destructive)"
              : "border-(--border) bg-(--background-secondary) text-(--foreground-secondary)",
          )}
        >
          {isFailed ? (
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-(--destructive)/15 text-[11px] leading-none">
              !
            </span>
          ) : progress.phase === "ready" ? (
            <CheckmarkIcon className="size-3.5 shrink-0 text-(--accent-blue)" />
          ) : (
            <SpinnerIcon className="size-3.5 shrink-0 text-(--foreground-tertiary)" />
          )}
          <span>{progress.message || (isFailed ? "Message could not be sent." : "Sending message…")}</span>
        </div>
        {isFailed && outputText.trim().length > 0 ? (
          <pre className="scrollbar-token mt-3 max-h-32 overflow-auto rounded-lg border-[0.5px] border-(--border) bg-(--background-secondary) p-3 text-left font-mono text-xs/relaxed wrap-break-word whitespace-pre-wrap text-(--foreground-tertiary)">
            {outputText}
          </pre>
        ) : null}
      </div>
    );
  }

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
  turnPagination: CodexConversationTurnPagination | null;
  requests: CodexConversationServerRequest[];
  resumeState: CodexConversationResumeState | null;
  capabilityFlags: CodexConversationCapabilityFlags;
  statusType: CodexThreadStatusType | null;
  parentTurns: readonly CodexConversationTurn[];
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  threadStartProgress: {
    runInTarget: CardRunInTarget;
    threadId?: string | null;
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
  turnPagination,
  requests,
  resumeState,
  capabilityFlags,
  statusType,
  parentTurns,
  projectWorkspacePath,
  threadStartProgress,
  actions,
  onErrorMessage,
  initialUiState,
}: LocalConversationThreadBodyOwnerProps) {
  const {
    getLastScrollDistanceFromBottomPx,
    maybeStickToBottom,
    scrollElement,
    scrollToDistanceFromBottomPx,
    setScrollMode,
  } = useLocalConversationThreadScrollController();
  const restoreSnapshotRef = useRef<{
    snapshot: LocalConversationVirtualizedTurnRestoreSnapshot | null;
    threadId: string | null;
  } | null>(null);
  if (restoreSnapshotRef.current?.threadId !== threadId) {
    restoreSnapshotRef.current = {
      snapshot: readLocalConversationVirtualizedTurnRestoreSnapshot(threadId),
      threadId,
    };
  }
  const initialRestoreSnapshot = restoreSnapshotRef.current.snapshot;
  const setupProgressLogRef = useRef<HTMLDivElement>(null);
  const contentRootRef = useRef<HTMLDivElement | null>(null);
  const listApiRef = useRef<LocalConversationVirtualizedTurnListApi | null>(null);
  const virtualizedTurnRestoreStateRef =
    useRef<VirtualizedTurnListRestoreState | null>(
      initialRestoreSnapshot?.virtualizedTurnList ?? null,
    );
  const latestTurnRestoreStateRef =
    useRef<VirtualizedLatestTurnRestoreState | null>(
      initialRestoreSnapshot?.latestTurn ?? null,
    );
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
  const [isOlderHistoryLoading, setIsOlderHistoryLoading] = useState(false);
  const [isDeferredBodyReady, setIsDeferredBodyReady] = useState(
    () =>
      !threadId ||
      body.turnCount < DEFER_TURN_COUNT_THRESHOLD ||
      body.emptyState.type !== "none",
  );
  const conversation = useMemo(
    () =>
      threadId
        ? {
            threadId,
            projectId: null,
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
            turnPagination: turnPagination ?? undefined,
            turns,
            requests,
            queuedFollowUps: [],
            pendingSteers: [],
            backgroundTerminalRows: [],
            childMemberships: [],
            capabilityFlags,
          }
        : null,
    [capabilityFlags, cwd, requests, resumeState, statusType, threadId, turnPagination, turns],
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
  const userMessageNavigationItems = useMemo(
    () => isDeferredBodyReady
      ? buildThreadUserMessageNavigationItems(turnEntries)
      : [],
    [isDeferredBodyReady, turnEntries],
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

  useEffect(() => {
    virtualizedTurnRestoreStateRef.current =
      initialRestoreSnapshot?.virtualizedTurnList ?? null;
    latestTurnRestoreStateRef.current =
      initialRestoreSnapshot?.latestTurn ?? null;
  }, [
    body.threadId,
    initialRestoreSnapshot?.latestTurn,
    initialRestoreSnapshot?.virtualizedTurnList,
  ]);

  const writeRestoreSnapshot = useCallback(
    (input?: {
      latestTurn?: VirtualizedLatestTurnRestoreState | null;
      virtualizedTurnList?: VirtualizedTurnListRestoreState | null;
    }) => {
      if (!threadId) return;
      const latestTurn =
        input && "latestTurn" in input
          ? input.latestTurn ?? null
          : latestTurnRestoreStateRef.current;
      const virtualizedTurnList =
        input && "virtualizedTurnList" in input
          ? input.virtualizedTurnList ?? null
          : virtualizedTurnRestoreStateRef.current;
      writeLocalConversationVirtualizedTurnRestoreSnapshot(threadId, {
        distanceFromBottomPx: getLastScrollDistanceFromBottomPx(),
        latestTurn,
        virtualizedTurnList,
      });
    },
    [getLastScrollDistanceFromBottomPx, threadId],
  );

  const handleVirtualizedTurnRestoreStateChange = useCallback(
    (state: VirtualizedTurnListRestoreState | null) => {
      virtualizedTurnRestoreStateRef.current = state;
      writeRestoreSnapshot({ virtualizedTurnList: state });
    },
    [writeRestoreSnapshot],
  );

  const handleLatestTurnRestoreStateChange = useCallback(
    (state: VirtualizedLatestTurnRestoreState | null) => {
      latestTurnRestoreStateRef.current = state;
      writeRestoreSnapshot({ latestTurn: state });
    },
    [writeRestoreSnapshot],
  );

  const handleLoadOlderTurns = useCallback(async () => {
    const targetThreadId = threadId ?? body.threadId;
    if (!targetThreadId || turnPagination?.historyComplete === true) {
      return "stop";
    }

    setIsOlderHistoryLoading(true);
    try {
      const snapshot = await requestLocalConversationOlderTurns(targetThreadId);
      return snapshot?.turnPagination?.historyComplete === true ? "stop" : "continue";
    } finally {
      setIsOlderHistoryLoading(false);
    }
  }, [body.threadId, threadId, turnPagination?.historyComplete]);

  useEffect(
    () => () => {
      writeRestoreSnapshot();
    },
    [writeRestoreSnapshot],
  );

  const searchSource = useMemo(
    () =>
      createLocalConversationSearchSource({
        routeContextId: body.threadId ? `conversation:${body.threadId}` : "unavailable",
        getTurns: () => currentTurnEntriesRef.current,
        scrollAdapter: {
          scrollToTurn: async (turnKey, options) => {
            if (options?.signal?.aborted) return;
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
              if (options?.signal?.aborted) return;
            }
            const api = listApiRef.current;
            if (!api) return;
            await api.scrollToKey(turnKey);
            if (options?.signal?.aborted) return;
            await nextAnimationFrame();
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
    const restoredDistanceFromBottomPx =
      initialRestoreSnapshot?.distanceFromBottomPx ?? 0;
    if (restoredDistanceFromBottomPx > 0) {
      setScrollMode("user");
      const frameHandle = window.requestAnimationFrame(() => {
        scrollToDistanceFromBottomPx(restoredDistanceFromBottomPx, "auto");
      });
      return () => {
        window.cancelAnimationFrame(frameHandle);
      };
    }

    setScrollMode("stickToBottom");
    maybeStickToBottom();
    return undefined;
  }, [
    body.threadId,
    initialRestoreSnapshot?.distanceFromBottomPx,
    maybeStickToBottom,
    scrollElement,
    scrollToDistanceFromBottomPx,
    setScrollMode,
  ]);

  useEffect(() => {
    clearContentSearchMarks(contentRootRef.current);
    setCollapsedAgentBodyByTurnId(
      initialUiState?.collapsedAgentBodyByTurnId ?? {},
    );
    setForkDialogState(null);
    setIsForkSubmitting(false);
  }, [body.threadId, initialUiState?.collapsedAgentBodyByTurnId]);

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

  const contentSearchSource = useMemo<ContentSearchLocalSource>(() => ({
    domain: "conversation",
    contextId: searchSource.routeContextId,
    search(query, limit) {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return { query, matches: [], totalMatches: 0, capped: false };
      }

      const matches: ContentSearchLocalMatch[] = [];
      let capped = false;
      for (const unit of searchSource.findMatches(normalizedQuery)) {
        const occurrenceCount = countNeedleOccurrences(unit.text, normalizedQuery);
        for (let occurrenceIndex = 0; occurrenceIndex < occurrenceCount; occurrenceIndex += 1) {
          if (matches.length >= limit) {
            capped = true;
            break;
          }
          matches.push({
            id: `conversation:${unit.key}:${occurrenceIndex}`,
            domain: "conversation",
            contextId: searchSource.routeContextId,
            ordinal: matches.length,
            label: unit.text,
            meta: {
              unitKey: unit.key,
              turnId: unit.turnId,
              occurrenceIndex,
            },
          });
        }
        if (capped) break;
      }

      return {
        query,
        matches,
        totalMatches: matches.length,
        capped,
      };
    },
    async ensureVisible(match, { signal }) {
      if (!isConversationSearchMatchMeta(match.meta)) return;
      const turnKey = turnKeyByTurnId.get(match.meta.turnId);
      if (turnKey) {
        await searchSource.scrollAdapter.scrollToTurn(turnKey, { signal });
      }
    },
    activate(match, query) {
      if (!isConversationSearchMatchMeta(match.meta)) return;
      const root = contentRootRef.current;
      if (!root) return;
      const result = applyContentSearchDomMarks({
        root,
        query,
        idPrefix: "content-search:conversation",
      });
      const unitSelector = `[data-content-search-unit-key="${escapeAttributeSelectorValue(match.meta.unitKey)}"]`;
      const unitElement = root.querySelector<HTMLElement>(unitSelector);
      const unitMarks = Array.from(unitElement?.querySelectorAll<HTMLElement>(`mark.${CONTENT_SEARCH_MARK_CLASS}`) ?? []);
      const activeElement = unitMarks[match.meta.occurrenceIndex] ?? unitMarks[0] ?? result.matches[0]?.element ?? null;
      if (!activeElement) return;
      activeElement.classList.add(CONTENT_SEARCH_ACTIVE_MARK_CLASS);
      activeElement.scrollIntoView({ block: "center", inline: "nearest" });
    },
    clear() {
      clearContentSearchMarks(contentRootRef.current);
    },
  }), [searchSource, turnKeyByTurnId]);
  useRegisterContentSearchSource(contentSearchSource);

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

  const handleRevealUserMessageNavigationItem = useCallback(
    async (item: ThreadUserMessageNavigationItem): Promise<HTMLElement | null> => {
      const unitSelector =
        `[data-content-search-unit-key="${escapeAttributeSelectorValue(item.id)}"]`;
      const api = listApiRef.current;
      if (api) {
        await api.scrollToKey(
          item.turnKey,
          (turnElement) => turnElement.querySelector<HTMLElement>(unitSelector),
        );
        await nextAnimationFrame();
      }

      return contentRootRef.current?.querySelector<HTMLElement>(unitSelector) ?? null;
    },
    [],
  );

  const shouldRenderAboveComposerPortal =
    aboveComposerBlocks.length > 0 && body.activeTurnId !== null;

  return (
    <>
      <ThreadUserMessageNavigationRailLazy
        items={userMessageNavigationItems}
        onRevealItem={handleRevealUserMessageNavigationItem}
      />
      {shouldRenderAboveComposerPortal ? (
        <LocalConversationAboveComposerPortal
          blocks={aboveComposerBlocks}
          isLatestTurn={body.latestTurnId === body.activeTurnId}
          isStreamingTurn={true}
          projectWorkspacePath={projectWorkspacePath}
          threadCwd={cwd}
          onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
          onOpenSideChat={actions.onOpenSideChat}
          onOpenThread={actions.onOpenThread}
          onOpenMcpAppSidePanel={actions.onOpenMcpAppSidePanel}
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
                onOpenThread={actions.onOpenThread}
                onOpenMcpAppSidePanel={actions.onOpenMcpAppSidePanel}
                initialRestoreState={initialRestoreSnapshot?.virtualizedTurnList ?? null}
                initialLatestTurnRestoreState={initialRestoreSnapshot?.latestTurn ?? null}
                latestTurnSynchronousMeasurementKey={body.latestTurnId ?? body.turnCount}
                onLatestTurnRestoreStateChange={handleLatestTurnRestoreStateChange}
                onRestoreStateChange={handleVirtualizedTurnRestoreStateChange}
                onLoadOlderTurns={handleLoadOlderTurns}
                isHistoryComplete={turnPagination?.historyComplete ?? true}
                isOlderHistoryLoading={isOlderHistoryLoading}
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
