import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ComposerCatalog, live as composerCatalogLive } from "./ComposerCatalog";

it.effect("projects models, plugins, and skills through one composer interface", () =>
  Effect.gen(function* () {
    const requestLocal = ((method: string) => {
      if (method === "model/list") {
        return Effect.succeed({
          data: [
            {
              id: "model-a",
              model: "model-a",
              displayName: "Model A",
              description: "Agent model",
              hidden: false,
              supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
              defaultReasoningEffort: "medium",
              isDefault: true,
            },
          ],
          nextCursor: null,
        });
      }
      if (method === "plugin/installed") {
        return Effect.succeed({
          marketplaces: [
            {
              name: "openai-bundled",
              path: null,
              interface: null,
              plugins: [
                {
                  id: "browser@openai-bundled",
                  name: "browser",
                  installed: true,
                  enabled: true,
                  availability: "AVAILABLE",
                  disabledReason: null,
                  installPolicy: null,
                  installPolicySource: null,
                  authPolicy: "ON_USE",
                  interface: {
                    displayName: "Browser",
                    shortDescription: "Control a browser",
                    defaultPrompt: [],
                    composerIcon: null,
                    composerIconUrl: null,
                    logo: null,
                    logoUrl: null,
                    logoDark: null,
                    logoUrlDark: null,
                    brandColor: null,
                  },
                },
              ],
            },
          ],
          marketplaceLoadErrors: [],
        });
      }
      if (method === "skills/list") {
        return Effect.succeed({
          data: [
            {
              cwd: "/repo",
              errors: [],
              skills: [
                {
                  name: "PDF",
                  description: "Read PDFs",
                  shortDescription: "PDF tools",
                  path: "/skills/pdf/SKILL.md",
                  scope: "system",
                  enabled: true,
                },
              ],
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${method}`);
    }) as CodexGateway["Service"]["requestLocal"];
    const unsupported = () => Effect.die(new Error("Unsupported test operation"));
    const gateway = CodexGateway.of({
      localHostId: "local",
      events: Stream.empty,
      requestLocal,
      requestOnHost: (_hostId, method, params) => requestLocal(method, params),
      requestForThread: (_threadId, method, params) => requestLocal(method, params),
      notifyLocal: unsupported,
      connection: () => unsupported(),
      awaitReady: () => Effect.void,
      reconcileHost: unsupported,
      removeHost: unsupported,
      restartHost: unsupported,
    });
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      composerCatalogLive.pipe(Layer.provide(Layer.succeed(CodexGateway, gateway))),
      scope,
    );
    const catalog = Context.get(context, ComposerCatalog);

    const models = yield* catalog.listModels;
    assert.strictEqual(models[0]?.id, "model-a");
    assert.strictEqual(models[0]?.defaultReasoningEffort, "medium");
    const plugins = yield* catalog.listPlugins([" /repo ", "/repo"]);
    assert.strictEqual(plugins[0]?.id, "browser@openai-bundled");
    const skills = yield* catalog.listSkills(["/repo"]);
    assert.strictEqual(skills[0]?.path, "/skills/pdf/SKILL.md");
    yield* catalog.activatePlugin({ id: "browser@openai-bundled", cwds: ["/repo"] });

    yield* Scope.close(scope, Exit.void);
  }),
);
