import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { AppInfo } from "@nodex/codex-app-server-protocol/v2/AppInfo";
import type { ListMcpServerStatusResponse } from "@nodex/codex-app-server-protocol/v2/ListMcpServerStatusResponse";
import type { McpResourceReadParams } from "@nodex/codex-app-server-protocol/v2/McpResourceReadParams";
import type { McpResourceReadResponse } from "@nodex/codex-app-server-protocol/v2/McpResourceReadResponse";
import type { McpServerToolCallParams } from "@nodex/codex-app-server-protocol/v2/McpServerToolCallParams";
import type { McpServerToolCallResponse } from "@nodex/codex-app-server-protocol/v2/McpServerToolCallResponse";
import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import { normalizeCodexAppInfoLogos } from "../../shared/codex-app-info";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CodexAccount } from "./CodexAccount";

export interface CodexToolRuntimeOptions {
  readonly supportsChatGptApps: boolean;
}

export class CodexToolRuntime extends Context.Service<
  CodexToolRuntime,
  {
    readonly readResource: (
      params: McpResourceReadParams,
    ) => Effect.Effect<McpResourceReadResponse, CodexRuntimeError>;
    readonly callTool: (
      params: McpServerToolCallParams,
    ) => Effect.Effect<McpServerToolCallResponse, CodexRuntimeError>;
    readonly listApps: Effect.Effect<readonly AppInfo[], CodexRuntimeError>;
    readonly listServerStatuses: Effect.Effect<ListMcpServerStatusResponse, CodexRuntimeError>;
  }
>()("nodex/main/codex-application/CodexToolRuntime") {}

const asPlainResponse = <A>(value: unknown): A => value as A;

type ServerStatusEffect = Effect.Effect<ListMcpServerStatusResponse, CodexRuntimeError>;
interface ServerStatusSelection {
  readonly effect: ServerStatusEffect;
  readonly owner: boolean;
}

export const live = (
  options: CodexToolRuntimeOptions,
): Layer.Layer<CodexToolRuntime, never, CodexGateway | CodexAccount> =>
  Layer.effect(
    CodexToolRuntime,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const account = yield* CodexAccount;
      const awaitReady = gateway.awaitReady(gateway.localHostId);
      const statusInFlight = yield* Ref.make<ServerStatusEffect | null>(null);

      const fetchApps = Effect.gen(function* () {
        const apps: AppInfo[] = [];
        let cursor: string | null = null;
        do {
          const response: ClientRequestResponsesByMethod["app/list"] = yield* gateway.requestLocal(
            "app/list",
            {
              cursor,
              forceRefetch: false,
              limit: 1_000,
            },
          );
          apps.push(
            ...asPlainResponse<ClientRequestResponsesByMethod["app/list"]>(response).data.map(
              (app) => asPlainResponse<AppInfo>(app),
            ),
          );
          cursor = response.nextCursor ?? null;
        } while (cursor !== null);
        return normalizeCodexAppInfoLogos(apps);
      });

      const fetchServerStatuses = gateway
        .requestLocal("mcpServerStatus/list", { detail: "full", cursor: null, limit: 100 })
        .pipe(Effect.map(asPlainResponse<ListMcpServerStatusResponse>));

      const listServerStatuses = Effect.gen(function* () {
        const candidate = yield* Effect.cached(fetchServerStatuses);
        const selection = yield* Ref.modify<ServerStatusEffect | null, ServerStatusSelection>(
          statusInFlight,
          (current) =>
            current === null
              ? [{ effect: candidate, owner: true }, candidate]
              : [{ effect: current, owner: false }, current],
        );
        if (!selection.owner) return yield* selection.effect;
        return yield* selection.effect.pipe(
          Effect.ensuring(
            Ref.update(statusInFlight, (current) =>
              current === selection.effect ? null : current,
            ),
          ),
        );
      });

      return CodexToolRuntime.of({
        readResource: (params) =>
          awaitReady.pipe(
            Effect.andThen(
              gateway.requestLocal(
                "mcpServer/resource/read",
                params as unknown as ClientRequestParamsByMethod["mcpServer/resource/read"],
              ),
            ),
            Effect.map(asPlainResponse<McpResourceReadResponse>),
          ),
        callTool: (params) =>
          awaitReady.pipe(
            Effect.andThen(
              gateway.requestLocal(
                "mcpServer/tool/call",
                params as unknown as ClientRequestParamsByMethod["mcpServer/tool/call"],
              ),
            ),
            Effect.map(asPlainResponse<McpServerToolCallResponse>),
          ),
        listApps: Effect.gen(function* () {
          if (!options.supportsChatGptApps) return [];
          const snapshot = yield* SubscriptionRef.get(account.snapshot);
          if (snapshot.account?.type !== "chatgpt") return [];
          yield* awaitReady;
          return yield* fetchApps.pipe(Effect.retry({ times: 1 }));
        }),
        listServerStatuses: awaitReady.pipe(Effect.andThen(listServerStatuses)),
      });
    }),
  );
