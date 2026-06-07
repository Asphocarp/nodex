import type {
  CodexConversationCapabilityFlags,
  CodexConversationSnapshot,
  CodexConversationResumeState,
  CodexConversationServerRequest,
  CodexConversationTurn,
  CodexThreadStatusType,
} from "../../../lib/types";
import type { ThreadBodyModel } from "../thread-stage-types";
import { buildTurnRenderModel } from "./build-turn-render-model";
import { selectVisibleConversationTurnEntries } from "../selectors";

interface BuildThreadBodyModelInput {
  activeThreadId: string | null;
  threadId: string | null;
  turns: CodexConversationTurn[];
  requests: CodexConversationServerRequest[];
  resumeState: CodexConversationResumeState | null;
  statusType: CodexThreadStatusType | null;
  capabilityFlags: CodexConversationCapabilityFlags;
  parentTurns: readonly CodexConversationTurn[];
  isNewThreadTab: boolean;
  newThreadTarget: {
    projectId: string;
    projectName: string;
    cardId?: string;
    cardTitle?: string;
    columnId?: string;
    sessionId?: string;
    threadTitle?: string;
    runInTarget?: "localProject" | "newWorktree" | "cloud";
  } | null;
  isCloudNewThreadTarget: boolean;
  threadStartProgress: {
    phase: "creatingWorktree" | "runningSetup" | "startingThread" | "ready" | "failed";
    message: string;
    outputText: string;
    updatedAt: number;
  } | null;
}

interface LegacyBuildThreadBodyModelInput {
  activeThreadId: string | null;
  conversation: CodexConversationSnapshot | null;
  parentTurns: readonly CodexConversationTurn[];
  isNewThreadTab: boolean;
  newThreadTarget: BuildThreadBodyModelInput["newThreadTarget"];
  isCloudNewThreadTarget: boolean;
  threadStartProgress: BuildThreadBodyModelInput["threadStartProgress"];
}

export type ThreadBodyModelInput =
  | BuildThreadBodyModelInput
  | LegacyBuildThreadBodyModelInput;

function normalizeBuildThreadBodyModelInput(input: ThreadBodyModelInput): BuildThreadBodyModelInput {
  if ("conversation" in input) {
    return {
      activeThreadId: input.activeThreadId,
      threadId: input.conversation?.threadId ?? input.activeThreadId,
      turns: input.conversation?.turns ?? [],
      requests: input.conversation?.requests ?? [],
      resumeState: input.conversation?.resumeState ?? null,
      statusType: input.conversation?.statusType ?? null,
      capabilityFlags: input.conversation?.capabilityFlags ?? {
        canEditLastUserTurn: false,
        canForkFromTurn: false,
        canSearch: false,
        canCollapseTurns: false,
      },
      parentTurns: input.parentTurns,
      isNewThreadTab: input.isNewThreadTab,
      newThreadTarget: input.newThreadTarget,
      isCloudNewThreadTarget: input.isCloudNewThreadTarget,
      threadStartProgress: input.threadStartProgress,
    };
  }

  return input;
}

function buildBodyConversation(input: BuildThreadBodyModelInput) {
  if (!input.threadId) {
    return null;
  }

  return {
    threadId: input.threadId,
    projectId: null,
    cardId: null,
    source: null,
    threadName: null,
    threadPreview: "",
    modelProvider: "",
    cwd: null,
    statusType: input.statusType ?? "notLoaded",
    statusActiveFlags: [],
    archived: false,
    createdAt: 0,
    updatedAt: 0,
    linkedAt: "",
    latestCollaborationMode: undefined,
    resumeState: input.resumeState ?? "needs_resume",
    turns: input.turns,
    requests: input.requests,
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: input.capabilityFlags,
  };
}

function resolveActiveTurnId(
  conversation: ReturnType<typeof buildBodyConversation>,
  parentTurns: readonly CodexConversationTurn[],
): string | null {
  const visibleEntries = selectVisibleConversationTurnEntries({
    conversation,
    parentTurns,
  });
  return [...visibleEntries].reverse().find((entry) => entry.turn.status === "inProgress")?.turnId ?? null;
}

function resolveLatestTurnId(
  conversation: ReturnType<typeof buildBodyConversation>,
  parentTurns: readonly CodexConversationTurn[],
): string | null {
  const visibleEntries = selectVisibleConversationTurnEntries({
    conversation,
    parentTurns,
  });
  return visibleEntries[visibleEntries.length - 1]?.turnId ?? null;
}

function resolveVisibleTurnCount(
  conversation: NonNullable<ReturnType<typeof buildBodyConversation>>,
  parentTurns: readonly CodexConversationTurn[],
): number {
  return selectVisibleConversationTurnEntries({
    conversation,
    parentTurns,
  }).length;
}

function resolveHasAboveComposerBlocks(
  conversation: NonNullable<ReturnType<typeof buildBodyConversation>>,
  parentTurns: readonly CodexConversationTurn[],
  activeTurnId: string | null,
  latestTurnId: string | null,
): boolean {
  if (!activeTurnId) return false;

  const visibleEntry = selectVisibleConversationTurnEntries({
    conversation,
    parentTurns,
  }).find((entry) => entry.turnId === activeTurnId);
  if (!visibleEntry) return false;

  const renderedTurn = buildTurnRenderModel({
    turn: visibleEntry.turn,
    requests: visibleEntry.requests,
    isLatestTurn: latestTurnId === activeTurnId,
    isStreamingTurn: true,
    canEditTurnUserPrefix: false,
    canForkTurn: false,
  });

  return (renderedTurn.aboveComposerBlocks?.length ?? 0) > 0;
}

export function buildThreadBodyModel(input: ThreadBodyModelInput): ThreadBodyModel {
  const normalized = normalizeBuildThreadBodyModelInput(input);
  const conversation = buildBodyConversation(normalized);
  const resumeState = normalized.resumeState;
  const showThreadStartProgressPanel = Boolean(
    normalized.isNewThreadTab && !conversation && normalized.newThreadTarget && normalized.threadStartProgress,
  );

  if (!conversation) {
    if (normalized.activeThreadId && resumeState) {
      return {
        threadId: normalized.activeThreadId,
        turnCount: 0,
        hasAboveComposerBlocks: false,
        isThreadRunning: false,
        activeTurnId: null,
        latestTurnId: null,
        showThreadStartProgressPanel: false,
        emptyState: {
          type: "resumingThread",
          title: resumeState === "resuming" ? "Restoring thread" : "Preparing thread",
          description:
            resumeState === "resuming"
              ? "Loading the latest conversation state before rendering the thread."
              : "This thread needs to resume before the mounted conversation view can render.",
          status: resumeState,
        },
      };
    }

    if (normalized.isNewThreadTab) {
      return {
        threadId: null,
        turnCount: 0,
        hasAboveComposerBlocks: false,
        isThreadRunning: false,
        activeTurnId: null,
        latestTurnId: null,
        showThreadStartProgressPanel,
        emptyState: {
          type: "newThread",
          title: "Start a new thread",
          description: normalized.newThreadTarget
            ? normalized.isCloudNewThreadTarget
              ? "Cloud run target is mock-only right now. Change the card Run in property to Local project or New worktree."
              : normalized.newThreadTarget.sessionId
                ? "Write the first prompt and send to create a new session thread."
                : "Write the first prompt and send to create a new card-linked thread."
            : "Select a card in the Cards stage, then press New in its Threads property.",
        },
      };
    }

    return {
      threadId: null,
      turnCount: 0,
      hasAboveComposerBlocks: false,
      isThreadRunning: false,
      activeTurnId: null,
      latestTurnId: null,
      showThreadStartProgressPanel,
      emptyState: {
        type: "noThread",
        title: "No thread selected",
        description: "Select a thread from the sidebar to view the conversation.",
      },
    };
  }

  if (conversation.resumeState !== "resumed") {
    return {
      threadId: conversation.threadId,
      turnCount: 0,
      hasAboveComposerBlocks: false,
      isThreadRunning: false,
      activeTurnId: null,
      latestTurnId: null,
      showThreadStartProgressPanel: false,
      emptyState: {
        type: "resumingThread",
        title:
          conversation.resumeState === "resuming"
            ? "Restoring thread"
            : "Preparing thread",
        description:
          conversation.resumeState === "resuming"
            ? "Loading the latest conversation state before rendering the thread."
            : "This thread needs to resume before the mounted conversation view can render.",
        status: conversation.resumeState,
      },
    };
  }

  const activeTurnId = resolveActiveTurnId(conversation, normalized.parentTurns);
  const latestTurnId = resolveLatestTurnId(conversation, normalized.parentTurns);
  const visibleTurnCount = resolveVisibleTurnCount(conversation, normalized.parentTurns);
  const isThreadRunning =
    conversation.statusType === "active" || activeTurnId !== null;

  if (visibleTurnCount === 0) {
    return {
      threadId: conversation.threadId,
      turnCount: 0,
      hasAboveComposerBlocks: false,
      isThreadRunning,
      activeTurnId,
      latestTurnId,
      showThreadStartProgressPanel,
      emptyState: {
        type: "emptyThread",
        title: "No messages yet",
        description: "Send a prompt to begin.",
      },
    };
  }

  return {
    threadId: conversation.threadId,
    turnCount: visibleTurnCount,
    hasAboveComposerBlocks: resolveHasAboveComposerBlocks(
      conversation,
      normalized.parentTurns,
      activeTurnId,
      latestTurnId,
    ),
    isThreadRunning,
    activeTurnId,
    latestTurnId,
    showThreadStartProgressPanel,
    emptyState: { type: "none" },
  };
}
