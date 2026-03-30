import { useRef, useSyncExternalStore } from "react";
import type {
  CodexAccountSnapshot,
  CodexComposerIntent,
  CodexConnectionState,
  CodexConversationSnapshot,
  CodexHostMessage,
  CodexThreadSummary,
} from "../../lib/types";
import { invoke, subscribeCodexHostMessages } from "./local-conversation-deps";

const INITIAL_CONNECTION: CodexConnectionState = {
  status: "disconnected",
  retries: 0,
};

const EMPTY_THREADS: CodexThreadSummary[] = [];
const EMPTY_DISMISSED_TURN_IDS: Record<string, string> = {};
const EMPTY_CONVERSATION_MAP: Record<string, CodexConversationSnapshot> = {};

export interface LocalConversationStoreState {
  connection: CodexConnectionState;
  account: CodexAccountSnapshot | null;
  threadSummariesByProject: Record<string, CodexThreadSummary[]>;
  conversationsById: Record<string, CodexConversationSnapshot>;
  composerIntentsByThread: Record<string, CodexComposerIntent>;
  dismissedPlanImplementationTurnIdByThread: Record<string, string>;
}

type StoreListener = () => void;

function sortThreadSummaries(threads: CodexThreadSummary[]): CodexThreadSummary[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

function upsertThreadSummary(
  threads: CodexThreadSummary[],
  thread: CodexThreadSummary,
): CodexThreadSummary[] {
  const existing = threads.find((candidate) => candidate.threadId === thread.threadId);
  if (!existing) {
    return sortThreadSummaries([thread, ...threads]);
  }

  return sortThreadSummaries(
    threads.map((candidate) => candidate.threadId === thread.threadId ? thread : candidate),
  );
}

function areThreadSummariesEqual(
  left: CodexThreadSummary[],
  right: CodexThreadSummary[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function createInitialState(): LocalConversationStoreState {
  return {
    connection: INITIAL_CONNECTION,
    account: null,
    threadSummariesByProject: {},
    conversationsById: {},
    composerIntentsByThread: {},
    dismissedPlanImplementationTurnIdByThread: {},
  };
}

export class LocalConversationStore {
  private state: LocalConversationStoreState = createInitialState();

  private readonly listeners = new Set<StoreListener>();

  private unsubscribeHostMessages: (() => void) | null = null;

  private bootstrapStarted = false;

  private readonly resyncInFlight = new Set<string>();

  getState = (): LocalConversationStoreState => this.state;

  subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener);
    this.ensureStarted();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.unsubscribeHostMessages?.();
      this.unsubscribeHostMessages = null;
    };
  };

  requestConversationSnapshot = async (threadId: string): Promise<CodexConversationSnapshot | null> => {
    const conversation = (await invoke("codex:thread:snapshot:request", threadId)) as CodexConversationSnapshot | null;
    if (conversation) {
      this.applyConversationSnapshot(conversation);
    }
    return conversation;
  };

  requestConversationResume = async (threadId: string): Promise<CodexConversationSnapshot | null> => {
    const conversation = (await invoke("codex:thread:resume:request", threadId)) as CodexConversationSnapshot | null;
    if (conversation) {
      this.applyConversationSnapshot(conversation);
    }
    return conversation;
  };

  hydrateThreadSummaries = (projectId: string, threads: CodexThreadSummary[]): void => {
    const sortedThreads = sortThreadSummaries(threads);
    const current = this.state.threadSummariesByProject[projectId] ?? EMPTY_THREADS;
    if (areThreadSummariesEqual(current, sortedThreads)) {
      return;
    }

    this.setState({
      ...this.state,
      threadSummariesByProject: {
        ...this.state.threadSummariesByProject,
        [projectId]: sortedThreads,
      },
    });
  };

  setComposerIntent = (threadId: string, composerIntent: CodexComposerIntent): void => {
    const currentIntent = this.state.composerIntentsByThread[threadId];
    if (
      currentIntent
      && currentIntent.prompt === composerIntent.prompt
      && currentIntent.focusNonce === composerIntent.focusNonce
    ) {
      return;
    }

    this.setState({
      ...this.state,
      composerIntentsByThread: {
        ...this.state.composerIntentsByThread,
        [threadId]: composerIntent,
      },
    });
  };

  consumeComposerIntent = (threadId: string, focusNonce: number): void => {
    const currentIntent = this.state.composerIntentsByThread[threadId];
    if (!currentIntent || currentIntent.focusNonce !== focusNonce) {
      return;
    }

    const nextComposerIntentsByThread = {
      ...this.state.composerIntentsByThread,
    };
    delete nextComposerIntentsByThread[threadId];
    this.setState({
      ...this.state,
      composerIntentsByThread: nextComposerIntentsByThread,
    });
  };

  resolvePlanImplementation = (threadId: string, turnId: string): void => {
    if (this.state.dismissedPlanImplementationTurnIdByThread[threadId] === turnId) {
      return;
    }

    this.setState({
      ...this.state,
      dismissedPlanImplementationTurnIdByThread: {
        ...this.state.dismissedPlanImplementationTurnIdByThread,
        [threadId]: turnId,
      },
    });
  };

  resetForTests = (): void => {
    this.state = createInitialState();
    this.bootstrapStarted = false;
    this.resyncInFlight.clear();
    this.unsubscribeHostMessages?.();
    this.unsubscribeHostMessages = null;
    this.emitChange();
  };

  private ensureStarted(): void {
    if (!this.unsubscribeHostMessages) {
      this.unsubscribeHostMessages = subscribeCodexHostMessages((message) => {
        this.applyHostMessage(message);
      });
    }

    if (this.bootstrapStarted) {
      return;
    }

    this.bootstrapStarted = true;
    void this.bootstrapAccountAndConnection();
  }

  private async bootstrapAccountAndConnection(): Promise<void> {
    try {
      const account = (await invoke("codex:account:read")) as CodexAccountSnapshot;
      this.applyHostMessage({
        type: "account",
        account,
      });
    } catch {
      // host messages stay authoritative if bootstrap fails
    }

    try {
      const connection = (await invoke("codex:connection:status")) as CodexConnectionState;
      this.applyHostMessage({
        type: "connection",
        connection,
      });
    } catch {
      // host messages stay authoritative if bootstrap fails
    }
  }

  private applyHostMessage(message: CodexHostMessage): void {
    if (message.type === "connection") {
      if (this.state.connection === message.connection) {
        return;
      }

      this.setState({
        ...this.state,
        connection: message.connection,
      });
      return;
    }

    if (message.type === "account") {
      if (this.state.account === message.account) {
        return;
      }

      this.setState({
        ...this.state,
        account: message.account,
      });
      return;
    }

    if (message.type === "rateLimits") {
      if (!this.state.account) {
        return;
      }

      this.setState({
        ...this.state,
        account: {
          ...this.state.account,
          rateLimits: message.rateLimits,
        },
      });
      return;
    }

    if (message.type === "threadSummary") {
      const currentThreads = this.state.threadSummariesByProject[message.thread.projectId] ?? EMPTY_THREADS;
      const nextThreads = upsertThreadSummary(currentThreads, message.thread);
      if (areThreadSummariesEqual(currentThreads, nextThreads)) {
        return;
      }

      this.setState({
        ...this.state,
        threadSummariesByProject: {
          ...this.state.threadSummariesByProject,
          [message.thread.projectId]: nextThreads,
        },
      });
      return;
    }

    if (message.type === "conversationSnapshot") {
      this.applyConversationSnapshot(message.conversation);
      return;
    }
  }

  private applyConversationSnapshot(conversation: CodexConversationSnapshot): void {
    const currentConversation = this.state.conversationsById[conversation.threadId];
    if (currentConversation === conversation) {
      return;
    }

    this.setState({
      ...this.state,
      conversationsById: {
        ...this.state.conversationsById,
        [conversation.threadId]: conversation,
      },
    });

    this.ensureChildConversationSnapshots(conversation);
  }

  private ensureChildConversationSnapshots(conversation: CodexConversationSnapshot): void {
    for (const membership of conversation.childMemberships) {
      const childThreadId = membership.threadId;
      const childConversation = this.state.conversationsById[childThreadId];
      if (childConversation && childConversation.turns.length > 0) {
        continue;
      }

      if (this.resyncInFlight.has(childThreadId)) {
        continue;
      }

      this.resyncInFlight.add(childThreadId);
      void this.requestConversationSnapshot(childThreadId)
        .catch(() => {})
        .finally(() => {
          this.resyncInFlight.delete(childThreadId);
        });
    }
  }

  private setState(nextState: LocalConversationStoreState): void {
    if (nextState === this.state) {
      return;
    }

    this.state = nextState;
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const singletonStore = new LocalConversationStore();

export function getLocalConversationStore(): LocalConversationStore {
  return singletonStore;
}

export function hydrateLocalConversationThreadSummaries(
  projectId: string,
  threads: CodexThreadSummary[],
): void {
  singletonStore.hydrateThreadSummaries(projectId, threads);
}

export function requestLocalConversationSnapshot(threadId: string): Promise<CodexConversationSnapshot | null> {
  return singletonStore.requestConversationSnapshot(threadId);
}

export function requestLocalConversationResume(threadId: string): Promise<CodexConversationSnapshot | null> {
  return singletonStore.requestConversationResume(threadId);
}

export function setLocalConversationComposerIntent(threadId: string, composerIntent: CodexComposerIntent): void {
  singletonStore.setComposerIntent(threadId, composerIntent);
}

export function consumeLocalConversationComposerIntent(threadId: string, focusNonce: number): void {
  singletonStore.consumeComposerIntent(threadId, focusNonce);
}

export function resolveLocalConversationPlanImplementation(threadId: string, turnId: string): void {
  singletonStore.resolvePlanImplementation(threadId, turnId);
}

export function readLocalConversationSnapshot(): LocalConversationStoreState {
  return singletonStore.getState();
}

export function __resetLocalConversationStoreForTests(): void {
  singletonStore.resetForTests();
}

function useLocalConversationSelector<T>(
  selector: (state: LocalConversationStoreState) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const cacheRef = useRef<{ hasValue: boolean; value: T }>({
    hasValue: false,
    value: undefined as T,
  });

  return useSyncExternalStore(
    singletonStore.subscribe,
    () => {
      const nextValue = selector(singletonStore.getState());
      if (cacheRef.current.hasValue && isEqual(cacheRef.current.value, nextValue)) {
        return cacheRef.current.value;
      }

      cacheRef.current = {
        hasValue: true,
        value: nextValue,
      };
      return nextValue;
    },
  );
}

export function useProjectThreadSummaries(projectId: string): CodexThreadSummary[] {
  return useLocalConversationSelector(
    (state) => state.threadSummariesByProject[projectId] ?? EMPTY_THREADS,
  );
}

export function useConversation(threadId: string | null): CodexConversationSnapshot | null {
  return useLocalConversationSelector(
    (state) => {
      if (!threadId) return null;
      return state.conversationsById[threadId] ?? null;
    },
  );
}

function areConversationMapSelectionsEqual(
  left: Record<string, CodexConversationSnapshot>,
  right: Record<string, CodexConversationSnapshot>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

export function useConversationSubset(threadIds: readonly string[]): Record<string, CodexConversationSnapshot> {
  return useLocalConversationSelector(
    (state) => {
      if (threadIds.length === 0) {
        return EMPTY_CONVERSATION_MAP;
      }

      let hasConversation = false;
      const conversations: Record<string, CodexConversationSnapshot> = {};
      for (const threadId of threadIds) {
        const conversation = state.conversationsById[threadId];
        if (!conversation) {
          continue;
        }

        conversations[threadId] = conversation;
        hasConversation = true;
      }

      return hasConversation ? conversations : EMPTY_CONVERSATION_MAP;
    },
    areConversationMapSelectionsEqual,
  );
}

export function useComposerIntent(threadId: string | null): CodexComposerIntent | null {
  return useLocalConversationSelector(
    (state) => {
      if (!threadId) return null;
      return state.composerIntentsByThread[threadId] ?? null;
    },
  );
}

function areDismissedTurnIdsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

export function useDismissedPlanImplementationTurnIds(threadIds: readonly string[]): Record<string, string> {
  return useLocalConversationSelector(
    (state) => {
      if (threadIds.length === 0) {
        return EMPTY_DISMISSED_TURN_IDS;
      }

      let hasDismissedTurnId = false;
      const turnIds: Record<string, string> = {};
      for (const threadId of threadIds) {
        const turnId = state.dismissedPlanImplementationTurnIdByThread[threadId];
        if (!turnId) {
          continue;
        }

        turnIds[threadId] = turnId;
        hasDismissedTurnId = true;
      }

      return hasDismissedTurnId ? turnIds : EMPTY_DISMISSED_TURN_IDS;
    },
    areDismissedTurnIdsEqual,
  );
}

export function useLocalConversationConnection(): CodexConnectionState {
  return useLocalConversationSelector((state) => state.connection);
}

export function useLocalConversationAccount(): CodexAccountSnapshot | null {
  return useLocalConversationSelector((state) => state.account);
}
