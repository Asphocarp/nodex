import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { assert, it } from "@effect/vitest";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import { BrowserProfileRuntime } from "./BrowserProfileRuntime";
import { BrowserPresentationRuntime, live } from "./BrowserPresentationRuntime";
import { BrowserSidebarRuntime } from "./BrowserSidebarRuntime";
import { BrowserSiteStatusRuntime } from "./BrowserSiteStatusRuntime";
import { BrowserUseRuntime } from "./BrowserUseRuntime";

it.effect(
  "coordinates Browser policy, downloads, and route capture through final capabilities",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseCommands: string[] = [];
        const capturedSessions: string[] = [];
        let downloadClears = 0;
        const browser = {
          clearBrowsingData: () => Promise.resolve({ ok: true as const }),
          getTabSnapshot: () => ({ url: "https://blocked.example/" }),
          handleCommand: (command: { readonly type: string }) => {
            baseCommands.push(command.type);
            return Promise.resolve({ ok: true as const });
          },
        } as unknown as BrowserSidebarService;
        const context = yield* Layer.build(
          live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  BrowserSidebarRuntime,
                  BrowserSidebarRuntime.of({ browser } as BrowserSidebarRuntime["Service"]),
                ),
                Layer.succeed(
                  BrowserProfileRuntime,
                  BrowserProfileRuntime.of({
                    credentials: {} as never,
                    download: {
                      clearHistory: Effect.sync(() => {
                        downloadClears += 1;
                      }),
                    } as never,
                    extensions: {} as never,
                    localServerPreferences: {} as never,
                    policy: {} as never,
                    profileImport: {} as never,
                    siteInfo: {} as never,
                  }),
                ),
                Layer.succeed(
                  BrowserSiteStatusRuntime,
                  BrowserSiteStatusRuntime.of({
                    cachedCommentModeBlocked: () => true,
                    isCommentModeBlocked: () => Effect.succeed(true),
                  }),
                ),
                Layer.succeed(
                  BrowserUseRuntime,
                  BrowserUseRuntime.of({
                    captureRoute: (route) =>
                      Effect.sync(() => {
                        capturedSessions.push(route.codexSessionId);
                      }),
                    install: () => Effect.void,
                    promoteRoute: () => Effect.void,
                  }),
                ),
              ),
            ),
          ),
        );
        const runtime = Context.get(context, BrowserPresentationRuntime);

        assert.deepEqual(
          yield* runtime.applyCommand({
            type: "set-interaction-mode",
            browserConversationId: "conversation",
            browserViewScopeId: "scope",
            browserTabId: "tab",
            mode: "comment",
          }),
          { ok: false, message: "Comment mode is unavailable for this site." },
        );
        assert.deepEqual(baseCommands, []);

        assert.deepEqual(
          yield* runtime.applyCommand(
            {
              type: "capture-browser-use-route",
              browserConversationId: "conversation",
              browserViewScopeId: "scope",
              codexSessionId: "session",
              projectId: "project",
            },
            { ownerWebContentsId: 7 },
          ),
          { ok: true },
        );
        assert.deepEqual(capturedSessions, ["session"]);

        assert.deepEqual(yield* runtime.clearBrowsingData("downloads"), { ok: true });
        assert.strictEqual(downloadClears, 1);
      }),
    ),
);
