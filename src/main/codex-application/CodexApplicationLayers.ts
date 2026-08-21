import * as Layer from "effect/Layer";
import type { CodexServerRequestRuntime } from "../codex-runtime/CodexServerRequestRuntime";
import {
  ApprovalCoordinator,
  CodexGlobalServerRequestRuntime,
  live as approvalLive,
  serverRequestLayer,
} from "./ApprovalCoordinator";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

export type CodexRequestHandling =
  | CodexServerRequestRuntime
  | ApprovalCoordinator
  | ConversationRuntimeMap;

/** Built before CodexEndpoint so its scoped server-request runtime can be installed per attempt. */
const conversationRuntimes = conversationRuntimeMapLive;
const approvalCoordinator = approvalLive.pipe(Layer.provideMerge(conversationRuntimes));

export const requestHandlingLive: Layer.Layer<
  CodexRequestHandling,
  never,
  CodexGlobalServerRequestRuntime
> = serverRequestLayer.pipe(Layer.provideMerge(approvalCoordinator));
