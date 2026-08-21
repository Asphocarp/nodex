import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ProviderCredentials } from "../platform/electron/ProviderCredentials";
import { AgentProviderRuntime, live as agentProviderRuntimeLive } from "./AgentProviderRuntime";

const unsupported = () => Effect.die(new Error("Unsupported test operation"));

const model = {
  id: "gpt-5.5",
  model: "gpt-5.5",
  displayName: "GPT-5.5",
  description: "",
  hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
  defaultReasoningEffort: "high",
  inputModalities: ["text"],
  serviceTiers: [{ id: "fast", name: "Fast", description: "Faster" }],
  defaultServiceTier: null,
  isDefault: true,
};

it.effect("owns provider discovery, profile resolution, and deferred credential restart", () =>
  Effect.gen(function* () {
    let active = true;
    let restarts = 0;
    let stored = false;
    const requestLocal = ((method: string, params: unknown) => {
      if (method === "interpreter/provider/list") {
        return Effect.succeed({
          data: [
            {
              id: "openai",
              name: "OpenAI",
              description: "",
              isCurrent: true,
              wireApi: "responses",
              configured: true,
              isDefault: true,
            },
          ],
        });
      }
      if (method === "interpreter/model/list") return Effect.succeed({ data: [model] });
      if (method === "interpreter/harness/list") {
        return Effect.succeed({
          data: [{ id: null, label: "Native", description: "", isRecommended: true }],
        });
      }
      if (method === "thread/list") {
        return Effect.succeed({
          data: active
            ? [
                {
                  id: "thread-1",
                  status: { type: "active", activeFlags: [] },
                },
              ]
            : [],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected request: ${method} ${JSON.stringify(params)}`);
    }) as CodexGateway["Service"]["requestLocal"];
    const gateway = CodexGateway.of({
      localHostId: "local",
      events: Stream.empty,
      requestLocal,
      requestOnHost: unsupported,
      requestForThread: unsupported,
      notifyLocal: unsupported,
      connection: unsupported,
      awaitReady: () => Effect.void,
      reconcileHost: unsupported,
      removeHost: unsupported,
      restartHost: () => Effect.sync(() => void (restarts += 1)),
    });
    const credentials = ProviderCredentials.of({
      status: (providerId) =>
        Effect.succeed(providerId === "openai" || stored ? "runtimeManaged" : "missing"),
      set: () => Effect.sync(() => void (stored = true)),
      remove: () => Effect.sync(() => void (stored = false)),
    });
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      agentProviderRuntimeLive.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(CodexGateway, gateway),
            Layer.succeed(ProviderCredentials, credentials),
          ),
        ),
      ),
      scope,
    );
    const runtime = Context.get(context, AgentProviderRuntime);

    const catalog = yield* runtime.list();
    assert.strictEqual(catalog.providers[0]?.models[0]?.modelId, "gpt-5.5");
    assert.deepEqual(
      yield* runtime.resolveExecutionProfile({
        providerId: "openai",
        modelId: "gpt-5.5",
        harnessId: null,
        reasoningEffort: null,
        serviceTier: "fast",
      }),
      {
        providerId: "openai",
        modelId: "gpt-5.5",
        harnessId: null,
        reasoningEffort: "high",
        serviceTier: "fast",
      },
    );
    assert.deepEqual(yield* runtime.setCredential({ providerId: "openai", apiKey: "key" }), {
      providerId: "openai",
      status: "runtimeManaged",
      runtimeRestartPending: true,
    });
    assert.strictEqual(restarts, 0);
    active = false;
    yield* runtime.ensureRuntimeReady;
    assert.strictEqual(restarts, 1);

    yield* Scope.close(scope, Exit.void);
  }),
);
