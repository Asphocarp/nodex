import * as Layer from "effect/Layer";
import {
  CodexApplicationRequestInbox,
  make as makeApplicationRequestInbox,
} from "../codex-runtime/CodexApplicationRequestInbox";
import {
  ApprovalCoordinator,
  CodexGlobalServerRequestRuntime,
  applicationRequestIngressLive,
  live as approvalLive,
} from "./ApprovalCoordinator";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

export type CodexRequestHandling =
  | CodexApplicationRequestInbox
  | ApprovalCoordinator
  | ConversationRuntimeMap;

/** Built before every CodexEndpoint so request admission never depends on application readiness. */
const conversationRuntimes = conversationRuntimeMapLive;
const approvalCoordinator = approvalLive.pipe(Layer.provideMerge(conversationRuntimes));
const requestInbox = Layer.effect(CodexApplicationRequestInbox, makeApplicationRequestInbox);
const requestCapabilities = Layer.merge(approvalCoordinator, requestInbox);

export const requestHandlingLive: Layer.Layer<
  CodexRequestHandling,
  never,
  CodexGlobalServerRequestRuntime
> = applicationRequestIngressLive.pipe(Layer.provideMerge(requestCapabilities));
