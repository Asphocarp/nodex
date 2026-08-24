import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CoreAuthority,
  CoreSessionAccess,
  live as coreAuthorityLive,
} from "../core-runtime/CoreAuthority";
import { CoreModules, live as coreModulesLive } from "../core-runtime/CoreModules";
import type { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { live as coreTransportLive } from "../core-runtime/CoreTransport";
import {
  CodexEphemeralThreadRouting,
  live as codexEphemeralThreadRoutingLive,
} from "../codex-runtime/CodexEphemeralThreadRouting";
import { CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import {
  live as projectRuntimeLifecycleLive,
  ProjectRuntimeLifecycleRuntime,
} from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { ApplicationInitializationRuntime } from "../host-runtime/ApplicationInitializationRuntime";
import {
  ProjectWorkspace,
  live as projectWorkspaceLive,
} from "../project-application/ProjectWorkspace";
import { MainConfig } from "./MainConfig";
import { MainShutdown } from "./MainShutdown";
import { ScopedCallbackRuntime } from "./ScopedCallbackRuntime";
import { threadHostResolverLive } from "../codex-application/ExecutionHostRuntime";

const transport = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const callbacks = yield* ScopedCallbackRuntime;
    const initialization = yield* ApplicationInitializationRuntime;

    return coreTransportLive({
      appResourcesPath: config.isPackaged ? config.resourcesPath : undefined,
      buildId: `nodex-desktop/${config.appVersion}`,
      isPackaged: config.isPackaged,
      nodexHome: config.nodexHome,
      onAuthorityProcessExit: (event) => {
        void callbacks.runPromise(initialization.observeAuthorityExit(event));
      },
      onStartupEvent: (event) => {
        void callbacks.runPromise(initialization.observeCoreStartup(event));
      },
      repositoryRoot: config.projectRootPath,
    });
  }),
);

const authority = coreAuthorityLive().pipe(Layer.provide(transport));
const core = coreModulesLive.pipe(Layer.provideMerge(authority));
const workspace = projectWorkspaceLive.pipe(Layer.provideMerge(core));
const hostResolver = threadHostResolverLive.pipe(
  Layer.provideMerge(Layer.merge(core, codexEphemeralThreadRoutingLive)),
);

/** Core authority and its direct application projections as one declarative dependency cluster. */
export const live: Layer.Layer<
  | CoreAuthority
  | CoreSessionAccess
  | CoreModules
  | ProjectWorkspace
  | ProjectRuntimeLifecycleRuntime
  | CodexEphemeralThreadRouting
  | CodexThreadHostResolver,
  CoreRuntimeError,
  MainConfig | MainShutdown | ScopedCallbackRuntime | ApplicationInitializationRuntime
> = Layer.mergeAll(workspace, hostResolver, projectRuntimeLifecycleLive);
