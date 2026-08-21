import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import type { IpcMainInvokeEvent } from "electron";
import { MainConfig } from "../../app/MainConfig";
import { CodexAccount } from "../../codex-application/CodexAccount";
import { AgentProviderRuntime } from "../../codex-application/AgentProviderRuntime";
import { CodexConnection } from "../../codex-application/CodexConnection";
import { CodexMedia } from "../../codex-application/CodexMedia";
import { emptyAccountSnapshot } from "../../codex-application/CodexAccountState";
import { CodexToolRuntime } from "../../codex-application/CodexToolRuntime";
import { ComposerCatalog } from "../../codex-application/ComposerCatalog";
import { ComposerExternalSuggestions } from "../../codex-application/ComposerExternalSuggestions";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { ElectronWindowHost } from "../../platform/electron/ElectronWindowHost";
import { live } from "./CodexApplicationIpc";

type Handler = (
  event: IpcMainInvokeEvent,
  ...args: readonly unknown[]
) => Effect.Effect<unknown, Error>;

it.effect("registers application channels directly against their owning modules", () =>
  Effect.gen(function* () {
    const handlers = new Map<string, Handler>();
    const ipc = ElectronIpc.of({
      handle: (channel, handler) =>
        Effect.sync(() => {
          handlers.set(channel, handler as Handler);
        }),
      on: () => Effect.void,
    });
    const accountSnapshot = yield* SubscriptionRef.make(emptyAccountSnapshot());
    const account = CodexAccount.of({
      snapshot: accountSnapshot,
      refresh: Effect.succeed(emptyAccountSnapshot()),
      consumeRateLimitResetCredit: () => Effect.die("unused"),
      startLogin: () => Effect.die("unused"),
      cancelLogin: () => Effect.die("unused"),
      logout: Effect.succeed(true),
    });
    const agentProviders = AgentProviderRuntime.of({
      list: () => Effect.succeed({ providers: [] }),
      resolveExecutionProfile: () => Effect.die("unused"),
      setCredential: (input) =>
        Effect.succeed({
          providerId: input.providerId,
          status: "ready",
          runtimeRestartPending: false,
        }),
      deleteCredential: (input) =>
        Effect.succeed({
          providerId: input.providerId,
          status: "missing",
          runtimeRestartPending: false,
        }),
      ensureRuntimeReady: Effect.void,
    });
    const composer = ComposerCatalog.of({
      listModels: Effect.succeed([
        {
          id: "model-a",
          model: "model-a",
          displayName: "Model A",
          description: "",
          hidden: false,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ]),
      listExperimentalFeatures: Effect.succeed([]),
      listCollaborationModes: Effect.succeed([]),
      listPlugins: () => Effect.succeed([]),
      activatePlugin: () => Effect.void,
      listSkills: () => Effect.succeed([]),
      listHooks: () => Effect.succeed({ data: [] }),
      updateHooksState: () => Effect.void,
    });
    const tools = CodexToolRuntime.of({
      readResource: () => Effect.die("unused"),
      callTool: () => Effect.die("unused"),
      listApps: Effect.succeed([]),
      listServerStatuses: Effect.die("unused"),
    });
    const externalSuggestions = ComposerExternalSuggestions.of({
      listSites: Effect.succeed({ available: false, sites: [] }),
      listChatGptConversations: () => Effect.succeed({ available: false, conversations: [] }),
    });
    const connection = CodexConnection.of({
      read: Effect.succeed({ status: "connected", retries: 0 }),
    });
    const media = CodexMedia.of({
      dictationState: Effect.succeed({
        isEnabled: true,
        authMethod: "chatgpt",
        isRealtimeVoiceActive: false,
        shortcutLabel: "Ctrl+M",
      }),
      transcribe: () => Effect.succeed("hello"),
      resolveImage: () => Effect.succeed({ ok: false, message: "not available", status: null }),
    });
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            Layer.succeed(
              ElectronWindowHost,
              ElectronWindowHost.of({
                all: Effect.succeed([]),
                destroyAll: Effect.void,
                onCreated: () => Effect.void,
              }),
            ),
            Layer.succeed(
              MainConfig,
              MainConfig.of({
                appVersion: "test",
                arch: "arm64",
                argv: [],
                isPackaged: false,
                nodexHome: "/tmp/nodex-test",
                platform: "darwin",
                profileId: "test",
                projectRootPath: "/repo",
                rendererUrl: "http://localhost:5173",
                resourcesPath: "/resources",
                runtimeBinaryPath: "/electron",
              }),
            ),
            Layer.succeed(CodexAccount, account),
            Layer.succeed(AgentProviderRuntime, agentProviders),
            Layer.succeed(CodexConnection, connection),
            Layer.succeed(CodexMedia, media),
            Layer.succeed(ComposerCatalog, composer),
            Layer.succeed(ComposerExternalSuggestions, externalSuggestions),
            Layer.succeed(CodexToolRuntime, tools),
          ),
        ),
      ),
      scope,
    );

    assert.isTrue(handlers.has("codex:account:read"));
    assert.isTrue(handlers.has("agent-runtime:catalog:get"));
    assert.isTrue(handlers.has("agent-runtime:credential:set"));
    assert.isTrue(handlers.has("agent-runtime:credential:delete"));
    assert.isTrue(handlers.has("codex:connection:status"));
    assert.isTrue(handlers.has("codex:dictation:state:read"));
    assert.isTrue(handlers.has("codex:dictation:transcribe"));
    assert.isTrue(handlers.has("codex:conversation-image-asset:resolve"));
    assert.isTrue(handlers.has("codex:experimental-features:list"));
    assert.isTrue(handlers.has("codex:collaboration-mode:list"));
    assert.isTrue(handlers.has("codex:composer-plugins:list"));
    assert.isTrue(handlers.has("codex:mcp-server-statuses:list"));
    assert.isTrue(handlers.has("codex:hooks:list"));
    assert.isTrue(handlers.has("codex:hooks:state:update"));
    const event = {} as IpcMainInvokeEvent;
    const models = yield* handlers.get("codex:model:list")!(event);
    assert.strictEqual((models as readonly { id: string }[])[0]?.id, "model-a");
    const invalid = yield* handlers.get("codex:composer-plugins:list")!(event, {
      cwds: ["relative/path"],
    }).pipe(Effect.result);
    assert.strictEqual(invalid._tag, "Failure");

    yield* Scope.close(scope, Exit.void);
  }),
);
