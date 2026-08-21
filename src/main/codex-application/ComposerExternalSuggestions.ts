import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type {
  CodexComposerChatGptConversationListResult,
  CodexComposerSiteListResult,
} from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { resolveChatGptBaseUrl } from "../codex/chatgpt-base-url";
import {
  parseComposerChatGptConversations,
  parseComposerSitesToolResponse,
} from "../codex/composer-external-suggestion-service";
import { ChatGptDesktop } from "./ChatGptDesktop";

const CHATGPT_RECENT_CONVERSATION_LIMIT = 5;
const CHATGPT_CONVERSATION_QUERY_MAX_CHARACTERS = 100;
const SITES_PAGE_LIMIT = 20;
const CHATGPT_ATTACH_HEADERS = {
  "X-OpenAI-Attach-Auth": "1",
  "X-OpenAI-Attach-Integrity-State": "1",
} as const;

export class ComposerExternalSuggestions extends Context.Service<
  ComposerExternalSuggestions,
  {
    readonly listSites: Effect.Effect<CodexComposerSiteListResult>;
    readonly listChatGptConversations: (
      query: string,
    ) => Effect.Effect<CodexComposerChatGptConversationListResult>;
  }
>()("nodex/main/codex-application/ComposerExternalSuggestions") {}

const isChatGptAuthMethod = (value: string | null): boolean =>
  value === "chatgpt" || value === "chatgptAuthTokens";

const readJson = (response: Response): Effect.Effect<unknown> =>
  Effect.tryPromise(() => response.json()).pipe(Effect.orElseSucceed(() => null));

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const recentConversationPath = (): string => {
  const query = new URLSearchParams({
    expand: "false",
    is_archived: "false",
    limit: String(CHATGPT_RECENT_CONVERSATION_LIMIT),
    order: "updated",
    offset: "0",
  });
  return `/conversations?${query.toString()}`;
};

const conversationSearchPath = (query: string): string =>
  `/conversations/search?${new URLSearchParams({ query }).toString()}`;

export const live: Layer.Layer<ComposerExternalSuggestions, never, CodexGateway | ChatGptDesktop> =
  Layer.effect(
    ComposerExternalSuggestions,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const chatgpt = yield* ChatGptDesktop;
      const isAvailable = chatgpt.authMethod.pipe(
        Effect.map(isChatGptAuthMethod),
        Effect.orElseSucceed(() => false),
      );
      const readConfig = gateway
        .requestLocal("config/read", { includeLayers: false })
        .pipe(Effect.map((config) => config as ConfigReadResponse));
      const baseUrl = (config: ConfigReadResponse) =>
        Effect.try(() => resolveChatGptBaseUrl(config));

      const listSites: ComposerExternalSuggestions["Service"]["listSites"] = Effect.gen(
        function* () {
          if (!(yield* isAvailable)) return { available: false, sites: [] };
          const access = yield* Effect.gen(function* () {
            const config = yield* readConfig;
            const origin = new URL(yield* baseUrl(config)).origin;
            const response = yield* chatgpt.request({
              action: "check Sites availability",
              baseUrl: origin,
              path: "/wham/sites/access",
              method: "GET",
              headers: CHATGPT_ATTACH_HEADERS,
              refreshOn401: true,
            });
            if (!response.ok) return null;
            const payload = asRecord(yield* readJson(response));
            return payload?.enabled === true ? origin : null;
          }).pipe(Effect.orElseSucceed(() => null));
          if (access === null) return { available: false, sites: [] };

          return yield* Effect.gen(function* () {
            const response = yield* chatgpt.request({
              action: "list Sites projects",
              baseUrl: access,
              path: "/wham/apps",
              method: "POST",
              headers: { ...CHATGPT_ATTACH_HEADERS, "Content-Type": "application/json" },
              body: JSON.stringify({
                id: 1,
                jsonrpc: "2.0",
                method: "tools/call",
                params: { arguments: { limit: SITES_PAGE_LIMIT }, name: "sites_list_sites" },
              }),
              refreshOn401: true,
            });
            if (!response.ok) return { available: true, sites: [] };
            return {
              available: true,
              sites: parseComposerSitesToolResponse(yield* readJson(response)),
            };
          }).pipe(Effect.orElseSucceed(() => ({ available: true, sites: [] })));
        },
      );

      return ComposerExternalSuggestions.of({
        listSites,
        listChatGptConversations: (query) =>
          Effect.gen(function* () {
            if (!(yield* isAvailable)) return { available: false, conversations: [] };
            return yield* Effect.gen(function* () {
              const config = yield* readConfig;
              const normalized = query.trim().slice(0, CHATGPT_CONVERSATION_QUERY_MAX_CHARACTERS);
              const response = yield* chatgpt.request({
                action: "list ChatGPT conversations",
                baseUrl: yield* baseUrl(config),
                path: normalized ? conversationSearchPath(normalized) : recentConversationPath(),
                method: "GET",
                headers: CHATGPT_ATTACH_HEADERS,
                refreshOn401: true,
              });
              if (!response.ok) return { available: true, conversations: [] };
              return {
                available: true,
                conversations: parseComposerChatGptConversations(yield* readJson(response)),
              };
            }).pipe(Effect.orElseSucceed(() => ({ available: true, conversations: [] })));
          }),
      });
    }),
  );
