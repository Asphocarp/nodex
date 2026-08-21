import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { makeBrowserExtensionsRuntime } from "./browser-extensions-provider";

const withExtensionDirectory = <A, E, R>(
  run: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-extension-"));
      fs.writeFileSync(
        path.join(root, "manifest.json"),
        JSON.stringify({ manifest_version: 3, name: "Example", version: "1.0.0" }),
      );
      return root;
    }),
    run,
    (root) => Effect.sync(() => fs.rmSync(root, { recursive: true, force: true })),
  );

it.effect("lists and loads unpacked extensions through Electron's public API", () =>
  withExtensionDirectory((root) =>
    Effect.gen(function* () {
      const loadExtension = vi.fn(async () => ({
        id: "extension-id",
        name: "Example",
        path: root,
        url: "chrome-extension://extension-id/",
        version: "1.0.0",
        manifest: { version: "1.0.0" },
      }));
      const runtime = makeBrowserExtensionsRuntime({
        getAllExtensions: () => [],
        loadExtension,
        removeExtension: vi.fn(),
      });

      assert.isTrue(runtime.capability().available);
      assert.deepInclude(yield* runtime.load(root), {
        id: "extension-id",
        version: "1.0.0",
      });
      assert.deepEqual(loadExtension.mock.calls[0], [root, { allowFileAccess: false }]);
    }),
  ),
);

it.effect("reports an explicit unavailable capability", () =>
  Effect.gen(function* () {
    const snapshot = yield* makeBrowserExtensionsRuntime(null).snapshot;
    assert.isFalse(snapshot.capability.available);
    assert.strictEqual(snapshot.capability.provider, "unavailable");
    assert.isEmpty(snapshot.extensions);
  }),
);
