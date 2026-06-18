import type {
  CodexConnectionState,
  CodexMcpNotificationMessage,
  CodexSharedObject,
  CodexThreadStreamStateChange,
} from "../../lib/types";

type AppServerMessageListener<T> = (event: T) => void;

export interface CodexSharedObjectUpdatedEvent {
  hostId: string;
  object: CodexSharedObject;
}

export interface CodexThreadStreamStateChangedEvent {
  hostId: string;
  conversationId: string;
  change: CodexThreadStreamStateChange;
  version: number;
  sourceClientId?: string | null;
}

export interface CodexClientStatusChangedEvent {
  hostId: string;
  status: CodexConnectionState["status"];
}

export interface CodexThreadTitleUpdatedEvent {
  hostId: string;
  conversationId: string;
  title: string;
}

export interface CodexThreadDeletedEvent {
  hostId: string;
  threadId: string;
}

export interface CodexErrorEvent {
  hostId: string;
  message: string;
  detail?: string;
}

export type CodexMcpNotificationEvent = Omit<CodexMcpNotificationMessage, "type">;

interface CodexAppServerMessageMap {
  "shared-object-updated": CodexSharedObjectUpdatedEvent;
  "thread-stream-state-changed": CodexThreadStreamStateChangedEvent;
  "client-status-changed": CodexClientStatusChangedEvent;
  "thread-title-updated": CodexThreadTitleUpdatedEvent;
  "thread-deleted": CodexThreadDeletedEvent;
  "mcp-notification": CodexMcpNotificationEvent;
  error: CodexErrorEvent;
}

const listenersByType: {
  [K in keyof CodexAppServerMessageMap]: Set<AppServerMessageListener<CodexAppServerMessageMap[K]>>;
} = {
  "shared-object-updated": new Set(),
  "thread-stream-state-changed": new Set(),
  "client-status-changed": new Set(),
  "thread-title-updated": new Set(),
  "thread-deleted": new Set(),
  "mcp-notification": new Set(),
  error: new Set(),
};

export function subscribeCodexAppServerMessage<K extends keyof CodexAppServerMessageMap>(
  type: K,
  listener: AppServerMessageListener<CodexAppServerMessageMap[K]>,
): () => void {
  listenersByType[type].add(listener);
  return () => {
    listenersByType[type].delete(listener);
  };
}

export function dispatchCodexAppServerMessage<K extends keyof CodexAppServerMessageMap>(
  type: K,
  event: CodexAppServerMessageMap[K],
): void {
  for (const listener of listenersByType[type]) {
    listener(event);
  }
}

export function __resetCodexAppServerMessageBusForTests(): void {
  for (const listeners of Object.values(listenersByType)) {
    listeners.clear();
  }
}
