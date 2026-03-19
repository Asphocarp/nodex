import type {
  CodexAccountSnapshot,
  CodexComposerIntent,
  CodexConnectionState,
  CodexConversationSnapshot,
  CodexHostMessage,
  CodexThreadSummary,
} from "../../lib/types";

export interface LocalConversationStoreState {
  connection: CodexConnectionState;
  account: CodexAccountSnapshot | null;
  threadSummariesByProject: Record<string, CodexThreadSummary[]>;
  conversationsById: Record<string, CodexConversationSnapshot>;
  composerIntentsByThread: Record<string, CodexComposerIntent>;
  dismissedPlanImplementationTurnIdByThread: Record<string, string>;
  errorMessage: string | null;
}

export type LocalConversationStoreAction =
  | { type: "hostMessage"; message: CodexHostMessage }
  | { type: "setConversation"; conversation: CodexConversationSnapshot }
  | { type: "setComposerIntent"; threadId: string; composerIntent: CodexComposerIntent }
  | { type: "consumeComposerIntent"; threadId: string; focusNonce: number }
  | { type: "resolvePlanImplementation"; threadId: string; turnId: string };

const INITIAL_CONNECTION: CodexConnectionState = {
  status: "disconnected",
  retries: 0,
};

function upsertThreadSummary(
  threads: CodexThreadSummary[],
  thread: CodexThreadSummary,
): CodexThreadSummary[] {
  const existing = threads.find((candidate) => candidate.threadId === thread.threadId);
  if (!existing) {
    return [thread, ...threads].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  return threads
    .map((candidate) => candidate.threadId === thread.threadId ? thread : candidate)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function applyConversationSnapshot(
  state: LocalConversationStoreState,
  conversation: CodexConversationSnapshot,
): LocalConversationStoreState {
  return {
    ...state,
    conversationsById: {
      ...state.conversationsById,
      [conversation.threadId]: conversation,
    },
    threadSummariesByProject: {
      ...state.threadSummariesByProject,
      [conversation.projectId]: upsertThreadSummary(
        state.threadSummariesByProject[conversation.projectId] ?? [],
        conversation,
      ),
    },
  };
}

export function createInitialLocalConversationStoreState(): LocalConversationStoreState {
  return {
    connection: INITIAL_CONNECTION,
    account: null,
    threadSummariesByProject: {},
    conversationsById: {},
    composerIntentsByThread: {},
    dismissedPlanImplementationTurnIdByThread: {},
    errorMessage: null,
  };
}

export function localConversationStoreReducer(
  state: LocalConversationStoreState,
  action: LocalConversationStoreAction,
): LocalConversationStoreState {
  if (action.type === "setConversation") {
    return applyConversationSnapshot(state, action.conversation);
  }

  if (action.type === "resolvePlanImplementation") {
    return {
      ...state,
      dismissedPlanImplementationTurnIdByThread: {
        ...state.dismissedPlanImplementationTurnIdByThread,
        [action.threadId]: action.turnId,
      },
    };
  }

  if (action.type === "setComposerIntent") {
    return {
      ...state,
      composerIntentsByThread: {
        ...state.composerIntentsByThread,
        [action.threadId]: action.composerIntent,
      },
    };
  }

  if (action.type === "consumeComposerIntent") {
    const currentIntent = state.composerIntentsByThread[action.threadId];
    if (!currentIntent || currentIntent.focusNonce !== action.focusNonce) {
      return state;
    }

    const nextComposerIntentsByThread = { ...state.composerIntentsByThread };
    delete nextComposerIntentsByThread[action.threadId];
    return {
      ...state,
      composerIntentsByThread: nextComposerIntentsByThread,
    };
  }

  const { message } = action;
  if (message.type === "connection") {
    return {
      ...state,
      connection: message.connection,
    };
  }
  if (message.type === "account") {
    return {
      ...state,
      account: message.account,
    };
  }
  if (message.type === "rateLimits") {
    return {
      ...state,
      account: state.account
        ? {
            ...state.account,
            rateLimits: message.rateLimits,
          }
        : state.account,
    };
  }
  if (message.type === "threadSummary") {
    return {
      ...state,
      threadSummariesByProject: {
        ...state.threadSummariesByProject,
        [message.thread.projectId]: upsertThreadSummary(
          state.threadSummariesByProject[message.thread.projectId] ?? [],
          message.thread,
        ),
      },
    };
  }
  if (message.type === "conversationSnapshot") {
    return applyConversationSnapshot(state, message.conversation);
  }
  if (message.type === "error") {
    return {
      ...state,
      errorMessage: message.detail ? `${message.message}: ${message.detail}` : message.message,
    };
  }

  return state;
}
