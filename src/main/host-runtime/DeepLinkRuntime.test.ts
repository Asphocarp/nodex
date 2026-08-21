import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { assert, it } from "@effect/vitest";
import type { BrowserWindow } from "electron";
import type { WindowRuntimeService } from "../window-runtime/WindowRuntime";
import { DeepLinkRuntime, live } from "./DeepLinkRuntime";

it.effect("keeps the newest queued targets behind readiness and flushes resolved routes", () =>
  Effect.gen(function* () {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      },
    } as unknown as BrowserWindow;
    const windows = {
      getLastFocused: () => window,
    } as unknown as WindowRuntimeService;
    const context = yield* Layer.build(
      live({
        focusWindow: () => undefined,
        library: {
          findPageLocation: async (pageId) => ({ pageId, projectId: "project-1" }),
          findViewLocation: async (viewId) => ({
            dataSourceId: "source-1",
            databaseId: "database-1",
            projectId: "project-1",
            viewId,
          }),
        },
        projectWorkspace: {
          getProjectSession: async (sessionId: string) => ({
            id: sessionId,
            projectId: "project-1",
          }),
        } as never,
        windows,
      }),
    );
    const runtime = Context.get(context, DeepLinkRuntime);
    assert.isTrue(yield* runtime.handle("nodex://pages/old"));
    assert.isTrue(yield* runtime.handle("nodex://pages/new"));
    assert.strictEqual(sent.length, 0);

    yield* runtime.markReady;
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]?.channel, "deeplink:open-page");
    assert.deepStrictEqual(sent[0]?.payload, { projectId: "project-1", pageId: "new" });
    assert.isNull(yield* runtime.extractFromArgv(["--flag"]));
  }),
);
