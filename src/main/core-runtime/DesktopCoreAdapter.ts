import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CoreGenerationClient } from "../core-client/desktop-core-authority-supervisor";
import type {
  DesktopDataAuthorityRuntime,
  RustDataAuthorityRuntime,
} from "../core-client/desktop-data-authority";
import type { CoreAuthorityState as LegacyCoreAuthorityState } from "../core-client/desktop-core-authority-supervisor";
import { CoreAuthority, type CoreAuthorityState } from "./CoreAuthority";
import { CoreSessionAccess } from "./CoreAuthority";

const mapAuthorityState = (
  state: CoreAuthorityState,
  generation: CoreGenerationClient["handshake"]["generation"],
): LegacyCoreAuthorityState => {
  if (state.kind === "ready") {
    return { kind: "ready", generation: { ...generation, start_nonce: state.generation } };
  }
  if (state.kind === "recovering") {
    return {
      kind: "recovering",
      attempt: state.attempt,
      previousGeneration: {
        ...generation,
        start_nonce: state.previousGeneration,
      },
    };
  }
  if (state.kind === "stopped") return { kind: "stopped" };
  return { kind: "unavailable", circuitOpen: false, error: state.error };
};

const makeClient = (input: {
  readonly access: CoreSessionAccess["Service"];
  readonly callbacks: ScopedCallbackRuntime["Service"];
  readonly handshake: CoreGenerationClient["handshake"];
  readonly projectId: string | null;
}): CoreGenerationClient => {
  let proxy: CoreGenerationClient;
  proxy = new Proxy({} as CoreGenerationClient, {
    get: (_target, property) => {
      if (property === "handshake") return input.handshake;
      if (property === "forProject") {
        return (projectId: string) =>
          makeClient({ ...input, projectId, handshake: input.handshake });
      }
      if (property === "then") return undefined;
      if (typeof property !== "string") return Reflect.get(_target, property);
      return (...args: readonly unknown[]) =>
        input.callbacks.runPromise(
          input.access.use(
            `desktop-adapter.${property}`,
            (client) => {
              const method = Reflect.get(client, property);
              if (typeof method !== "function") {
                throw new TypeError(`Native Core client method ${property} is unavailable`);
              }
              return Reflect.apply(method, client, args) as Promise<unknown>;
            },
            input.projectId === null ? undefined : { projectId: input.projectId },
          ),
        );
    },
  });
  return proxy;
};

/**
 * Promise-facing adapter for the existing IPC/domain mappers. It borrows the
 * Effect authority and never owns or closes a second Core generation.
 */
export const makeDesktopDataAuthority = Effect.fn("DesktopCoreAdapter.makeDesktopDataAuthority")(
  function* (callbacks: ScopedCallbackRuntime["Service"]) {
    const authority = yield* CoreAuthority;
    const access = yield* CoreSessionAccess;
    const handshake = yield* access.handshake;
    const rootClient = makeClient({ access, callbacks, handshake, projectId: null });
    const projectClients = new Map<string, CoreGenerationClient>();
    const runtime: RustDataAuthorityRuntime = {
      backend: "rust",
      identity: authority.identity,
      launch: {
        ...authority.initialLaunch,
        client: rootClient as DesktopDataAuthorityRuntime["launch"]["client"],
      },
      rootClient,
      clientForProject: (projectId) => {
        const existing = projectClients.get(projectId);
        if (existing !== undefined) return existing;
        const client = makeClient({ access, callbacks, handshake, projectId });
        projectClients.set(projectId, client);
        return client;
      },
      // Scope owns the authority. Legacy callers may signal intent to close, but
      // they cannot retire the process-scoped resource out of order.
      close: () => Promise.resolve(),
      retryCoreNow: () => callbacks.runPromise(authority.retry),
      subscribeToCoreAuthority: (listener) => {
        const fiber = callbacks.fork(
          Stream.runForEach(SubscriptionRef.changes(authority.state), (state) =>
            Effect.sync(() => listener(mapAuthorityState(state, handshake.generation))),
          ),
        );
        const initial = SubscriptionRef.get(authority.state).pipe(
          Effect.flatMap((state) =>
            Effect.sync(() => listener(mapAuthorityState(state, handshake.generation))),
          ),
        );
        callbacks.fork(initial);
        return () => {
          if (fiber === null) return;
          callbacks.fork(Fiber.interrupt(fiber).pipe(Effect.asVoid));
        };
      },
    };
    return runtime;
  },
);
