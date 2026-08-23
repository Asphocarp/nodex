import type {
  CodexServerNotification,
  CodexServerRequest,
} from "../codex-runtime/CodexApplicationProtocol";

export interface CodexBufferedConversationNotification {
  readonly type: "notification";
  readonly notification: CodexServerNotification;
}

export interface CodexBufferedConversationRequest {
  readonly type: "request";
  readonly request: CodexServerRequest;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

export type CodexBufferedConversationEvent =
  | CodexBufferedConversationNotification
  | CodexBufferedConversationRequest;

export interface CodexBufferedConversationRequestCompletion {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}
