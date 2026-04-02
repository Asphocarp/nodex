import type { CodexConversationSnapshot } from "../../../lib/types";
import { selectConversationTurnRequestsByTurnId } from "../conversation-request-helpers";
import type { ThreadBodyModel } from "../thread-stage-types";
import { buildTurnRenderModel } from "./build-turn-render-model";

interface BuildThreadBodyModelInput {
  activeThreadId: string | null;
  conversation: CodexConversationSnapshot | null;
  dismissedPlanImplementationTurnIdByThread?: Record<string, string>;
  isNewThreadTab: boolean;
  newThreadTarget: {
    projectId: string;
    projectName: string;
    cardId: string;
    cardTitle: string;
    columnId: string;
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

function resolveActiveTurn(conversation: CodexConversationSnapshot | null) {
  return conversation
    ? [...conversation.turns].reverse().find((turn) => turn.status === "inProgress") ?? null
    : null;
}

function resolveLatestTurnId(conversation: CodexConversationSnapshot | null): string | null {
  return conversation?.turns[conversation.turns.length - 1]?.turnId ?? null;
}

function resolveHasVisibleContent(conversation: CodexConversationSnapshot): boolean {
  return conversation.turns.some((turn) => turn.items.length > 0);
}

function resolveHasAboveComposerBlocks(
  conversation: CodexConversationSnapshot,
  activeTurnId: string | null,
  latestTurnId: string | null,
  dismissedPlanImplementationTurnIdByThread: Record<string, string>,
): boolean {
  if (!activeTurnId) return false;

  const activeTurn = conversation.turns.find((turn) => turn.turnId === activeTurnId);
  if (!activeTurn) return false;

  const turnRequestsByTurnId = selectConversationTurnRequestsByTurnId(conversation, {
    dismissedPlanImplementationTurnId:
      dismissedPlanImplementationTurnIdByThread[conversation.threadId] ?? null,
  });
  const renderedTurn = buildTurnRenderModel({
    turn: activeTurn,
    requests: turnRequestsByTurnId.get(activeTurnId) ?? [],
    isLatestTurn: latestTurnId === activeTurnId,
    isStreamingTurn: true,
    canEditTurnUserPrefix: false,
    canForkTurnUserPrefix: false,
  });

  return (renderedTurn.aboveComposerBlocks?.length ?? 0) > 0;
}

export function buildThreadBodyModel(input: BuildThreadBodyModelInput): ThreadBodyModel {
  const conversation = input.conversation;
  const resumeState = conversation?.resumeState ?? null;
  const dismissedPlanImplementationTurnIdByThread =
    input.dismissedPlanImplementationTurnIdByThread ?? {};
  const showThreadStartProgressPanel = Boolean(
    input.isNewThreadTab && !conversation && input.newThreadTarget && input.threadStartProgress,
  );

  if (!conversation) {
    if (input.activeThreadId && resumeState) {
      return {
        threadId: input.activeThreadId,
        turnCount: 0,
        hasAboveComposerBlocks: false,
        dismissedPlanImplementationTurnId: null,
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

    if (input.isNewThreadTab) {
      return {
        threadId: null,
        turnCount: 0,
        hasAboveComposerBlocks: false,
        dismissedPlanImplementationTurnId: null,
        isThreadRunning: false,
        activeTurnId: null,
        latestTurnId: null,
        showThreadStartProgressPanel,
        emptyState: {
          type: "newThread",
          title: "Start a new thread",
          description: input.newThreadTarget
            ? input.isCloudNewThreadTarget
              ? "Cloud run target is mock-only right now. Change the card Run in property to Local project or New worktree."
              : "Write the first prompt and send to create a new card-linked thread."
            : "Select a card in the Cards stage, then press New in its Threads property.",
        },
      };
    }

    return {
      threadId: null,
      turnCount: 0,
      hasAboveComposerBlocks: false,
      dismissedPlanImplementationTurnId: null,
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
      dismissedPlanImplementationTurnId:
        dismissedPlanImplementationTurnIdByThread[conversation.threadId] ?? null,
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

  const activeTurnId = resolveActiveTurn(conversation)?.turnId ?? null;
  const latestTurnId = resolveLatestTurnId(conversation);
  const isThreadRunning =
    conversation.statusType === "active" || activeTurnId !== null;

  if (!resolveHasVisibleContent(conversation) && conversation.turns.length === 0) {
    return {
      threadId: conversation.threadId,
      turnCount: 0,
      hasAboveComposerBlocks: false,
      dismissedPlanImplementationTurnId:
        dismissedPlanImplementationTurnIdByThread[conversation.threadId] ?? null,
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
    turnCount: conversation.turns.length,
    hasAboveComposerBlocks: resolveHasAboveComposerBlocks(
      conversation,
      activeTurnId,
      latestTurnId,
      dismissedPlanImplementationTurnIdByThread,
    ),
    dismissedPlanImplementationTurnId:
      dismissedPlanImplementationTurnIdByThread[conversation.threadId] ?? null,
    isThreadRunning,
    activeTurnId,
    latestTurnId,
    showThreadStartProgressPanel,
    emptyState: { type: "none" },
  };
}
