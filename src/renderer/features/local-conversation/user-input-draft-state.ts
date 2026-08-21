import { useLayoutEffect, useSyncExternalStore } from "react";
import { buildCodexCanonicalRequestIdentityKey } from "../../../shared/codex-conversation-state/codex-conversation-state";
import type { CodexProtocolRequestId } from "@/lib/types";
import {
  buildRequestQuestionSignature,
  type RequestComposerRequest,
  type RequestQuestionnaireDraft,
} from "./view/shared/request-cards/request-card-questionnaire-state";

interface CodexUserInputDraftEntry {
  readonly requestIdentity: string;
  readonly questionSignature: string;
  readonly draft: RequestQuestionnaireDraft;
}

const entries = new Map<string, CodexUserInputDraftEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearCodexUserInputDraft(
  conversationId: string,
  requestId: CodexProtocolRequestId,
): void {
  const entry = entries.get(conversationId);
  const requestIdentity = buildCodexCanonicalRequestIdentityKey(requestId);
  if (entry?.requestIdentity !== requestIdentity) return;
  entries.delete(conversationId);
  notify();
}

export function useCodexUserInputDraft(
  conversationId: string,
  request: RequestComposerRequest,
): {
  initialDraft: RequestQuestionnaireDraft | undefined;
  saveDraft: (draft: RequestQuestionnaireDraft) => void;
  clearDraft: () => void;
} {
  const requestIdentity = buildCodexCanonicalRequestIdentityKey(request.requestId);
  const questionSignature = buildRequestQuestionSignature(request);
  const entry = useSyncExternalStore(
    subscribe,
    () => entries.get(conversationId),
    () => undefined,
  );
  const initialDraft =
    entry?.requestIdentity === requestIdentity && entry.questionSignature === questionSignature
      ? entry.draft
      : undefined;

  useLayoutEffect(() => {
    const current = entries.get(conversationId);
    if (
      !current ||
      (current.requestIdentity === requestIdentity &&
        current.questionSignature === questionSignature)
    ) {
      return;
    }
    entries.delete(conversationId);
    notify();
  }, [conversationId, questionSignature, requestIdentity]);

  const saveDraft = (draft: RequestQuestionnaireDraft) => {
    entries.set(conversationId, {
      requestIdentity,
      questionSignature,
      draft,
    });
    notify();
  };

  const clearDraft = () => {
    clearCodexUserInputDraft(conversationId, request.requestId);
  };

  return {
    initialDraft,
    saveDraft,
    clearDraft,
  };
}

export function resetCodexUserInputDraftStateForTests(): void {
  entries.clear();
  listeners.clear();
}
