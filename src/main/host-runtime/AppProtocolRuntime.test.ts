import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { Session } from "electron";
import { MANAGED_ASSET_PROTOCOL_SCHEME } from "../../shared/managed-assets";
import { MainConfig } from "../app/MainConfig";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";
import { live } from "./AppProtocolRuntime";

it.effect("owns application protocol handlers with the Main Scope", () =>
  Effect.gen(function* () {
    const handled = new Set<string>();
    const defaultSession = {
      protocol: {
        handle: (scheme: string) => {
          handled.add(scheme);
          return Promise.resolve();
        },
        isProtocolHandled: (scheme: string) => handled.has(scheme),
        unhandle: (scheme: string) => {
          handled.delete(scheme);
        },
      },
    } as unknown as Session;
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(
              ElectronSessionHost,
              ElectronSessionHost.of({
                defaultSession: Effect.succeed(defaultSession),
                fromPartition: () => Effect.die("unused"),
                protocol: null as never,
                scopedRegistration: () => Effect.void,
              }),
            ),
            Layer.succeed(
              MainConfig,
              MainConfig.of({
                assistantStreamingDebug: false,
                appVersion: "test",
                arch: "arm64",
                argv: [],
                documentsPath: "/tmp/Documents",
                environmentPath: null,
                initialProjectsDirectory: null,
                isDefaultApp: false,
                isPackaged: false,
                nodexHome: "/tmp/nodex-test",
                platform: "darwin",
                profileId: "test",
                projectRootPath: "/repo",
                rendererUrl: "http://localhost:5173",
                resourcesPath: "/resources",
                runtimeBinaryPath: "/electron",
              }),
            ),
          ),
        ),
      ),
      scope,
    );

    assert.isTrue(handled.has(MANAGED_ASSET_PROTOCOL_SCHEME));
    yield* Scope.close(scope, Exit.void);
    assert.isFalse(handled.has(MANAGED_ASSET_PROTOCOL_SCHEME));
  }),
);
