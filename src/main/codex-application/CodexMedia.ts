import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import type { DictationStreamingConnectInfo } from "../../shared/dictation-streaming";
import type {
  CodexConversationImageAssetResolveInput,
  CodexConversationImageAssetResolveResult,
  CodexDictationStateSnapshot,
} from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { resolveChatGptBaseUrl } from "../codex/chatgpt-base-url";
import { ElectronNet } from "../platform/electron/ElectronNet";
import { DictationRuntime } from "../host-runtime/DictationRuntime";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexAccount } from "./CodexAccount";
import { CodexConnection } from "./CodexConnection";
import { ChatGptDesktop } from "./ChatGptDesktop";

const CODEX_DICTATION_SHORTCUT_LABEL = "Ctrl+M";
const CODEX_DICTATION_BASE64_HEADER = "X-Codex-Base64";

export class CodexMediaError extends Schema.TaggedError<CodexMediaError>()("CodexMediaError", {
  operation: Schema.String,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Number),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class CodexMedia extends Context.Service<
  CodexMedia,
  {
    readonly dictationState: Effect.Effect<CodexDictationStateSnapshot>;
    readonly transcribe: (input: {
      readonly contentType: string;
      readonly base64Payload: string;
    }) => Effect.Effect<string, CodexMediaError>;
    readonly prepareStreamingConnectInfo: Effect.Effect<
      DictationStreamingConnectInfo,
      CodexMediaError
    >;
    readonly resolveImage: (
      input: CodexConversationImageAssetResolveInput,
    ) => Effect.Effect<CodexConversationImageAssetResolveResult>;
  }
>()("nodex/main/codex-application/CodexMedia") {}

const normalizeAuthMethod = (value: string | null): CodexDictationStateSnapshot["authMethod"] => {
  if (value === "chatgpt" || value === "chatgptAuthTokens") return "chatgpt";
  if (value === "apikey" || value === "apiKey") return "apiKey";
  return null;
};

const parsePointerFileId = (pointer: string): string | null => {
  const match = /^(?:file-service|sediment):\/\/(.+)$/u.exec(pointer.trim());
  const fileId = match?.[1]?.trim() ?? "";
  return fileId.length > 0 ? fileId : null;
};

const failure = (
  message: string,
  status: number | null = null,
): CodexConversationImageAssetResolveResult => ({ ok: false, message, status });

const responseText = (response: Response): Effect.Effect<string, CodexMediaError> =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new CodexMediaError({
        operation: "read-response",
        message: "Could not read response",
        cause,
      }),
  });

const areDictationStatesEqual = (
  left: CodexDictationStateSnapshot,
  right: CodexDictationStateSnapshot,
): boolean =>
  left.isEnabled === right.isEnabled &&
  left.authMethod === right.authMethod &&
  left.shortcutLabel === right.shortcutLabel &&
  left.capabilities.composer === right.capabilities.composer &&
  left.capabilities.global === right.capabilities.global &&
  left.capabilities.history === right.capabilities.history &&
  left.capabilities.streaming === right.capabilities.streaming &&
  left.capabilities.semanticCleanup === right.capabilities.semanticCleanup &&
  left.capabilities.microphoneOwner === right.capabilities.microphoneOwner &&
  left.capabilities.auth === right.capabilities.auth;

const initialDictationState = (): CodexDictationStateSnapshot => ({
  isEnabled: false,
  authMethod: null,
  shortcutLabel: CODEX_DICTATION_SHORTCUT_LABEL,
  capabilities: {
    composer: false,
    global: false,
    history: true,
    streaming: "unavailable",
    semanticCleanup: false,
    microphoneOwner: "none",
    auth: "unsupported",
  },
});

export const live: Layer.Layer<
  CodexMedia,
  never,
  | CodexGateway
  | ChatGptDesktop
  | ElectronNet
  | CodexAccount
  | CodexConnection
  | CodexApplicationEventHub
  | DictationRuntime
> = Layer.effect(
  CodexMedia,
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const chatgpt = yield* ChatGptDesktop;
    const electron = yield* ElectronNet;
    const account = yield* CodexAccount;
    const connection = yield* CodexConnection;
    const applicationEvents = yield* CodexApplicationEventHub;
    const dictation = yield* DictationRuntime;
    const authMethod = yield* SubscriptionRef.make<CodexDictationStateSnapshot["authMethod"]>(null);
    const streamingAvailability =
      yield* SubscriptionRef.make<CodexDictationStateSnapshot["capabilities"]["streaming"]>(
        "unavailable",
      );
    const dictationState = yield* SubscriptionRef.make(initialDictationState());
    const readBaseUrl = gateway.requestLocal("config/read", { includeLayers: false }).pipe(
      Effect.flatMap((config) =>
        Effect.try({
          try: () => resolveChatGptBaseUrl(config as ConfigReadResponse),
          catch: (cause) =>
            new CodexMediaError({
              operation: "resolve-base-url",
              message: "ChatGPT endpoint is unavailable",
              cause,
            }),
        }),
      ),
      Effect.mapError((cause) =>
        Schema.is(CodexMediaError)(cause)
          ? cause
          : new CodexMediaError({
              operation: "read-config",
              message: "Could not read agent configuration",
              cause,
            }),
      ),
    );

    const transcribe: CodexMedia["Service"]["transcribe"] = (input) =>
      Effect.gen(function* () {
        const baseUrl = yield* readBaseUrl;
        const response = yield* chatgpt
          .request({
            action: "transcribe audio",
            baseUrl,
            path: "/transcribe",
            method: "POST",
            headers: {
              "Content-Type": input.contentType,
              [CODEX_DICTATION_BASE64_HEADER]: "1",
            },
            body: input.base64Payload,
            refreshOn401: true,
            missingAuthErrorMessage: "ChatGPT authentication is required for dictation.",
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new CodexMediaError({
                  operation: "transcribe-request",
                  message: cause instanceof Error ? cause.message : "Unable to transcribe audio",
                  cause,
                }),
            ),
          );
        const body = yield* responseText(response);
        if (!response.ok) {
          yield* Effect.logWarning("Dictation transcribe proxy failed").pipe(
            Effect.annotateLogs({ status: response.status }),
          );
          return yield* new CodexMediaError({
            operation: "transcribe-response",
            message: "Unable to transcribe audio",
            status: response.status,
          });
        }
        return yield* Effect.try(() => {
          const parsed = JSON.parse(body) as { text?: unknown; body?: { text?: unknown } };
          if (typeof parsed.text === "string") return parsed.text;
          return typeof parsed.body?.text === "string" ? parsed.body.text : "";
        }).pipe(Effect.orElseSucceed(() => body.trim()));
      });

    const makeDictationState = Effect.fn("CodexMedia.makeDictationState")(function* (
      method: CodexDictationStateSnapshot["authMethod"],
    ) {
      const streaming = yield* SubscriptionRef.get(streamingAvailability);
      const enabled = method === "chatgpt";
      return {
        isEnabled: enabled,
        authMethod: method,
        shortcutLabel: CODEX_DICTATION_SHORTCUT_LABEL,
        capabilities: {
          composer: enabled,
          global: enabled && dictation.globalAvailable(),
          history: true,
          streaming: enabled ? streaming : "unavailable",
          semanticCleanup: false,
          microphoneOwner: dictation.microphoneOwner(),
          auth: enabled ? "chatgpt" : "unsupported",
        },
      } satisfies CodexDictationStateSnapshot;
    });

    const publishDictationState = Effect.fn("CodexMedia.publishDictationState")(function* (
      next: CodexDictationStateSnapshot,
    ) {
      const previous = yield* SubscriptionRef.get(dictationState);
      if (areDictationStatesEqual(previous, next)) return;
      yield* SubscriptionRef.set(dictationState, next);
      applicationEvents.publish({
        kind: "codex",
        value: { type: "dictationState", state: next },
      });
    });

    const refreshForAuthMethod = Effect.fn("CodexMedia.refreshForAuthMethod")(function* (
      nextAuthMethod: CodexDictationStateSnapshot["authMethod"],
    ) {
      const previousAuthMethod = yield* SubscriptionRef.get(authMethod);
      if (previousAuthMethod !== nextAuthMethod) {
        yield* SubscriptionRef.set(authMethod, nextAuthMethod);
        yield* SubscriptionRef.set(
          streamingAvailability,
          nextAuthMethod === "chatgpt" ? "unknown" : "unavailable",
        );
      }
      yield* dictation
        .setEnabled(nextAuthMethod === "chatgpt")
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Global dictation activation failed").pipe(
              Effect.annotateLogs({ operation: error.operation }),
            ),
          ),
        );
      yield* publishDictationState(yield* makeDictationState(nextAuthMethod));
    });

    const refreshAuth = chatgpt.authMethod.pipe(
      Effect.map(normalizeAuthMethod),
      Effect.orElseSucceed(() => null),
      Effect.flatMap(refreshForAuthMethod),
    );
    const refreshCurrent = SubscriptionRef.get(authMethod).pipe(
      Effect.flatMap((method) => makeDictationState(method)),
      Effect.flatMap(publishDictationState),
    );
    const setStreamingAvailability = Effect.fn("CodexMedia.setStreamingAvailability")(function* (
      next: CodexDictationStateSnapshot["capabilities"]["streaming"],
    ) {
      const current = yield* SubscriptionRef.get(streamingAvailability);
      if (current === next) return;
      yield* SubscriptionRef.set(streamingAvailability, next);
      yield* refreshCurrent;
    });

    yield* refreshAuth;
    yield* SubscriptionRef.changes(account.snapshot).pipe(
      Stream.runForEach(() => refreshAuth),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* connection.changes.pipe(
      Stream.runForEach(() =>
        SubscriptionRef.get(authMethod).pipe(
          Effect.flatMap((method) =>
            setStreamingAvailability(method === "chatgpt" ? "unknown" : "unavailable"),
          ),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* dictation.changes.pipe(
      Stream.runForEach(() => refreshCurrent),
      Effect.forkScoped({ startImmediately: true }),
    );

    const prepareStreamingConnectInfo = Effect.gen(function* () {
      const method = yield* SubscriptionRef.get(authMethod);
      if (method !== "chatgpt") {
        return yield* new CodexMediaError({
          operation: "streaming-auth",
          message: "ChatGPT authentication is required for dictation",
          status: 401,
        });
      }
      if ((yield* SubscriptionRef.get(streamingAvailability)) === "unavailable") {
        return yield* new CodexMediaError({
          operation: "streaming-unavailable",
          message: "Streaming dictation is unavailable",
          status: 404,
        });
      }
      const baseUrl = yield* readBaseUrl;
      const response = yield* chatgpt
        .request({
          action: "prepare streaming dictation",
          baseUrl,
          path: "/codex/dictation-stream-connect-info",
          method: "POST",
          refreshOn401: true,
          missingAuthErrorMessage: "ChatGPT authentication is required for dictation.",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new CodexMediaError({
                operation: "streaming-connect-info-request",
                message: "Unable to prepare streaming dictation",
                cause,
              }),
          ),
        );
      if (!response.ok) {
        if (response.status === 404 || response.status === 410 || response.status === 501) {
          yield* setStreamingAvailability("unavailable");
        }
        return yield* new CodexMediaError({
          operation: "streaming-connect-info-response",
          message: "Unable to prepare streaming dictation",
          status: response.status,
        });
      }
      const body = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new CodexMediaError({
            operation: "streaming-connect-info-decode",
            message: "Invalid streaming dictation response",
            cause,
          }),
      });
      if (
        typeof body !== "object" ||
        body === null ||
        !("websocketUrl" in body) ||
        typeof body.websocketUrl !== "string" ||
        !("protocols" in body) ||
        !Array.isArray(body.protocols) ||
        !body.protocols.every((protocol: unknown) => typeof protocol === "string")
      ) {
        return yield* new CodexMediaError({
          operation: "streaming-connect-info-decode",
          message: "Invalid streaming dictation response",
          status: 502,
        });
      }
      yield* setStreamingAvailability("available");
      return {
        websocketUrl: body.websocketUrl,
        protocols: body.protocols,
      } satisfies DictationStreamingConnectInfo;
    });

    const resolveImage: CodexMedia["Service"]["resolveImage"] = (input) => {
      if (input.hostId !== DEFAULT_CODEX_HOST_ID) {
        return Effect.succeed(failure(`Unsupported Codex image asset host: ${input.hostId}`));
      }
      const fileId = parsePointerFileId(input.pointer);
      if (fileId === null) return Effect.succeed(failure("Invalid Codex image asset pointer"));

      return Effect.gen(function* () {
        const baseUrl = yield* readBaseUrl;
        const link = yield* chatgpt.request({
          action: "resolve a generated image",
          baseUrl,
          path: `/files/download/${encodeURIComponent(fileId)}`,
          method: "GET",
          refreshOn401: true,
          missingAuthErrorMessage:
            "ChatGPT authentication is required to load this generated image.",
        });
        if (!link.ok) {
          const message = yield* responseText(link).pipe(
            Effect.orElseSucceed(() => link.statusText || "Request failed"),
          );
          return failure(message.trim() || link.statusText || "Request failed", link.status);
        }
        const payload = yield* Effect.tryPromise(() => link.json());
        if (typeof payload !== "object" || payload === null) {
          return failure("Generated image download response is invalid");
        }
        const record = payload as { readonly status?: unknown; readonly download_url?: unknown };
        if (record.status != null && record.status !== "success") {
          return failure("Generated image download is not ready");
        }
        const downloadUrl =
          typeof record.download_url === "string" ? record.download_url.trim() : "";
        if (!downloadUrl)
          return failure("Generated image download response is missing download_url");
        const download = yield* electron.fetch(downloadUrl, {
          method: "GET",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!download.ok) {
          const message = yield* responseText(download).pipe(
            Effect.orElseSucceed(() => download.statusText || "Request failed"),
          );
          return failure(
            message.trim() || download.statusText || "Request failed",
            download.status,
          );
        }
        return {
          ok: true,
          dataBase64: yield* electron.readBase64(download),
          mimeType: download.headers.get("content-type"),
        } satisfies CodexConversationImageAssetResolveResult;
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            failure(error instanceof Error ? error.message : "Could not load generated image"),
          ),
        ),
      );
    };

    return CodexMedia.of({
      dictationState: SubscriptionRef.get(dictationState),
      transcribe,
      prepareStreamingConnectInfo,
      resolveImage,
    });
  }),
);
