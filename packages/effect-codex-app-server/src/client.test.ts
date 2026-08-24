import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";

import * as CodexClient from "./client.ts";
import * as CodexError from "./errors.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

const encoder = new TextEncoder();
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/codex-app-server-mock-peer.ts"),
);
const mockPeerArgs = (path: string) => [path];

it.layer(NodeServices.layer)("effect-codex-app-server client", (it) => {
  const makeHandle = (env?: Record<string, string>) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const peerCwd = path.join(import.meta.dirname, "..");
      const command = ChildProcess.make(process.execPath, mockPeerArgs(yield* mockPeerPath), {
        cwd: peerCwd,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
      return yield* spawner.spawn(command);
    });

  it.effect("initializes, handles typed server requests, and reads account and skills data", () =>
    Effect.gen(function* () {
      const userInputRequests = yield* Ref.make<Array<unknown>>([]);
      const messageDeltas = yield* Ref.make<Array<unknown>>([]);
      const fallbackNotifications = yield* Ref.make<Array<unknown>>([]);
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const result = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;

        yield* client.requests.pipe(
          Stream.runForEach((request) =>
            Ref.update(userInputRequests, (current) => [
              ...current,
              { method: request.method, payload: request.params, requestId: request.id },
            ]).pipe(
              Effect.andThen(
                client.raw.respond(request.id, {
                  answers: {
                    approved: {
                      answers: ["yes"],
                    },
                  },
                }),
              ),
            ),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        );

        yield* client.notifications.pipe(
          Stream.runForEach((notification) =>
            Ref.update(fallbackNotifications, (current) => [
              ...current,
              { method: notification.method, payload: notification.params },
            ]).pipe(
              Effect.andThen(
                notification.protocol === "generated" &&
                  notification.method === "item/agentMessage/delta"
                  ? Ref.update(messageDeltas, (current) => [...current, notification.params])
                  : Effect.void,
              ),
            ),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        );

        const initialized = yield* client.request("initialize", {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        });
        assert.equal(initialized.userAgent, "mock-codex-app-server");

        yield* client.notify("initialized", undefined);

        const account = yield* client.request("account/read", {});
        assert.equal(account.requiresOpenaiAuth, false);
        assert.deepEqual(account.account, {
          type: "chatgpt",
          email: "mock@example.com",
          planType: "plus",
        });

        const path = yield* Path.Path;
        const peerCwd = path.join(import.meta.dirname, "..");
        const skills = yield* client.request("skills/list", {});
        assert.equal(skills.data.length, 1);
        assert.equal(skills.data[0]?.cwd, peerCwd);

        return {
          account,
          skills,
        };
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      assert.equal(result.skills.data[0]?.skills.length, 0);
      assert.deepEqual(yield* Ref.get(userInputRequests), [
        {
          method: "item/tool/requestUserInput",
          requestId: 10_000,
          payload: {
            isBlocking: true,
            itemId: "item-approval-1",
            threadId: "thread-1",
            turnId: "turn-1",
            questions: [
              {
                id: "approved",
                header: "Approve",
                question: "Continue with the mock skills request?",
                options: [
                  {
                    label: "yes",
                    description: "Approve the request",
                  },
                ],
              },
            ],
          },
        },
      ]);
      assert.deepEqual(yield* Ref.get(messageDeltas), [
        {
          delta: "Mock server is ready.",
          itemId: "item-1",
          threadId: "thread-1",
          turnId: "turn-1",
        },
      ]);
      assert.deepEqual(yield* Ref.get(fallbackNotifications), [
        {
          method: "item/agentMessage/delta",
          payload: {
            delta: "Mock server is ready.",
            itemId: "item-1",
            threadId: "thread-1",
            turnId: "turn-1",
          },
        },
      ]);
    }),
  );
  it.effect("drains child stderr so large diagnostics cannot block protocol responses", () =>
    Effect.gen(function* () {
      const handle = yield* makeHandle({
        CODEX_APP_SERVER_TEST_STDERR_BYTES: String(512 * 1024),
      });
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const initialized = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;
        return yield* client.request("initialize", {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        });
      }).pipe(
        Effect.timeout("5 seconds"),
        Effect.provide(context),
        Effect.ensuring(Scope.close(scope, Exit.void)),
      );

      assert.equal(initialized.userAgent, "mock-codex-app-server");
    }),
  );

  it.effect("terminates the physical protocol when a known notification cannot be decoded", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const client = yield* CodexClient.make(stdio);
      yield* Queue.offer(
        input,
        encoder.encode(
          `${encodeJson({
            method: "item/agentMessage/delta",
            params: { threadId: "thread-1", delta: 42 },
          })}\n`,
        ),
      );

      const error = yield* client.termination.pipe(Effect.flip);
      assert.instanceOf(error, CodexError.CodexAppServerProtocolParseError);
      assert.deepInclude(error, {
        operation: "decode-notification-payload",
        method: "item/agentMessage/delta",
      });
    }),
  );
});
