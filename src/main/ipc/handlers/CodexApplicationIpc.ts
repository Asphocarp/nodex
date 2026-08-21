import { isAbsolute } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { IpcMainInvokeEvent } from "electron";
import type { McpResourceReadParams } from "@nodex/codex-app-server-protocol/v2/McpResourceReadParams";
import type { McpServerToolCallParams } from "@nodex/codex-app-server-protocol/v2/McpServerToolCallParams";
import type {
  CodexComposerPluginActivateInput,
  CodexComposerPluginListInput,
  CodexComposerSkillListInput,
  CodexConversationImageAssetResolveInput,
  CodexRateLimitResetInput,
} from "../../../shared/types";
import type {
  AgentProviderCredentialDeleteInput,
  AgentProviderCredentialMutationInput,
} from "../../../shared/agent-runtime";
import type { IpcEvents } from "../../../shared/ipc-api";
import type { CodexHooksListInput, CodexHooksStateUpdateInput } from "../../../shared/codex-hooks";
import { DEFAULT_CODEX_HOST_ID } from "../../../shared/codex-host";
import { CodexAccount, type CodexAccountLoginInput } from "../../codex-application/CodexAccount";
import { AgentProviderRuntime } from "../../codex-application/AgentProviderRuntime";
import { CodexConnection } from "../../codex-application/CodexConnection";
import { CodexMedia } from "../../codex-application/CodexMedia";
import { CodexToolRuntime } from "../../codex-application/CodexToolRuntime";
import { ComposerCatalog } from "../../codex-application/ComposerCatalog";
import { ComposerExternalSuggestions } from "../../codex-application/ComposerExternalSuggestions";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { ElectronWindowHost } from "../../platform/electron/ElectronWindowHost";
import { safeBroadcastToWindows } from "../../ipc-safe-send";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { MainConfig } from "../../app/MainConfig";
import { validateDictationTranscriptionInput } from "../../dictation-transcription-input";

export class CodexApplicationIpcError extends Schema.TaggedError<CodexApplicationIpcError>()(
  "CodexApplicationIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const validate = <A>(
  operation: string,
  parse: () => A,
): Effect.Effect<A, CodexApplicationIpcError> =>
  Effect.try({
    try: parse,
    catch: (cause) => new CodexApplicationIpcError({ operation, cause }),
  });

const parseComposerInventoryCwds = (
  input: CodexComposerPluginListInput | CodexComposerSkillListInput,
): string[] => {
  if (
    typeof input !== "object" ||
    input === null ||
    !Array.isArray(input.cwds) ||
    input.cwds.length > 32 ||
    input.cwds.some(
      (cwd) =>
        typeof cwd !== "string" ||
        cwd.length > 4_096 ||
        (cwd.trim().length > 0 && !isAbsolute(cwd.trim())),
    )
  ) {
    throw new Error("Invalid composer inventory input");
  }
  return input.cwds;
};

const parseComposerPluginActivation = (
  input: CodexComposerPluginActivateInput,
): CodexComposerPluginActivateInput => {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.id !== "string" ||
    input.id.trim().length === 0 ||
    input.id.length > 512
  ) {
    throw new Error("Invalid composer plugin activation input");
  }
  return { id: input.id.trim(), cwds: parseComposerInventoryCwds(input) };
};

const parseProviderCredential = (input: unknown): AgentProviderCredentialMutationInput => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("providerId" in input) ||
    typeof input.providerId !== "string" ||
    !("apiKey" in input) ||
    typeof input.apiKey !== "string"
  ) {
    throw new Error("Invalid provider credential input");
  }
  return { providerId: input.providerId, apiKey: input.apiKey };
};

const parseProviderCredentialDelete = (input: unknown): AgentProviderCredentialDeleteInput => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("providerId" in input) ||
    typeof input.providerId !== "string"
  ) {
    throw new Error("Invalid provider credential delete input");
  }
  return { providerId: input.providerId };
};

export const live: Layer.Layer<
  never,
  never,
  | ElectronIpc
  | ElectronWindowHost
  | MainConfig
  | AgentProviderRuntime
  | CodexAccount
  | CodexConnection
  | CodexMedia
  | ComposerCatalog
  | ComposerExternalSuggestions
  | CodexToolRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const ipc = yield* ElectronIpc;
    const windows = yield* ElectronWindowHost;
    const config = yield* MainConfig;
    const agentProviders = yield* AgentProviderRuntime;
    const account = yield* CodexAccount;
    const connection = yield* CodexConnection;
    const media = yield* CodexMedia;
    const composer = yield* ComposerCatalog;
    const externalSuggestions = yield* ComposerExternalSuggestions;
    const tools = yield* CodexToolRuntime;
    const trusted = (event: IpcMainInvokeEvent, capabilityName: string) =>
      validate("authorize-renderer", () =>
        requireTrustedAppRendererSender(event, capabilityName, config.rendererUrl),
      );

    yield* SubscriptionRef.changes(account.snapshot).pipe(
      Stream.runForEach((snapshot) =>
        windows.all.pipe(
          Effect.tap((all) =>
            Effect.sync(() => {
              const rateLimits = snapshot.rateLimits ?? null;
              safeBroadcastToWindows(all, "codex:event" satisfies keyof IpcEvents, [
                { type: "rateLimits", rateLimits },
              ]);
              safeBroadcastToWindows(all, "codex:host-message" satisfies keyof IpcEvents, [
                {
                  type: "sharedObjectUpdated",
                  hostId: DEFAULT_CODEX_HOST_ID,
                  object: { objectType: "rateLimits", objectId: "rateLimits", value: rateLimits },
                },
              ]);
              safeBroadcastToWindows(all, "codex:event" satisfies keyof IpcEvents, [
                { type: "account", account: snapshot },
              ]);
              safeBroadcastToWindows(all, "codex:host-message" satisfies keyof IpcEvents, [
                {
                  type: "sharedObjectUpdated",
                  hostId: DEFAULT_CODEX_HOST_ID,
                  object: { objectType: "account", objectId: "account", value: snapshot },
                },
              ]);
            }),
          ),
          Effect.asVoid,
        ),
      ),
      Effect.forkScoped,
    );

    yield* ipc.handle("codex:account:read", () => account.refresh);
    yield* ipc.handle(
      "codex:account:rate-limit-reset:consume",
      (_event, input: CodexRateLimitResetInput) => account.consumeRateLimitResetCredit(input),
    );
    yield* ipc.handle("codex:account:login:start", (_event, input: CodexAccountLoginInput) =>
      account.startLogin(input),
    );
    yield* ipc.handle("codex:account:login:cancel", (_event, loginId: string) =>
      account.cancelLogin(loginId),
    );
    yield* ipc.handle("codex:account:logout", () => account.logout);
    yield* ipc.handle("codex:connection:status", () => connection.read);
    yield* ipc.handle("agent-runtime:catalog:get", (_event, options?: { refresh?: boolean }) =>
      agentProviders.list({ refresh: options?.refresh === true }),
    );
    yield* ipc.handle("agent-runtime:credential:set", (_event, input: unknown) =>
      validate("agent-provider-credential-set", () => parseProviderCredential(input)).pipe(
        Effect.flatMap(agentProviders.setCredential),
      ),
    );
    yield* ipc.handle("agent-runtime:credential:delete", (_event, input: unknown) =>
      validate("agent-provider-credential-delete", () => parseProviderCredentialDelete(input)).pipe(
        Effect.flatMap(agentProviders.deleteCredential),
      ),
    );
    yield* ipc.handle("codex:dictation:state:read", () => media.dictationState);
    yield* ipc.handle("codex:dictation:transcribe", (event, input: unknown) =>
      trusted(event, "Dictation transcription").pipe(
        Effect.andThen(
          validate("dictation-transcription-input", () =>
            validateDictationTranscriptionInput(input),
          ),
        ),
        Effect.flatMap(media.transcribe),
      ),
    );
    yield* ipc.handle(
      "codex:conversation-image-asset:resolve",
      (_event, input: CodexConversationImageAssetResolveInput) => media.resolveImage(input),
    );

    yield* ipc.handle("codex:model:list", () => composer.listModels);
    yield* ipc.handle("codex:collaboration-mode:list", () => composer.listCollaborationModes);
    yield* ipc.handle("codex:experimental-features:list", (event) =>
      trusted(event, "Experimental feature access").pipe(
        Effect.andThen(composer.listExperimentalFeatures),
      ),
    );
    yield* ipc.handle(
      "codex:composer-plugins:list",
      (_event, input: CodexComposerPluginListInput) =>
        validate("composer-plugins-list", () => parseComposerInventoryCwds(input)).pipe(
          Effect.flatMap(composer.listPlugins),
        ),
    );
    yield* ipc.handle(
      "codex:composer-plugins:activate",
      (_event, input: CodexComposerPluginActivateInput) =>
        validate("composer-plugin-activate", () => parseComposerPluginActivation(input)).pipe(
          Effect.flatMap(composer.activatePlugin),
        ),
    );
    yield* ipc.handle("codex:composer-skills:list", (_event, input: CodexComposerSkillListInput) =>
      validate("composer-skills-list", () => parseComposerInventoryCwds(input)).pipe(
        Effect.flatMap(composer.listSkills),
      ),
    );
    yield* ipc.handle("codex:hooks:list", (_event, input: CodexHooksListInput) =>
      composer.listHooks(input),
    );
    yield* ipc.handle("codex:hooks:state:update", (_event, input: CodexHooksStateUpdateInput) =>
      composer.updateHooksState(input).pipe(
        Effect.andThen(
          windows.all.pipe(
            Effect.tap((all) =>
              Effect.sync(() => {
                safeBroadcastToWindows(all, "codex:hooks:changed" satisfies keyof IpcEvents, [
                  { hostId: input.hostId },
                ]);
              }),
            ),
            Effect.asVoid,
          ),
        ),
      ),
    );
    yield* ipc.handle("codex:composer-sites:list", () => externalSuggestions.listSites);
    yield* ipc.handle("codex:composer-chatgpt-conversations:list", (_event, input: unknown) =>
      validate("composer-chatgpt-conversations-list", () => {
        if (
          typeof input !== "object" ||
          input === null ||
          !("query" in input) ||
          typeof input.query !== "string" ||
          input.query.length > 1_000
        ) {
          throw new Error("Invalid composer ChatGPT conversation query");
        }
        return input.query.trim();
      }).pipe(Effect.flatMap(externalSuggestions.listChatGptConversations)),
    );

    yield* ipc.handle("codex:mcp-resource:read", (event, params: McpResourceReadParams) =>
      trusted(event, "MCP resource access").pipe(Effect.andThen(tools.readResource(params))),
    );
    yield* ipc.handle("codex:mcp-tool:call", (event, params: McpServerToolCallParams) =>
      trusted(event, "MCP tool access").pipe(Effect.andThen(tools.callTool(params))),
    );
    yield* ipc.handle("codex:mcp-apps:list", (event) =>
      trusted(event, "MCP app access").pipe(Effect.andThen(tools.listApps)),
    );
    yield* ipc.handle("codex:mcp-server-statuses:list", (event) =>
      trusted(event, "MCP server status access").pipe(Effect.andThen(tools.listServerStatuses)),
    );
  }),
);
