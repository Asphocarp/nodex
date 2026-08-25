import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { DEFAULT_DICTATION_SETTINGS } from "../../shared/dictation";
import { ElectronNet } from "../platform/electron/ElectronNet";
import { DictationRuntime } from "../host-runtime/DictationRuntime";
import { ChatGptDesktop } from "./ChatGptDesktop";
import { CodexAccount } from "./CodexAccount";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexConnection } from "./CodexConnection";
import { CodexMedia, live as codexMediaLive } from "./CodexMedia";

const unsupported = () => Effect.die(new Error("Unsupported test operation"));

const gateway = CodexGateway.of({
  localHostId: "local",
  requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
  requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
  events: Stream.empty,
  requestLocal: ((method: string) => {
    if (method === "config/read") {
      return Effect.succeed({ config: { chatgpt_base_url: "https://chatgpt.test" } });
    }
    throw new Error(`Unexpected request: ${method}`);
  }) as CodexGateway["Service"]["requestLocal"],
  requestOnHost: unsupported,
  requestForThread: unsupported,
  notifyLocal: unsupported,
  connection: unsupported,
  connectionChanges: () => Stream.empty,
  awaitReady: () => Effect.void,
  reconcileHost: unsupported,
  removeHost: unsupported,
  restartHost: unsupported,
});

const build = Effect.fn("CodexMediaTest.build")(function* (
  chatgpt: ChatGptDesktop["Service"],
  scope: Scope.Closeable,
) {
  const accountSnapshot = yield* SubscriptionRef.make({
    account: null,
    requiresOpenAiAuth: false,
  });
  return yield* Layer.buildWithScope(
    codexMediaLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(CodexGateway, gateway),
          Layer.succeed(ChatGptDesktop, chatgpt),
          Layer.succeed(
            CodexAccount,
            CodexAccount.of({ snapshot: accountSnapshot } as CodexAccount["Service"]),
          ),
          Layer.succeed(
            CodexApplicationEventHub,
            CodexApplicationEventHub.of({ events: Stream.empty, publish: () => undefined }),
          ),
          Layer.succeed(
            CodexConnection,
            CodexConnection.of({
              read: Effect.succeed({ status: "connected", retries: 0 }),
              changes: Stream.empty,
            }),
          ),
          Layer.succeed(
            DictationRuntime,
            DictationRuntime.of({
              changes: Stream.empty,
              globalAvailable: () => true,
              microphoneOwner: () => "none",
              setEnabled: () => Effect.void,
              readSettings: Effect.succeed({
                ...DEFAULT_DICTATION_SETTINGS,
                dictionary: ["Nodex", "useCartState"],
              }),
            } as unknown as DictationRuntime["Service"]),
          ),
          Layer.succeed(
            ElectronNet,
            ElectronNet.of({
              appVersion: "test",
              fetch: () =>
                Effect.succeed(
                  new Response(Uint8Array.from([1, 2, 3]), {
                    status: 200,
                    headers: { "content-type": "image/png" },
                  }),
                ),
              readBase64: (response) =>
                Effect.tryPromise(() =>
                  response.arrayBuffer().then((bytes) => Buffer.from(bytes).toString("base64")),
                ),
            }),
          ),
        ),
      ),
    ),
    scope,
  );
});

it.effect("owns dictation projection and transcription", () =>
  Effect.gen(function* () {
    const requests: string[] = [];
    const requestBodies: string[] = [];
    const scope = yield* Scope.make();
    const context = yield* build(
      ChatGptDesktop.of({
        authStatus: () => Effect.die(new Error("unused")),
        authMethod: Effect.succeed("chatgptAuthTokens"),
        request: (input) => {
          requests.push(input.path);
          if (typeof input.body === "string") requestBodies.push(input.body);
          return Effect.succeed(
            input.path === "/codex/responses"
              ? new Response(
                  'data: {"type":"response.output_text.delta","delta":"Nodex works"}\n\ndata: {"type":"response.output_text.done","text":"Nodex works"}\n\ndata: [DONE]\n\n',
                  { status: 200 },
                )
              : new Response(JSON.stringify({ text: "hello" }), { status: 200 }),
          );
        },
      }),
      scope,
    );
    const media = Context.get(context, CodexMedia);
    assert.deepEqual(yield* media.dictationState, {
      isEnabled: true,
      authMethod: "chatgpt",
      shortcutLabel: "Ctrl+M",
      capabilities: {
        composer: true,
        global: true,
        history: true,
        streaming: "unknown",
        semanticCleanup: true,
        microphoneOwner: "none",
        auth: "chatgpt",
      },
    });
    assert.strictEqual(
      yield* media.transcribe({ contentType: "audio/webm", base64Payload: "AQID" }),
      "hello",
    );
    assert.strictEqual(
      yield* media.cleanupTranscript({
        transcript: "node x works",
        surroundingText: "The project is open.",
      }),
      "Nodex works",
    );
    assert.deepEqual(requests, ["/transcribe", "/codex/responses"]);
    const cleanupRequest = JSON.parse(requestBodies.at(-1) ?? "") as {
      model: string;
      stream: boolean;
      input: Array<{ content: Array<{ text: string }> }>;
    };
    assert.strictEqual(cleanupRequest.model, "gpt-5.6-luna");
    assert.isTrue(cleanupRequest.stream);
    assert.match(cleanupRequest.input[0]?.content[0]?.text ?? "", /Nodex\nuseCartState/u);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("resolves generated images without leaking transport failures", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* build(
      ChatGptDesktop.of({
        authStatus: () => Effect.die(new Error("unused")),
        authMethod: Effect.succeed("chatgpt"),
        request: () =>
          Effect.succeed(
            new Response(
              JSON.stringify({ status: "success", download_url: "https://files.test/image" }),
              { status: 200 },
            ),
          ),
      }),
      scope,
    );
    const media = Context.get(context, CodexMedia);
    assert.deepEqual(
      yield* media.resolveImage({ hostId: "default", pointer: "file-service://file-1" }),
      { ok: true, dataBase64: "AQID", mimeType: "image/png" },
    );
    assert.deepEqual(
      yield* media.resolveImage({ hostId: "remote", pointer: "file-service://file-1" }),
      { ok: false, message: "Unsupported Codex image asset host: remote", status: null },
    );
    yield* Scope.close(scope, Exit.void);
  }),
);
