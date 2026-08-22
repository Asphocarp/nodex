import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type {
  NodexAgentResourceAccessOverlay,
  NodexAgentResourceGrantSpec,
} from "../../shared/nodex-agent-resource-access";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { NodexAgentDynamicAuthorizationInput } from "../agent-tools/dynamic-service-core";
import type {
  NodexAgentAuthorizationOutcome,
  NodexAgentAuthorizationPresentationTarget,
  NodexAgentAuthorizationRuntime,
} from "./NodexAgentAuthorizationRuntime";

export interface AuthorizeNodexAgentAccessPromiseInput extends NodexAgentDynamicAuthorizationInput {
  readonly rootThreadId: string;
  readonly authority: FrozenNodexAgentTurnAuthority;
  readonly presentation: NodexAgentAuthorizationPresentationTarget | null;
  readonly isAuthorityCurrent?: () => boolean | Promise<boolean>;
}

export interface NodexAgentAuthorizationRuntimePromiseAdapter {
  readonly authorize: (
    input: AuthorizeNodexAgentAccessPromiseInput,
  ) => Promise<NodexAgentAuthorizationOutcome>;
  readonly extendTaskAccess: (
    authority: FrozenNodexAgentTurnAuthority,
    grants: readonly NodexAgentResourceGrantSpec[],
  ) => Promise<void>;
  readonly getTaskAccess: (
    authority: FrozenNodexAgentTurnAuthority,
  ) => Promise<NodexAgentResourceAccessOverlay | undefined>;
  readonly revokeRoot: (rootThreadId: string) => Promise<void>;
}

class NodexAgentAuthorizationAdapterError extends Data.TaggedError(
  "NodexAgentAuthorizationAdapterError",
)<{
  readonly cause: unknown;
}> {}

export const makeNodexAgentAuthorizationRuntimePromiseAdapter = (
  runtime: NodexAgentAuthorizationRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): NodexAgentAuthorizationRuntimePromiseAdapter => ({
  authorize: (input) => {
    const { isAuthorityCurrent, ...runtimeInput } = input;
    return callbacks.runPromise(
      runtime.authorize({
        ...runtimeInput,
        ...(isAuthorityCurrent
          ? {
              isAuthorityCurrent: Effect.tryPromise({
                try: () => Promise.resolve(isAuthorityCurrent()),
                catch: (cause) => new NodexAgentAuthorizationAdapterError({ cause }),
              }).pipe(Effect.catch(() => Effect.succeed(false))),
            }
          : {}),
      }),
    );
  },
  extendTaskAccess: (authority, grants) =>
    callbacks.runPromise(runtime.extendTaskAccess(authority, grants)),
  getTaskAccess: (authority) => callbacks.runPromise(runtime.getTaskAccess(authority)),
  revokeRoot: (rootThreadId) => callbacks.runPromise(runtime.revokeRoot(rootThreadId)),
});
