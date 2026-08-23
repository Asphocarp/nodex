import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ElectronNet } from "../platform/electron/ElectronNet";
import { ChatGptDesktop } from "./ChatGptDesktop";
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

const build = (chatgpt: ChatGptDesktop["Service"], scope: Scope.Closeable) =>
  Layer.buildWithScope(
    codexMediaLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(CodexGateway, gateway),
          Layer.succeed(ChatGptDesktop, chatgpt),
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

it.effect("owns dictation projection and transcription", () =>
  Effect.gen(function* () {
    const requests: string[] = [];
    const scope = yield* Scope.make();
    const context = yield* build(
      ChatGptDesktop.of({
        authStatus: () => Effect.die(new Error("unused")),
        authMethod: Effect.succeed("chatgptAuthTokens"),
        request: (input) => {
          requests.push(input.path);
          return Effect.succeed(new Response(JSON.stringify({ text: "hello" }), { status: 200 }));
        },
      }),
      scope,
    );
    const media = Context.get(context, CodexMedia);
    assert.deepEqual(yield* media.dictationState, {
      isEnabled: true,
      authMethod: "chatgpt",
      isRealtimeVoiceActive: false,
      shortcutLabel: "Ctrl+M",
    });
    assert.strictEqual(
      yield* media.transcribe({ contentType: "audio/webm", base64Payload: "AQID" }),
      "hello",
    );
    assert.deepEqual(requests, ["/transcribe"]);
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
