import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { invoke, subscribeCodexHostMessages } from "../../lib/api";
import type {
  CodexAccountSnapshot,
  CodexComposerIntent,
  CodexConnectionState,
  CodexConversationSnapshot,
  CodexThreadSummary,
} from "../../lib/types";
import {
  createInitialLocalConversationStoreState,
  localConversationStoreReducer,
} from "./local-conversation-store";

export function useLocalConversation(activeProjectId: string) {
  const [state, dispatch] = useReducer(
    localConversationStoreReducer,
    undefined,
    createInitialLocalConversationStoreState,
  );
  const resyncInFlight = useRef<Set<string>>(new Set());

  const requestConversationSnapshot = useCallback(async (threadId: string) => {
    const conversation = (await invoke("codex:thread:snapshot:request", threadId)) as CodexConversationSnapshot | null;
    if (conversation) {
      dispatch({ type: "setConversation", conversation });
    }
    return conversation;
  }, []);

  const requestConversationResume = useCallback(async (threadId: string) => {
    try {
      const conversation = (await invoke("codex:thread:resume:request", threadId)) as CodexConversationSnapshot | null;
      if (conversation) {
        dispatch({ type: "setConversation", conversation });
      }
      return conversation;
    } catch (error) {
      throw error;
    }
  }, []);

  const resolvePlanImplementation = useCallback((threadId: string, turnId: string) => {
    dispatch({ type: "resolvePlanImplementation", threadId, turnId });
  }, []);

  const setComposerIntent = useCallback((threadId: string, composerIntent: CodexComposerIntent) => {
    dispatch({ type: "setComposerIntent", threadId, composerIntent });
  }, []);

  const consumeComposerIntent = useCallback((threadId: string, focusNonce: number) => {
    dispatch({ type: "consumeComposerIntent", threadId, focusNonce });
  }, []);

  useEffect(() => {
    return subscribeCodexHostMessages((message) => {
      dispatch({ type: "hostMessage", message });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const account = await invoke("codex:account:read");
        if (!cancelled) {
          dispatch({
            type: "hostMessage",
            message: {
              type: "account",
              account: account as CodexAccountSnapshot,
            },
          });
        }
      } catch {
        // ignore bootstrap account failures; host messages remain authoritative
      }

      try {
        const connection = await invoke("codex:connection:status");
        if (!cancelled) {
          dispatch({
            type: "hostMessage",
            message: {
              type: "connection",
              connection: connection as CodexConnectionState,
            },
          });
        }
      } catch {
        // ignore bootstrap connection failures; host messages remain authoritative
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    for (const conversation of Object.values(state.conversationsById)) {
      for (const membership of conversation.childMemberships) {
        const childThreadId = membership.threadId;
        const childConversation = state.conversationsById[childThreadId];
        if (childConversation && childConversation.turns.length > 0) continue;
        if (resyncInFlight.current.has(childThreadId)) continue;

        resyncInFlight.current.add(childThreadId);
        void requestConversationSnapshot(childThreadId)
          .catch(() => {})
          .finally(() => {
            resyncInFlight.current.delete(childThreadId);
          });
      }
    }
  }, [requestConversationSnapshot, state.conversationsById]);

  const threads = useMemo<CodexThreadSummary[]>(
    () => state.threadSummariesByProject[activeProjectId] ?? [],
    [activeProjectId, state.threadSummariesByProject],
  );

  return {
    state,
    threads,
    requestConversationSnapshot,
    requestConversationResume,
    resolvePlanImplementation,
    setComposerIntent,
    consumeComposerIntent,
  };
}
