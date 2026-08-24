import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolveCodexRuntime } from "../codex/codex-runtime";
import {
  CodexPendingServerRequestRuntime,
  make as makeCodexPendingServerRequestRuntime,
} from "../codex-application/CodexPendingServerRequestRuntime";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "../codex-application/ConversationRuntimeMap";
import {
  CodexApplicationRequestInbox,
  make as makeCodexApplicationRequestInbox,
} from "../codex-runtime/CodexApplicationRequestInbox";
import { CodexEndpointMap } from "../codex-runtime/CodexEndpointMap";
import { CodexEventHub } from "../codex-runtime/CodexEventHub";
import { CodexGateway, CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import * as CodexRuntimeLive from "../codex-runtime/CodexRuntimeLive";
import { createElectronProviderCredentialStore } from "../platform/electron/ProviderCredentialStore";
import * as CodexSessionTransport from "../platform/node/CodexSessionTransport";
import { resolveCodexProcessEnvironment } from "../platform/node/CodexProcessEnvironment";
import { MainConfig } from "./MainConfig";
import { MainApplicationError } from "./MainExit";

export class CodexPlatform extends Context.Service<
  CodexPlatform,
  {
    readonly runtime: ReturnType<typeof resolveCodexRuntime>;
    readonly providerCredentialStore: ReturnType<typeof createElectronProviderCredentialStore>;
    readonly runtimeStateHome: string;
  }
>()("nodex/main/app/CodexPlatform") {}

const platform: Layer.Layer<CodexPlatform, MainApplicationError, MainConfig> = Layer.effect(
  CodexPlatform,
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const runtime = yield* Effect.try({
      try: () =>
        resolveCodexRuntime({
          isPackaged: config.isPackaged,
          projectRootPath: config.projectRootPath,
          resourcesPath: config.resourcesPath,
        }),
      catch: (cause) =>
        new MainApplicationError({ phase: "startup", operation: "resolve-codex-runtime", cause }),
    });
    const providerCredentialStore = yield* Effect.try({
      try: createElectronProviderCredentialStore,
      catch: (cause) =>
        new MainApplicationError({ phase: "startup", operation: "provider-credentials", cause }),
    });
    return CodexPlatform.of({
      runtime,
      providerCredentialStore,
      runtimeStateHome: `${config.nodexHome}/agent`,
    });
  }),
);

const requestInbox = Layer.effect(CodexApplicationRequestInbox, makeCodexApplicationRequestInbox);

const pendingRequests = Layer.effect(
  CodexPendingServerRequestRuntime,
  Effect.gen(function* () {
    const inbox = yield* CodexApplicationRequestInbox;
    return yield* makeCodexPendingServerRequestRuntime({
      respond: (_threadId, _requestId, occurrenceToken, response) =>
        inbox.settleOccurrenceToken(occurrenceToken, { kind: "result", value: response }),
      reject: (_threadId, requestId, occurrenceToken, reason) =>
        inbox.settleOccurrenceToken(occurrenceToken, {
          kind: "error",
          error: CodexAppServerRequestError.internalError(
            "Codex application request failed",
            undefined,
            {
              operation: "handle-request",
              requestId: String(requestId),
              cause: reason,
            },
          ),
        }),
    });
  }),
);

const runtime = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const codex = yield* CodexPlatform;
    return CodexRuntimeLive.live({
      local: {
        hostId: "local",
        command: codex.runtime.binaryPath,
        args: ["app-server", "--listen", "stdio://"],
        env: {},
        resolveEnv: () =>
          resolveCodexProcessEnvironment({
            additionalSearchPaths: codex.runtime.additionalSearchPaths,
            pathDelimiter: config.platform === "win32" ? ";" : ":",
            providerCredentialStore: codex.providerCredentialStore,
            runtimeStateHome: codex.runtimeStateHome,
          }),
        forceTermination: "2 seconds",
        initializeParams: {
          clientInfo: { name: "nodex", title: "Nodex", version: "0.5.0" },
          capabilities: {
            experimentalApi: true,
            extensions: { "openai/form": {} },
            requestAttestation: false,
          },
        },
        initializeTimeout: "20 seconds",
        expectedCodexHome: codex.runtimeStateHome,
      },
      requestTimeout: "180 seconds",
    });
  }),
);

const foundations = Layer.mergeAll(
  platform,
  requestInbox,
  conversationRuntimeMapLive,
  CodexSessionTransport.nodeLive,
);
const transport = runtime.pipe(Layer.provideMerge(foundations));

/** Stable Codex host generations and application-owned conversation foundations. */
export const live: Layer.Layer<
  | CodexPlatform
  | CodexApplicationRequestInbox
  | CodexPendingServerRequestRuntime
  | ConversationRuntimeMap
  | CodexGateway
  | CodexEndpointMap
  | CodexEventHub,
  MainApplicationError,
  MainConfig | CodexThreadHostResolver
> = Layer.merge(transport, pendingRequests.pipe(Layer.provideMerge(foundations)));
