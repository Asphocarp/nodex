import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { CoreGenerationClient } from "../core-client/core-generation-client";
import type {
  AutomationApplyResult,
  AutomationReadSnapshot,
  LibraryApplyResult,
  LibraryReadSnapshot,
} from "../core-client/types";
import { CoreSessionAccess } from "./CoreAuthority";
import { CoreModules, live } from "./CoreModules";

it.effect("forwards Library and Automation project scope to the Core authority", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const projectScopes: Array<{ readonly operation: string; readonly projectId?: string }> = [];
      const client = {
        libraryRead: () => Promise.resolve({} as LibraryReadSnapshot),
        libraryApply: () => Promise.resolve({} as LibraryApplyResult),
        automationRead: () => Promise.resolve({} as AutomationReadSnapshot),
        automationApply: () => Promise.resolve({} as AutomationApplyResult),
      } as unknown as CoreGenerationClient;
      const access = CoreSessionAccess.of({
        use: (operation, run, options) =>
          Effect.promise((signal) => {
            projectScopes.push({ operation, projectId: options?.projectId });
            return run(client, signal);
          }),
        handshake: Effect.die("unused"),
      });
      const context = yield* Layer.build(
        live.pipe(Layer.provide(Layer.succeed(CoreSessionAccess, access))),
      );
      const core = Context.get(context, CoreModules);

      yield* core.library.read({} as never, undefined, "project:a");
      yield* core.library.apply({} as never, "project:a");
      yield* core.automation.read({} as never, undefined, "project:b");
      yield* core.automation.apply({} as never, undefined, "project:b");

      assert.deepStrictEqual(projectScopes, [
        { operation: "library.read", projectId: "project:a" },
        { operation: "library.apply", projectId: "project:a" },
        { operation: "automation.read", projectId: "project:b" },
        { operation: "automation.apply", projectId: "project:b" },
      ]);
    }),
  ),
);
