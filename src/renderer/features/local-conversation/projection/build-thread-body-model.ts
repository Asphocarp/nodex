import type { CodexConversationSnapshot, CodexConversationTurn } from "../../../lib/types";
import { buildRendererItemStream } from "./build-renderer-item-stream";
import { bucketizeTurnItems } from "./bucketize-turn-items";
import { buildTurnViewModel } from "./build-turn-view-model";
import { selectConversationTurnRequestsByTurnId } from "../conversation-request-helpers";
import type { ThreadBodyModel, ThreadTurnModel } from "../thread-stage-types";

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

function buildVisibleItemsByTurnId(
  conversation: CodexConversationSnapshot,
): Map<string, CodexConversationTurn["items"]> {
  return new Map(
    conversation.turns.map((turn) => [
      turn.turnId,
      turn.items,
    ]),
  );
}

function hasIncompleteElicitation(items: ReturnType<typeof buildRendererItemStream>): boolean {
  return items.some((item) => item.type === "mcpServerElicitation" && item.status !== "completed");
}

export function buildThreadBodyModel(input: BuildThreadBodyModelInput): ThreadBodyModel {
  const conversation = input.conversation;
  const resumeState = conversation?.resumeState ?? null;
  const dismissedPlanImplementationTurnIdByThread = input.dismissedPlanImplementationTurnIdByThread ?? {};
  const showThreadStartProgressPanel = Boolean(
    input.isNewThreadTab && !conversation && input.newThreadTarget && input.threadStartProgress,
  );

  if (!conversation) {
    if (input.activeThreadId && resumeState) {
      return {
        threadId: input.activeThreadId,
        turns: [],
        aboveComposerBlocks: [],
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
        turns: [],
        aboveComposerBlocks: [],
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
      turns: [],
      aboveComposerBlocks: [],
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
      turns: [],
      aboveComposerBlocks: [],
      isThreadRunning: false,
      activeTurnId: null,
      latestTurnId: null,
      showThreadStartProgressPanel: false,
      emptyState: {
        type: "resumingThread",
        title: conversation.resumeState === "resuming" ? "Restoring thread" : "Preparing thread",
        description:
          conversation.resumeState === "resuming"
            ? "Loading the latest conversation state before rendering the thread."
            : "This thread needs to resume before the mounted conversation view can render.",
        status: conversation.resumeState,
      },
    };
  }

  const activeTurn = [...conversation.turns].reverse().find((turn) => turn.status === "inProgress") ?? null;
  const activeTurnId = activeTurn?.turnId ?? null;
  const latestTurnId = conversation.turns[conversation.turns.length - 1]?.turnId ?? null;
  const isThreadRunning = conversation.statusType === "active" || activeTurn !== null;
  const visibleItemsByTurnId = buildVisibleItemsByTurnId(conversation);
  const hasVisibleContent = Array.from(visibleItemsByTurnId.values()).some((items) => items.length > 0);

  if (!hasVisibleContent && conversation.turns.length === 0) {
    return {
      threadId: conversation.threadId,
        turns: [],
        aboveComposerBlocks: [],
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

  const editableTurnId =
    conversation.capabilityFlags.canEditLastUserTurn
      ? ([...conversation.turns].reverse().find((turn) => turn.status !== "inProgress")?.turnId ?? null)
      : null;
  const turnRequestsByTurnId = selectConversationTurnRequestsByTurnId(conversation, {
    dismissedPlanImplementationTurnId: dismissedPlanImplementationTurnIdByThread[conversation.threadId] ?? null,
  });
  const turns: ThreadTurnModel[] = conversation.turns.map((turn: CodexConversationTurn) => {
    const turnId = turn.turnId;
    const items = buildRendererItemStream({
      entries: visibleItemsByTurnId.get(turnId) ?? [],
      requests: turnRequestsByTurnId.get(turnId) ?? [],
      turnStatus: turn.status,
      isLatestTurn: latestTurnId === turnId,
    });
    const buckets = bucketizeTurnItems({
      items,
      turnStatus: turn.status,
    });
    const isBlocked =
      buckets.approvalItems.length > 0
      || buckets.userInputItems.length > 0
      || hasIncompleteElicitation(items);
    return buildTurnViewModel({
      turnId,
      turn,
      buckets,
      isLatestTurn: latestTurnId === turnId,
      isStreamingTurn: activeTurnId === turnId,
      isBlocked,
      canEditTurnUserPrefix: editableTurnId === turnId,
      canForkTurnUserPrefix: conversation.capabilityFlags.canForkFromTurn && turn.status !== "inProgress",
    });
  });
  const aboveComposerBlocks = turns.flatMap((turn) => turn.aboveComposerBlocks ?? []);

  return {
    threadId: conversation.threadId,
    turns,
    aboveComposerBlocks,
    isThreadRunning,
    activeTurnId,
    latestTurnId,
    showThreadStartProgressPanel,
    emptyState: { type: "none" },
  };
}
