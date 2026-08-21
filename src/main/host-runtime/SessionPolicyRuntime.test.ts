import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { Session } from "electron";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";
import { live } from "./SessionPolicyRuntime";

const fakeSession = () => {
  let permissionCheck: unknown = null;
  let permissionRequest: unknown = null;
  let beforeRequest: unknown = null;
  return {
    session: {
      setPermissionCheckHandler: (handler: unknown) => {
        permissionCheck = handler;
      },
      setPermissionRequestHandler: (handler: unknown) => {
        permissionRequest = handler;
      },
      webRequest: {
        onBeforeRequest: (handler: unknown) => {
          beforeRequest = handler;
        },
      },
    } as unknown as Session,
    permissionsInstalled: () => permissionCheck !== null && permissionRequest !== null,
    allInstalled: () =>
      permissionCheck !== null && permissionRequest !== null && beforeRequest !== null,
    released: () =>
      permissionCheck === null && permissionRequest === null && beforeRequest === null,
  };
};

it.effect("installs policies before windows and removes them with the Main Scope", () =>
  Effect.gen(function* () {
    const appSession = fakeSession();
    const browserSession = fakeSession();
    const host = ElectronSessionHost.of({
      defaultSession: Effect.succeed(appSession.session),
      fromPartition: () => Effect.succeed(browserSession.session),
      scopedRegistration: (acquire: () => void, release: () => void) =>
        Effect.acquireRelease(Effect.sync(acquire), () => Effect.sync(release)),
    } as unknown as ElectronSessionHost["Service"]);
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live.pipe(Layer.provide(Layer.succeed(ElectronSessionHost, host))),
      scope,
    );
    assert.isTrue(appSession.permissionsInstalled());
    assert.isTrue(browserSession.allInstalled());

    yield* Scope.close(scope, Exit.void);
    assert.isTrue(appSession.released());
    assert.isTrue(browserSession.released());
  }),
);
