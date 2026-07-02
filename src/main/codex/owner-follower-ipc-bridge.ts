import type {
  CodexHostMessage,
  CodexThreadFollowerActionInput,
  CodexThreadOwnerNotificationAckInput,
  CodexThreadOwnerStreamStatePublishInput,
} from "../../shared/types";
import {
  COMPLETE_HISTORY_RENDERER_CLIENT_REQUEST_TIMEOUT_MS,
  type RendererClientBroadcastOptions,
  type RendererClientRequestOptions,
} from "./renderer-client-router";

export interface CodexOwnerFollowerRendererClientRouter {
  broadcast(
    channel: string,
    args: readonly unknown[],
    options?: RendererClientBroadcastOptions,
  ): number;
  requireThreadOwner(
    targetClientId: string,
    conversationId: string,
    options?: RendererClientRequestOptions,
  ): Promise<void>;
  sendRequest<TResult = unknown>(
    targetClientId: string,
    method: string,
    params: unknown,
    options?: RendererClientRequestOptions,
  ): Promise<TResult>;
  sendToClient(clientId: string, channel: string, args: readonly unknown[]): boolean;
}

export interface CodexOwnerFollowerService {
  ackRendererThreadOwnerNotification(
    sourceClientId: string,
    input: CodexThreadOwnerNotificationAckInput,
  ): boolean;
  getRendererConversationOwner(threadId: string): string | null;
  handleRendererClientDisposed(clientId: string): void;
  publishRendererThreadStreamStateChange(
    sourceClientId: string,
    input: CodexThreadOwnerStreamStatePublishInput,
  ): boolean;
}

export interface CodexRendererOwnerHostMessage {
  targetClientId: string;
  message: unknown;
}

export function isRendererOwnerUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("no-client-found") ||
    message.includes("No renderer owner") ||
    message.includes(" is unavailable") ||
    message.includes(" was destroyed") ||
    message.includes(" was disposed") ||
    message.includes("not owner")
  );
}

export function broadcastCodexHostMessageToRendererClients(
  router: CodexOwnerFollowerRendererClientRouter | null | undefined,
  broadcastToWindows: (channel: string, args: readonly unknown[]) => number,
  message: CodexHostMessage,
): number {
  if (!router) {
    return broadcastToWindows("codex:host-message", [message]);
  }

  return router.broadcast("codex:host-message", [message], {
    sourceClientId: message.type === "threadStreamStateChanged" ? message.sourceClientId ?? null : null,
    includeSource: !(message.type === "threadStreamStateChanged" && message.sourceClientId),
  });
}

export function sendRendererOwnerHostMessage(
  router: CodexOwnerFollowerRendererClientRouter | null | undefined,
  event: CodexRendererOwnerHostMessage,
): boolean {
  if (!router) return false;

  return router.sendToClient(event.targetClientId, "codex:host-message", [event.message]);
}

export function publishRendererThreadOwnerStreamState(
  service: CodexOwnerFollowerService,
  sourceClientId: string | null,
  input: CodexThreadOwnerStreamStatePublishInput,
): boolean {
  if (!sourceClientId) return false;

  return service.publishRendererThreadStreamStateChange(sourceClientId, input);
}

export function ackRendererThreadOwnerNotification(
  service: CodexOwnerFollowerService,
  sourceClientId: string | null,
  input: CodexThreadOwnerNotificationAckInput,
): boolean {
  if (!sourceClientId) return false;

  return service.ackRendererThreadOwnerNotification(sourceClientId, input);
}

export async function runThreadFollowerActionThroughOwner(
  service: CodexOwnerFollowerService,
  router: CodexOwnerFollowerRendererClientRouter | null | undefined,
  sourceClientId: string | null,
  input: CodexThreadFollowerActionInput,
): Promise<unknown> {
  if (!sourceClientId) throw new Error("Renderer client is not registered");

  const ownerClientId = service.getRendererConversationOwner(input.conversationId);
  if (!ownerClientId) throw new Error(`no-client-found: no renderer owner for conversation ${input.conversationId}`);
  if (ownerClientId === sourceClientId) {
    throw new Error(`Renderer client ${sourceClientId} is already owner for ${input.conversationId}`);
  }
  if (!router) throw new Error("Renderer client router is unavailable");

  const requestOptions =
    input.action.type === "loadCompleteHistory"
      ? { timeoutMs: COMPLETE_HISTORY_RENDERER_CLIENT_REQUEST_TIMEOUT_MS }
      : {};

  try {
    await router.requireThreadOwner(ownerClientId, input.conversationId);
    return await router.sendRequest(ownerClientId, "thread-owner-action", input.action, requestOptions);
  } catch (error) {
    if (isRendererOwnerUnavailableError(error)) {
      throw new Error(`no-client-found: renderer owner for ${input.conversationId} is unavailable`);
    }
    throw error;
  }
}
