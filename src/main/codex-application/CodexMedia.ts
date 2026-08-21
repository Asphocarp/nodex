import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import type {
  CodexConversationImageAssetResolveInput,
  CodexConversationImageAssetResolveResult,
  CodexDictationStateSnapshot,
} from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { resolveChatGptBaseUrl } from "../codex/chatgpt-base-url";
import { ElectronNet } from "../platform/electron/ElectronNet";
import { ChatGptDesktop } from "./ChatGptDesktop";

const CODEX_DICTATION_SHORTCUT_LABEL = "Ctrl+M";
const CODEX_DICTATION_BASE64_HEADER = "X-Codex-Base64";

export class CodexMediaError extends Schema.TaggedError<CodexMediaError>()("CodexMediaError", {
  operation: Schema.String,
  message: Schema.String,
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

export const live: Layer.Layer<CodexMedia, never, CodexGateway | ChatGptDesktop | ElectronNet> =
  Layer.effect(
    CodexMedia,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const chatgpt = yield* ChatGptDesktop;
      const electron = yield* ElectronNet;
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
            });
          }
          return yield* Effect.try(() => {
            const parsed = JSON.parse(body) as { text?: unknown; body?: { text?: unknown } };
            if (typeof parsed.text === "string") return parsed.text;
            return typeof parsed.body?.text === "string" ? parsed.body.text : "";
          }).pipe(Effect.orElseSucceed(() => body.trim()));
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
        dictationState: chatgpt.authMethod.pipe(
          Effect.map(normalizeAuthMethod),
          Effect.orElseSucceed(() => null),
          Effect.map((authMethod) => ({
            isEnabled: authMethod === "chatgpt",
            authMethod,
            isRealtimeVoiceActive: false,
            shortcutLabel: CODEX_DICTATION_SHORTCUT_LABEL,
          })),
        ),
        transcribe,
        resolveImage,
      });
    }),
  );
