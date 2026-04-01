import type { CodexHostMessage } from "../../lib/types";
import {
  dispatchCodexAppServerMessage,
} from "./app-server-message-bus";
import { subscribeCodexHostMessages } from "./local-conversation-deps";

let bridgeRefCount = 0;
let unsubscribeHostMessages: (() => void) | null = null;

function applyHostMessage(message: CodexHostMessage): void {
  if (message.type === "sharedObjectUpdated") {
    dispatchCodexAppServerMessage("shared-object-updated", {
      hostId: message.hostId,
      object: message.object,
    });

    if (message.object.objectType === "connection") {
      dispatchCodexAppServerMessage("client-status-changed", {
        hostId: message.hostId,
        status: message.object.value.status,
      });
    }
    return;
  }

  if (message.type === "threadStreamStateChanged") {
    dispatchCodexAppServerMessage("thread-stream-state-changed", {
      hostId: message.hostId,
      conversationId: message.conversationId,
      change: message.change,
      version: message.version,
      sourceClientId: message.sourceClientId ?? null,
    });
  }
}

export function startLocalConversationHostBridge(): () => void {
  bridgeRefCount += 1;
  if (!unsubscribeHostMessages) {
    unsubscribeHostMessages = subscribeCodexHostMessages((message) => {
      applyHostMessage(message);
    });
  }

  return () => {
    bridgeRefCount = Math.max(0, bridgeRefCount - 1);
    if (bridgeRefCount === 0) {
      unsubscribeHostMessages?.();
      unsubscribeHostMessages = null;
    }
  };
}

export function __resetLocalConversationHostBridgeForTests(): void {
  bridgeRefCount = 0;
  unsubscribeHostMessages?.();
  unsubscribeHostMessages = null;
}
