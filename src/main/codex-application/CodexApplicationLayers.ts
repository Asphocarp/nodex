import * as Layer from "effect/Layer";
import type { CodexServerRequestRuntime } from "../codex-runtime/CodexServerRequestRuntime";
import type { CodexGateway } from "../codex-runtime/CodexGateway";
import {
  ApprovalCoordinator,
  CodexGlobalServerRequestRuntime,
  live as approvalLive,
  serverRequestLayer,
} from "./ApprovalCoordinator";
import { CodexAccount, live as accountLive, type CodexAccountOptions } from "./CodexAccount";
import { CodexConnection, live as connectionLive } from "./CodexConnection";
import * as CodexApplicationEventRouter from "./CodexApplicationEventRouter";
import { ComposerCatalog, live as composerCatalogLive } from "./ComposerCatalog";
import { ConversationCommands, live as conversationCommandsLive } from "./ConversationCommands";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";
import {
  ExecutionHostRuntime,
  type ExecutionHostRuntimeError,
  live as executionHostRuntimeLive,
  type ExecutionHostRuntimeOptions,
} from "./ExecutionHostRuntime";
import {
  ManagedWorktreeRuntime,
  live as managedWorktreeRuntimeLive,
} from "./ManagedWorktreeRuntime";
import { ThreadCatalog, live as threadCatalogLive } from "./ThreadCatalog";

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

export type CodexApplicationModules =
  | ConversationCommands
  | CodexConnection
  | ThreadCatalog
  | ComposerCatalog
  | CodexAccount
  | ExecutionHostRuntime
  | ManagedWorktreeRuntime;

/** Application-facing modules share the same Gateway and per-thread runtime map. */
export const modulesLive = (
  account: CodexAccountOptions,
  executionHosts: ExecutionHostRuntimeOptions,
): Layer.Layer<
  CodexApplicationModules,
  ExecutionHostRuntimeError,
  CodexGateway | ConversationRuntimeMap
> => {
  const managedWorktrees = managedWorktreeRuntimeLive.pipe(
    Layer.provideMerge(executionHostRuntimeLive(executionHosts)),
  );
  return Layer.mergeAll(
    conversationCommandsLive,
    connectionLive,
    threadCatalogLive,
    composerCatalogLive,
    accountLive(account),
    managedWorktrees,
    CodexApplicationEventRouter.live,
  );
};
