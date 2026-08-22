import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CoreGenerationClient } from "../core-client/core-generation-client";
import type {
  DesktopDataAuthorityRuntime,
  RustDataAuthorityRuntime,
} from "../core-client/desktop-data-authority";
import { CoreAuthority } from "./CoreAuthority";
import { CoreSessionAccess } from "./CoreAuthority";

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
    };
    return runtime;
  },
);
